import { describe, expect, it } from "vitest";
import type { EdgeCall, RoutingKind } from "@/domain/components/types";
import { mulberry32 } from "@/engine/core/rng";
import type { NodeRuntimeMetrics, TickSnapshot } from "@/engine/types";
import { DEFAULT_READ_RATIO } from "@/engine/core/routing";
import {
  BALL_SPEED,
  FALLBACK_READ_RATIO,
  FRAME_TTL_SEC,
  FlowBalls,
  MAX_BALLS,
  TARGET_SPAWN_PER_SEC,
  buildTopology,
  niceStep,
  type FlowEnv,
  type FlowTopology,
  type TopoEdge,
} from "@/lib/flowBalls";

// OBS-04: balls are requests walking the graph; one ball = `quantum` req/s.

it("the balls' read-ratio fallback is the engine's default (a copy, to keep the engine out of the initial bundle)", () => {
  expect(FALLBACK_READ_RATIO).toBe(DEFAULT_READ_RATIO);
});

const LEN = BALL_SPEED; // every edge takes 1 s to cross
const env: FlowEnv = { lengthOf: () => LEN };

function node(rpsIn: number, extra: Partial<NodeRuntimeMetrics> = {}): NodeRuntimeMetrics {
  return {
    rpsIn,
    rpsOut: rpsIn,
    utilization: 0.5,
    queueDepth: 0,
    p50: 1,
    p95: 2,
    p99: 3,
    errorRate: 0,
    drops: 0,
    status: "ok",
    ...extra,
  };
}

function snap(
  nodes: Record<string, NodeRuntimeMetrics>,
  edges: Record<string, number>,
): TickSnapshot {
  return {
    t: 0,
    offeredRps: 0,
    nodes,
    edges: Object.fromEntries(
      Object.entries(edges).map(([id, rps]) => [id, { rps, status: "ok" }]),
    ),
    global: { throughput: 0, goodput: 0, errorRate: 0, p50: 0, p95: 0, p99: 0, availability: 1 },
  };
}

const e = (source: string, target: string, async = false): TopoEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  async,
});

/** Mean balls on each edge over `seconds` of 50 ms frames after a warm-up. */
function meanBalls(
  balls: FlowBalls,
  s: TickSnapshot,
  topo: ReturnType<typeof buildTopology>,
  seconds = 200,
) {
  const dt = 0.05;
  for (let t = 0; t < 5; t += dt) balls.step(dt, s, topo, env);
  const sums = new Map<string, number>();
  const frames = Math.round(seconds / dt);
  for (let f = 0; f < frames; f++) {
    balls.step(dt, s, topo, env);
    for (const b of balls.balls) sums.set(b.edge, (sums.get(b.edge) ?? 0) + 1);
  }
  return (id: string) => (sums.get(id) ?? 0) / frames;
}

