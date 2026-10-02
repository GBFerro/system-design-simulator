import { describe, expect, it } from "vitest";
import type { RoutingKind } from "@/domain/components/types";
import { mulberry32 } from "@/engine/core/rng";
import type { NodeRuntimeMetrics, TickSnapshot } from "@/engine/types";
import {
  BALL_SPEED,
  FlowBalls,
  MAX_BALLS,
  TARGET_SPAWN_PER_SEC,
  buildTopology,
  niceStep,
  type FlowEnv,
  type TopoEdge,
} from "@/lib/flowBalls";

// OBS-04: balls are requests walking the graph; one ball = `quantum` req/s.

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

  it("cache first: the other sync calls leave once the ball reaches the cache", () => {
    const topo = buildTopology([e("app", "cache"), e("app", "db")], (id): RoutingKind =>
      id === "cache" ? "cache" : "service",
    );
    // The db sees the 10 % that missed.
    const s = snap(
      { app: node(60), cache: node(60), db: node(6) },
      { "app-cache": 60, "app-db": 6 },
    );
    const balls = new FlowBalls(mulberry32(5));
    const dt = 0.05;
    let dbLaunched = 0;
    let dbWithoutCacheArrival = 0;
    for (let f = 0; f < 4000; f++) {
      const cacheArrivals = balls.balls.filter(
        (b) => b.edge === "app-cache" && b.pos + BALL_SPEED * dt >= LEN,
      ).length;
      balls.step(dt, s, topo, env);
      // Balls launched this frame start at 0.
      const fresh = balls.balls.filter((b) => b.edge === "app-db" && b.pos === 0).length;
      dbLaunched += fresh;
      if (cacheArrivals === 0) dbWithoutCacheArrival += fresh;
    }
    expect(dbLaunched).toBeGreaterThan(0);
    expect(dbWithoutCacheArrival).toBe(0);
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