describe("flow balls (OBS-04)", () => {
  it("niceStep rounds up to 1-2-5 steps", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(16_667)).toBe(20_000);
    expect(niceStep(60_000)).toBe(100_000);
  });

  it("picks a round quantum for the entry load and keeps it until the load drifts far", () => {
    const topo = buildTopology([e("a", "b")], () => "service");
    const balls = new FlowBalls(mulberry32(1));
    balls.step(0.05, snap({ a: node(100_000), b: node(100_000) }, { "a-b": 100_000 }), topo, env);
    expect(balls.quantum).toBe(niceStep(100_000 / TARGET_SPAWN_PER_SEC));
    const q = balls.quantum;
    balls.step(0.05, snap({ a: node(200_000), b: node(200_000) }, { "a-b": 200_000 }), topo, env);
    expect(balls.quantum).toBe(q); // 2× load: more balls, same legend
    balls.step(
      0.05,
      snap({ a: node(1_000_000), b: node(1_000_000) }, { "a-b": 1_000_000 }),
      topo,
      env,
    );
    expect(balls.quantum).toBeGreaterThan(q); // 10×: re-picked
  });

  it("puts balls on each edge in proportion to its load (a fan-out calls each dependency)", () => {
    // app → cache (all), app → id-gen (writes, 1 %), app → monitoring (async, all)
    const topo = buildTopology([e("lb", "app"), e("app", "idgen"), e("app", "mon", true)], (id) =>
      id === "lb" ? "lb" : "service",
    );
    const s = snap(
      { lb: node(60_000), app: node(60_000), idgen: node(600), mon: node(60_000) },
      { "lb-app": 60_000, "app-idgen": 600, "app-mon": 60_000 },
    );
    const balls = new FlowBalls(mulberry32(7));
    const mean = meanBalls(balls, s, topo);
    const perEdge = 60_000 / balls.quantum; // balls/s on a full-load edge; 1 s per edge
    expect(mean("lb-app")).toBeCloseTo(perEdge, 0);
    expect(mean("app-mon")).toBeCloseTo(perEdge, 0);
    expect(mean("app-idgen")).toBeLessThan(perEdge * 0.05);
  });

  it("a load balancer sends each ball down one edge, split by the edges' load", () => {
    const topo = buildTopology([e("lb", "s1"), e("lb", "s2")], (id): RoutingKind =>
      id === "lb" ? "lb" : "service",
    );
    const s = snap(
      { lb: node(60_000), s1: node(45_000), s2: node(15_000) },
      { "lb-s1": 45_000, "lb-s2": 15_000 },
    );
    const balls = new FlowBalls(mulberry32(3));
    const mean = meanBalls(balls, s, topo);
    const total = mean("lb-s1") + mean("lb-s2");
    expect(total).toBeCloseTo(60_000 / balls.quantum, 0); // no duplication
    expect(mean("lb-s1") / total).toBeGreaterThan(0.65);
    expect(mean("lb-s1") / total).toBeLessThan(0.85);
  });

  it("steps: the database read leaves only after the cache answered, and only on a miss", () => {
    // Look-aside: app → cache (reads); app → db (writes + reads after a miss in the cache).
    const topo = buildTopology(
      [
        ce("client", "app", [call("always")]),
        ce("app", "cache", [call("reads")]),
        ce("app", "db", [call("writes"), call("after_miss", { missOf: "cache" })]),
      ],
      (id): RoutingKind => (id === "cache" ? "cache" : "service"),
      undefined,
      (id) => id === "cache",
    );
    const s = withReadRatio(
      snap(
        {
          client: node(60),
          app: node(60),
          cache: node(54, { extra: { hitRatio: 0.9 } }),
          db: node(11),
        },
        { "client-app": 60, "app-cache": 54, "app-db": 11 },
      ),
      0.9,
    );
    const t = record(new FlowBalls(mulberry32(5)), s, topo, env, 6000);
    const reads = t.keysOn("app-cache");
    let readMisses = 0;
    for (const key of reads) {
      const db = t.first("app-db", key);
      if (db === undefined) continue;
      readMisses++;
      expect(db).toBeGreaterThan(t.last("app-cache", key)); // after the cache's response is back
    }
    expect(reads.size).toBeGreaterThan(200);
    expect(readMisses / reads.size).toBeGreaterThan(0.04); // 1 − hitRatio = 10 %
    expect(readMisses / reads.size).toBeLessThan(0.16);
    const writes = [...t.keysOn("app-db")].filter((k) => !reads.has(k)).length;
    const all = t.keysOn("client-app").size;
    expect(writes / all).toBeGreaterThan(0.05); // 1 − readRatio = 10 %
    expect(writes / all).toBeLessThan(0.15);
  });

  it("a request fails at a node with its error share and leaves a burst", () => {
    const topo = buildTopology([e("a", "b"), e("b", "c")], () => "service");
    const s = snap(
      { a: node(600), b: node(600, { errorRate: 1, rpsOut: 0 }), c: node(0) },
      { "a-b": 600, "b-c": 600 },
    );
    const balls = new FlowBalls(mulberry32(2));
    for (let f = 0; f < 100; f++) balls.step(0.05, s, topo, env);
    expect(balls.balls.some((b) => b.edge === "b-c")).toBe(false);
    expect(balls.bursts.length).toBeGreaterThan(0);
    expect(balls.bursts.every((b) => b.edge === "a-b")).toBe(true);
  });

  it("a crowded screen raises the quantum, never above MAX_BALLS", () => {
    // Every node fans out to three edges at full load: ×3 balls per hop.
    const edges: TopoEdge[] = [];
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 3; k++) edges.push(e(`n${c}-${r}`, `n${c + 1}-${k}`));
    }
    const topo = buildTopology(edges, () => "service");
    const s = snap({}, Object.fromEntries(edges.map((x) => [x.id, 1_000_000])));
    const balls = new FlowBalls(mulberry32(9));
    balls.step(0.05, s, topo, env);
    const first = balls.quantum;
    let most = 0;
    for (let f = 1; f < 1200; f++) {
      balls.step(0.05, s, topo, env);
      most = Math.max(most, balls.balls.length);
    }
    expect(most).toBeLessThanOrEqual(MAX_BALLS);
    expect(balls.quantum).toBeGreaterThan(first);
  });

  describe("expanded nodes: balls take the edge to one instance's card", () => {
    // lb → app (4 instances, the last one down) → db
    const run = (algorithm: string, down = [false, false, false, true]) => {
      const topo = buildTopology(
        [e("lb", "app"), e("app", "db")],
        (id): RoutingKind => (id === "lb" ? "lb" : "service"),
        (id) => (id === "lb" ? algorithm : undefined),
      );
      const s = snap(
        { lb: node(600), app: node(600), db: node(600) },
        { "lb-app": 600, "app-db": 600 },
      );
      const env: FlowEnv = {
        lengthOf: () => LEN,
        instancesOf: (id) => (id === "app" ? { count: 4, down } : undefined),
      };
      const balls = new FlowBalls(mulberry32(11));
      const perInstance = [0, 0, 0, 0];
      const outOf = new Set<string>();
      for (let f = 0; f < 2000; f++) {
        balls.step(0.05, s, topo, env);
        for (const b of balls.balls) {
          if (b.pos !== 0) continue; // launched this frame
          if (b.edge === "lb-app") {
            perInstance[b.instance]++;
            expect(b.drawn).toBe(`inst:lb-app:-1:${b.lane}`);
          }
          if (b.edge === "app-db") outOf.add(b.drawn);
        }
      }
      return { perInstance, outOf };
    };

    it.each(["round-robin", "least-connections", "hash", "weighted"])(
      "%s spreads over the live instances and skips the dead one",
      (algorithm) => {
        const { perInstance } = run(algorithm);
        expect(perInstance[3]).toBe(0);
        const live = perInstance.slice(0, 3);
        const total = live.reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(500);
        for (const h of live) expect(h / total).toBeGreaterThan(0.2);
      },
    );

    it("round robin takes the live instances in turn", () => {
      const { perInstance } = run("round-robin");
      const live = perInstance.slice(0, 3);
      expect(Math.max(...live) - Math.min(...live)).toBeLessThanOrEqual(1);
    });

    it("the calls leave from the card the ball reached", () => {
      const { outOf } = run("round-robin");
      expect([...outOf].sort()).toEqual([
        "inst:app-db:0:-1",
        "inst:app-db:1:-1",
        "inst:app-db:2:-1",
      ]);
    });

    it("past MAX cards the rest share the stacked card", () => {
      const topo = buildTopology([e("lb", "app")], (id): RoutingKind =>
        id === "lb" ? "lb" : "service",
      );
      const s = snap({ lb: node(600), app: node(600) }, { "lb-app": 600 });
      const env: FlowEnv = {
        lengthOf: () => LEN,
        instancesOf: (id) =>
          id === "app" ? { count: 10, down: Array.from({ length: 10 }, () => false) } : undefined,
      };
      const balls = new FlowBalls(mulberry32(4));
      const lanes = new Set<number>();
      for (let f = 0; f < 600; f++) {
        balls.step(0.05, s, topo, env);
        for (const b of balls.balls) if (b.pos === 0) lanes.add(b.lane);
      }
      expect([...lanes].sort()).toEqual([0, 1, 2, 3, 4]);
    });
  });
});

/* ---------- request frames (request-flow) ---------- */

const call = (kind: EdgeCall["kind"], extra: Partial<EdgeCall> = {}): EdgeCall => ({
  kind,
  callsPerRequest: 1,
  ...extra,
});

/** An edge carrying its calls (`rule.calls`), as the canvas builds the topology. */
const ce = (source: string, target: string, calls: EdgeCall[], async = false): TopoEdge => ({
  ...e(source, target, async),
  calls,
});

const withReadRatio = (s: TickSnapshot, readRatio: number): TickSnapshot => ({
  ...s,
  global: { ...s.global, readRatio },
});

/** Every ball (request or response) seen per frame, by edge and request key. */
function record(
  balls: FlowBalls,
  s: TickSnapshot,
  topo: FlowTopology,
  env: FlowEnv,
  frames: number,
  dt = 0.05,
) {
  // dir → edge → key → [first frame, last frame] a ball of that request was on the edge
  const seen = {
    req: new Map<string, Map<number, number[]>>(),
    res: new Map<string, Map<number, number[]>>(),
  };
  const responses: { edge: string; drawn: string; key: number; error: boolean }[] = [];
  const requests: { edge: string; drawn: string; key: number }[] = [];
  let most = 0;
  let mostResponses = 0;
  for (let f = 0; f < frames; f++) {
    balls.step(dt, s, topo, env);
    most = Math.max(most, balls.balls.length + balls.responses.length);
    mostResponses = Math.max(mostResponses, balls.responses.length);
    for (const [dir, list] of [
      ["req", balls.balls],
      ["res", balls.responses],
    ] as const) {
      for (const b of list) {
        expect(b.dir).toBe(dir);
        const byKey = seen[dir].get(b.edge) ?? seen[dir].set(b.edge, new Map()).get(b.edge)!;
        const span = byKey.get(b.key);
        if (span) span[1] = f;
        else byKey.set(b.key, [f, f]);
        if (b.pos !== 0) continue; // launched this frame
        if (dir === "res") {
          responses.push({ edge: b.edge, drawn: b.drawn, key: b.key, error: b.error === true });
        } else requests.push({ edge: b.edge, drawn: b.drawn, key: b.key });
      }
    }
  }
  const span = (dir: "req" | "res", edge: string, key: number) => seen[dir].get(edge)?.get(key);
  return {
    responses,
    requests,
    most,
    mostResponses,
    keysOn: (edge: string) => new Set(seen.req.get(edge)?.keys() ?? []),
    /** First frame the request's call on `edge` was in flight. */
    first: (edge: string, key: number) => span("req", edge, key)?.[0],
    /** First frame the response to the request's call on `edge` was on its way back. */
    firstResponse: (edge: string, key: number) => span("res", edge, key)?.[0],
    /** Last frame anything of the request's call on `edge` (call or response) was in flight. */
    last: (edge: string, key: number) =>
      Math.max(span("req", edge, key)?.[1] ?? -1, span("res", edge, key)?.[1] ?? -1),
  };
}

describe("request frames: calls go out, responses come back (request-flow)", () => {
  it("a sync call's response comes back along the same drawn edge, in reverse (FLW-01)", () => {
    const topo = buildTopology([ce("a", "b", [call("always")])], () => "service");
    const s = snap({ a: node(60), b: node(60) }, { "a-b": 60 });
    const t = record(new FlowBalls(mulberry32(21)), s, topo, env, 400);
    expect(t.responses.length).toBeGreaterThan(50);
    const sent = new Map(t.requests.map((r) => [r.key, r]));
    for (const res of t.responses) {
      const req = sent.get(res.key)!;
      expect(res.edge).toBe(req.edge);
      expect(res.drawn).toBe(req.drawn);
      expect(res.error).toBe(false);
    }
    // The response leaves b once the call got there: the call takes 20 frames (1 s)
    // to cross, so the request's last ball on the edge is ~40 frames after its first.
    for (const key of sent.keys()) {
      const span = t.last("a-b", key) - t.first("a-b", key)!;
      if (t.first("a-b", key)! < 350) expect(span).toBeGreaterThanOrEqual(38);
    }
  });

  it("the response leaves the target only after the target's own calls came back (FLW-01)", () => {
    // a → b → c: b answers a once its call to c has gone out and come back.
    const topo = buildTopology(
      [ce("a", "b", [call("always")]), ce("b", "c", [call("always")])],
      () => "service",
    );
    const s = snap({ a: node(60), b: node(60), c: node(60) }, { "a-b": 60, "b-c": 60 });
    const frames = 600;
    const t = record(new FlowBalls(mulberry32(31)), s, topo, env, frames);
    const keys = t.keysOn("b-c");
    expect(keys.size).toBeGreaterThan(50);
    let checked = 0;
    for (const key of keys) {
      // A round trip a → b → c → b → a takes 80 frames: the early ones are complete.
      if (t.first("a-b", key)! > frames - 100) continue;
      const back = t.firstResponse("a-b", key);
      expect(back).toBeDefined();
      expect(back!).toBeGreaterThan(t.last("b-c", key)); // after b's call and its response
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("an async call gets no response and the caller doesn't wait for it (FLW-03)", () => {
    // a → b async (step 1), a → c sync (step 2)
    const topo = buildTopology(
      [ce("a", "b", [call("always")], true), ce("a", "c", [call("always")])],
      () => "service",
    );
    const s = snap({ a: node(60), b: node(60), c: node(60) }, { "a-b": 60, "a-c": 60 });
    const t = record(new FlowBalls(mulberry32(22)), s, topo, env, 400);
    expect(t.responses.some((r) => r.edge === "a-c")).toBe(true);
    expect(t.responses.some((r) => r.edge === "a-b")).toBe(false);
    const keys = t.keysOn("a-b");
    expect(keys.size).toBeGreaterThan(50);
    for (const key of keys) expect(t.first("a-c", key)).toBe(t.first("a-b", key));
  });

  it("a caller with an async call answers its own caller as soon as without it (FLW-03)", () => {
    // c → a; a → m (async, step 1) and a → d (sync, step 2). The same seed with and without a → m.
    const run = (withAsync: boolean) => {
      const edges = [
        ce("c", "a", [call("always")]),
        ...(withAsync ? [ce("a", "m", [call("always")], true)] : []),
        ce("a", "d", [call("always")]),
      ];
      const s = snap(
        { c: node(60), a: node(60), m: node(60), d: node(60) },
        { "c-a": 60, "a-m": withAsync ? 60 : 0, "a-d": 60 },
      );
      const frames = 600;
      const t = record(
        new FlowBalls(mulberry32(32)),
        s,
        buildTopology(edges, () => "service"),
        env,
        frames,
      );
      // Frames from a request's call on c-a to the first frame of its response there.
      const roundTrips: number[] = [];
      for (const key of t.keysOn("c-a")) {
        if (t.first("c-a", key)! > frames - 120) continue; // its round trip may still be on the way
        const back = t.firstResponse("c-a", key);
        expect(back).toBeDefined(); // every request gets its response
        roundTrips.push(back! - t.first("c-a", key)!);
      }
      return { t, roundTrips };
    };
    const plain = run(false);
    const withAsync = run(true);
    expect(withAsync.t.keysOn("a-m").size).toBeGreaterThan(50); // the async call is made
    expect(withAsync.roundTrips.length).toBeGreaterThan(50);
    const [base] = plain.roundTrips;
    expect(new Set(plain.roundTrips)).toEqual(new Set([base])); // fixed lengths: one round trip
    for (const frames of withAsync.roundTrips) {
      expect(frames).toBe(base); // the same frame as without a → m
      expect(frames * 0.05).toBeLessThan(FRAME_TTL_SEC);
    }
  });

  it("a step's calls leave together; step 2 leaves only after every response of step 1 (FLW-31)", () => {
    const topo = buildTopology(
      [
        ce("app", "c1", [call("always", { step: 1 })]),
        ce("app", "c2", [call("always", { step: 1 })]),
        ce("app", "db", [call("always", { step: 2 })]),
      ],
      () => "service",
    );
    // c2 is twice as far: its response comes back a second after c1's.
    const far: FlowEnv = { lengthOf: (id) => (id === "app-c2" ? 2 * LEN : LEN) };
    const s = snap(
      { app: node(60), c1: node(60), c2: node(60), db: node(60) },
      { "app-c1": 60, "app-c2": 60, "app-db": 60 },
    );
    const t = record(new FlowBalls(mulberry32(23)), s, topo, far, 600);
    const keys = t.keysOn("app-db");
    expect(keys.size).toBeGreaterThan(50);
    for (const key of keys) {
      expect(t.first("app-c1", key)).toBe(t.first("app-c2", key));
      expect(t.first("app-db", key)!).toBeGreaterThan(t.last("app-c1", key));
      expect(t.first("app-db", key)!).toBeGreaterThan(t.last("app-c2", key));
    }
  });

  it("a failure at a node leaves a burst and sends an error response back (FLW-05)", () => {
    const topo = buildTopology(
      [ce("a", "b", [call("always")]), ce("b", "c", [call("always")])],
      () => "service",
    );
    const s = snap(
      { a: node(600), b: node(600, { errorRate: 1, rpsOut: 0 }), c: node(0) },
      { "a-b": 600, "b-c": 600 },
    );
    const balls = new FlowBalls(mulberry32(24));
    const t = record(balls, s, topo, env, 100);
    expect(t.keysOn("b-c").size).toBe(0);
    expect(balls.bursts.length).toBeGreaterThan(0);
    expect(t.responses.length).toBeGreaterThan(0);
    expect(t.responses.every((r) => r.edge === "a-b" && r.error)).toBe(true);
  });

  it("a call fails with its edge's link failure: the caller's timeout or loss (FLW-05)", () => {
    // a → b → c, every node healthy: only the link a → b fails, when it does.
    const topo = buildTopology(
      [ce("a", "b", [call("always")]), ce("b", "c", [call("always")])],
      () => "service",
    );
    const base = snap({ a: node(600), b: node(600), c: node(600) }, { "a-b": 600, "b-c": 600 });
    const run = (s: TickSnapshot) => {
      const balls = new FlowBalls(mulberry32(27));
      const responses: { edge: string; error: boolean }[] = [];
      const reachedC = new Set<number>();
      let bursts = 0;
      let burstsOff = 0;
      // Bursts last BURST_SEC (10 frames): looking every 5 frames sees each one.
      for (let chunk = 0; chunk < 80; chunk++) {
        const t = record(balls, s, topo, env, 5);
        responses.push(...t.responses.map(({ edge, error }) => ({ edge, error })));
        for (const key of t.keysOn("b-c")) reachedC.add(key);
        bursts = Math.max(bursts, balls.bursts.length);
        burstsOff += balls.bursts.filter((b) => b.edge !== "a-b").length;
      }
      return { responses, reachedC, bursts, burstsOff };
    };

    const failing = run({ ...base, edgeLinkFailure: { "a-b": 1 } });
    expect(failing.bursts).toBeGreaterThan(0);
    expect(failing.burstsOff).toBe(0);
    expect(failing.reachedC.size).toBe(0);
    const back = failing.responses.filter((r) => r.edge === "a-b");
    expect(back.length).toBeGreaterThan(50);
    expect(back.every((r) => r.error)).toBe(true);

    const fine = run({ ...base, edgeLinkFailure: { "a-b": 0 } });
    expect(fine.bursts).toBe(0);
    expect(fine.reachedC.size).toBeGreaterThan(50);
    const ok = fine.responses.filter((r) => r.edge === "a-b");
    expect(ok.length).toBeGreaterThan(50);
    expect(ok.every((r) => !r.error)).toBe(true);
    // A snapshot without the field (built by hand, older engine) behaves the same.
    expect(run(base)).toEqual(fine);
  });

  it("a failed cache call counts as a miss: the read goes on to the database", () => {
    const topo = buildTopology(
      [
        ce("client", "app", [call("always")]),
        ce("app", "cache", [call("reads")]),
        ce("app", "db", [call("writes"), call("after_miss", { missOf: "cache" })]),
      ],
      (id): RoutingKind => (id === "cache" ? "cache" : "service"),
      undefined,
      (id) => id === "cache",
    );
    const s = withReadRatio(
      snap(
        {
          client: node(60),
          app: node(60),
          cache: node(54, { errorRate: 1, rpsOut: 0, extra: { hitRatio: 0.9 } }),
          db: node(60),
        },
        { "client-app": 60, "app-cache": 54, "app-db": 60 },
      ),
      0.9,
    );
    const balls = new FlowBalls(mulberry32(25));
    const t = record(balls, s, topo, env, 600);
    const reads = t.keysOn("app-cache");
    expect(reads.size).toBeGreaterThan(50);
    for (const key of reads) {
      if (t.first("app-cache", key)! > 500) continue; // its read may still be on the way
      expect(t.first("app-db", key)!).toBeGreaterThan(t.last("app-cache", key));
    }
    // The request itself doesn't fail because of the cache.
    const back = t.responses.filter((r) => r.edge === "client-app");
    expect(back.length).toBeGreaterThan(50);
    expect(back.every((r) => !r.error)).toBe(true);
  });

  it("the response reaching the entry closes the request (FLW-06)", () => {
    const topo = buildTopology([ce("a", "b", [call("always")])], () => "service");
    const balls = new FlowBalls(mulberry32(26));
    const busy = snap({ a: node(60), b: node(60) }, { "a-b": 60 });
    for (let f = 0; f < 60; f++) balls.step(0.05, busy, topo, env);
    expect(balls.frameCount).toBeGreaterThan(0);
    expect(balls.responses.length).toBeGreaterThan(0);
    const idle = snap({ a: node(0), b: node(0) }, { "a-b": 0 });
    for (let f = 0; f < 60; f++) balls.step(0.05, idle, topo, env); // 3 s: every round trip ends
    expect(balls.balls.length).toBe(0);
    expect(balls.responses.length).toBe(0);
    expect(balls.frameCount).toBe(0);
  });

  it(`frames still waiting after FRAME_TTL_SEC (${FRAME_TTL_SEC} s) are dropped`, () => {
    const topo = buildTopology([ce("a", "b", [call("always")])], () => "service");
    const slow: FlowEnv = { lengthOf: () => 100 * BALL_SPEED }; // 100 s per crossing
    const balls = new FlowBalls(mulberry32(27));
    const busy = snap({ a: node(60), b: node(60) }, { "a-b": 60 });
    for (let f = 0; f < 20; f++) balls.step(0.05, busy, topo, slow);
    const idle = snap({ a: node(0), b: node(0) }, { "a-b": 0 });
    for (let f = 0; f < 200; f++) balls.step(0.05, idle, topo, slow); // 10 s more
    expect(balls.frameCount).toBeGreaterThan(0);
    for (let f = 0; f < 240; f++) balls.step(0.05, idle, topo, slow); // past the TTL
    expect(balls.frameCount).toBe(0);
    expect(balls.balls.length).toBeGreaterThan(0); // their calls are still on the way
  });

  it("frames at a node that left the graph are dropped; clear() drops everything", () => {
    const topo = buildTopology([ce("a", "b", [call("always")])], () => "service");
    const slow: FlowEnv = { lengthOf: () => 100 * BALL_SPEED };
    const balls = new FlowBalls(mulberry32(28));
    const busy = snap({ a: node(60), b: node(60) }, { "a-b": 60 });
    for (let f = 0; f < 20; f++) balls.step(0.05, busy, topo, slow);
    expect(balls.frameCount).toBeGreaterThan(0);
    const other = buildTopology([ce("x", "y", [call("always")])], () => "service");
    balls.step(0.05, snap({}, {}), other, slow);
    expect(balls.frameCount).toBe(0);
    for (let f = 0; f < 20; f++) balls.step(0.05, busy, topo, slow);
    balls.clear();
    expect(balls.frameCount).toBe(0);
    expect(balls.balls.length + balls.responses.length).toBe(0);
  });

  it("responses count toward MAX_BALLS and the adaptive quantum (FLW-07)", () => {
    // Every node calls three dependencies in parallel at full load: ×3 balls per hop.
    const edges: TopoEdge[] = [];
    for (let c = 0; c < 6; c++) {
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 3; k++) {
          edges.push(ce(`n${c}-${r}`, `n${c + 1}-${k}`, [call("always", { step: 1 })]));
        }
      }
    }
    const topo = buildTopology(edges, () => "service");
    const s = snap({}, Object.fromEntries(edges.map((x) => [x.id, 1_000_000])));
    const balls = new FlowBalls(mulberry32(29));
    balls.step(0.05, s, topo, env);
    const first = balls.quantum;
    const t = record(balls, s, topo, env, 1200);
    expect(t.mostResponses).toBeGreaterThan(0);
    expect(t.most).toBeLessThanOrEqual(MAX_BALLS);
    expect(balls.quantum).toBeGreaterThan(first);
  });

  it("with an expanded entry the response returns to the card the request left from (FLW-47)", () => {
    const topo = buildTopology([ce("app", "db", [call("always")])], () => "service");
    const expanded: FlowEnv = {
      lengthOf: () => LEN,
      instancesOf: (id) =>
        id === "app" ? { count: 4, down: [false, false, false, false] } : undefined,
    };
    const s = snap({ app: node(60), db: node(60) }, { "app-db": 60 });
    const t = record(new FlowBalls(mulberry32(30)), s, topo, expanded, 400);
    const sent = new Map(t.requests.map((r) => [r.key, r.drawn]));
    expect(t.responses.length).toBeGreaterThan(50);
    for (const res of t.responses) expect(res.drawn).toBe(sent.get(res.key));
    expect(new Set(t.responses.map((r) => r.drawn))).toEqual(
      new Set(["inst:app-db:0:-1", "inst:app-db:1:-1", "inst:app-db:2:-1", "inst:app-db:3:-1"]),
    );
  });
});
