import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { type SimGraph } from "@/domain/graph/compile";
import { retryAmplification } from "@/engine/core/queueing";
import { TickSimulator } from "@/engine/core/tick";
import { FlowEngine, type EngineClock } from "@/engine/engine";
import { compileFault } from "@/engine/faults/compile";
import { effectsAt } from "@/engine/faults/effects";
import { createSimSession, type SimFrame } from "@/engine/session";
import { rateAt } from "@/engine/traffic/patterns";
import { HISTORY_TICKS, TICK_SEC, type TrafficPattern } from "@/engine/traffic/types";
import type { EdgeCall } from "@/domain/components/types";
import type { TickSnapshot } from "@/engine/types";
import { buildReferenceGraph } from "@/lib/loadReference";
import { comp, randomCanvas, wire, compileV3 } from "./engineFixtures";

const TICKS_PER_SEC = Math.round(1 / TICK_SEC);

/** Scheduler clock driven by hand: `advance(ms)` fires the interval every `sliceMs`. */
function manualClock(sliceMs = 20) {
  let now = 0;
  let fn: (() => void) | null = null;
  const clock: EngineClock & { advance(ms: number): void } = {
    now: () => now,
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    advance(ms: number) {
      for (let done = 0; done < ms; done += sliceMs) {
        now += sliceMs;
        fn?.();
      }
    },
  };
  return clock;
}

function runFor(engine: FlowEngine, seconds: number): TickSnapshot[] {
  const out: TickSnapshot[] = [];
  const off = engine.onTick((s) => out.push(s));
  engine.step(Math.round(seconds * TICKS_PER_SEC));
  off();
  return out;
}

function engineFor(graph: SimGraph, pattern: TrafficPattern, tickSamples = 100): FlowEngine {
  const engine = new FlowEngine({ tickSamples });
  engine.load(graph, { seed: 7 });
  engine.setTraffic(pattern);
  return engine;
}

/** API → queue → workers: consumers drain 2000 msg/s. */
function queueGraph(): SimGraph {
  return compileV3(
    [
      comp("lb", "load-balancer"),
      comp("api", "app-server", { instances: 10, capacityPerInstance: 2000, maxRetries: 0 }),
      comp("q", "message-queue", { instances: 3, capacityPerInstance: 100_000, consumers: 4 }),
      comp("wk", "app-server", { instances: 4, capacityPerInstance: 500, maxRetries: 0 }),
    ],
    [wire("lb", "api"), wire("api", "q"), wire("q", "wk")],
  );
}

/** One app server with capacity 1000 rps and a deep buffer. */
function overloadGraph(): SimGraph {
  return compileV3(
    [
      comp("lb", "load-balancer", { maxRetries: 0 }),
      comp("app", "app-server", {
        instances: 1,
        capacityPerInstance: 1000,
        serviceTimeMs: 20,
        maxQueue: 1_000_000,
        maxRetries: 0,
      }),
    ],
    [wire("lb", "app")],
  );
}

const SPIKE: TrafficPattern = {
  kind: "spike",
  baseRps: 1000,
  multiplier: 5,
  startSec: 10,
  durationSec: 30,
};

describe("tick loop: spike ×5 for 30 s", () => {
  it("fills a queue's backlog during the spike and drains it afterwards", () => {
    const engine = engineFor(queueGraph(), SPIKE);
    const before = runFor(engine, 10).at(-1)!;
    expect(before.nodes.q.queueDepth).toBeLessThan(50);
    expect(before.nodes.wk.status).not.toBe("critical");

    const spike = runFor(engine, 30);
    const peak = spike.at(-1)!;
    // 5000 msg/s in, 2000 msg/s drained → ~3000 msg/s of lag for 30 s ≈ 90k
    expect(peak.nodes.q.queueDepth).toBeGreaterThan(80_000);
    expect(peak.nodes.q.queueDepth).toBeLessThan(100_000);
    expect(peak.nodes.q.status).toBe("critical");
    expect(peak.nodes.q.extra?.queueLagSec).toBeGreaterThan(30);
    // backlog grows monotonically-ish during the spike
    expect(spike[300].nodes.q.queueDepth).toBeLessThan(peak.nodes.q.queueDepth);
    // consumers never exceed their capacity
    for (const s of spike) expect(s.edges["e-q-wk"].rps).toBeLessThanOrEqual(2000 + 1e-6);

    // after: drains at 2000 − 1000 = 1000 msg/s → ~90 s
    const after = runFor(engine, 45);
    expect(after.at(-1)!.nodes.q.queueDepth).toBeLessThan(peak.nodes.q.queueDepth * 0.6);
    // while draining, consumers run flat out: more out of the queue than into it
    expect(after[10].edges["e-q-wk"].rps).toBeCloseTo(2000, 0);
    const recovered = runFor(engine, 60).at(-1)!;
    expect(recovered.nodes.q.queueDepth).toBeLessThan(50);
    expect(recovered.nodes.q.status).not.toBe("critical");
  });

  it("an overloaded service backs up, latency explodes, and it recovers after", () => {
    const pattern: TrafficPattern = { ...SPIKE, baseRps: 500 };
    const engine = engineFor(overloadGraph(), pattern);
    const calm = runFor(engine, 10).at(-1)!;
    expect(calm.nodes.app.queueDepth).toBeLessThan(10);
    const calmP99 = calm.global.p99;

    const spike = runFor(engine, 30);
    const peak = spike.at(-1)!;
    // 2500 in, 1000 served → backlog grows 1500/s for 30 s ≈ 45k
    expect(peak.nodes.app.queueDepth).toBeGreaterThan(40_000);
    expect(peak.nodes.app.queueDepth).toBeLessThan(50_000);
    expect(peak.nodes.app.utilization).toBeGreaterThan(2);
    expect(peak.nodes.app.rpsOut).toBeCloseTo(1000, 0);
    expect(peak.nodes.app.status).toBe("critical");
    // everyone waits behind the backlog: ~45 s
    expect(peak.global.p50).toBeGreaterThan(40_000);
    expect(peak.global.p99).toBeGreaterThan(calmP99 * 100);

    // drains at 1000 − 500 = 500/s → ~90 s; completions exceed arrivals meanwhile
    const draining = runFor(engine, 30);
    expect(draining[5].nodes.app.rpsOut).toBeGreaterThan(draining[5].nodes.app.rpsIn);
    expect(draining.at(-1)!.nodes.app.queueDepth).toBeLessThan(peak.nodes.app.queueDepth);
    const recovered = runFor(engine, 90).at(-1)!;
    expect(recovered.nodes.app.queueDepth).toBeLessThan(10);
    expect(recovered.global.p99).toBeLessThan(calmP99 * 3);
  });

  it("a bounded queue drops the excess instead of growing without limit", () => {
    const graph = compileV3(
      [
        comp("lb", "load-balancer", { maxRetries: 0 }),
        comp("app", "app-server", { instances: 1, capacityPerInstance: 1000, maxQueue: 500 }),
      ],
      [wire("lb", "app")],
    );
    const engine = engineFor(graph, { kind: "constant", rps: 3000 });
    const last = runFor(engine, 5).at(-1)!;
    expect(last.nodes.app.queueDepth).toBeLessThanOrEqual(500);
    expect(last.nodes.app.drops).toBeGreaterThan(1500);
    expect(last.nodes.app.errorRate).toBeGreaterThan(0.5);
    expect(last.global.throughput).toBeLessThan(last.offeredRps * 0.5);
  });
});

describe("tick loop: arrivals and retries", () => {
  it("the mean arrival rate over many ticks converges to λ", () => {
    for (const lambda of [10, 400, 250_000]) {
      const engine = engineFor(overloadGraph(), { kind: "constant", rps: lambda }, 1);
      const ticks = runFor(engine, 200);
      const mean = ticks.reduce((s, t) => s + t.offeredRps, 0) / ticks.length;
      // Poisson(λΔt) per tick: standard error of the mean rate = √(λ/(Δt·n))
      const se = Math.sqrt(lambda / (TICK_SEC * ticks.length));
      expect(Math.abs(mean - lambda)).toBeLessThan(5 * se);
      // arrivals are whole requests per tick
      for (const t of ticks)
        expect(Number.isInteger(Math.round(t.offeredRps * TICK_SEC * 1e6) / 1e6)).toBe(true);
    }
  });

  it("retries carry over to the next tick and converge to λ(1 − f^{R+1})/(1 − f)", () => {
    const graph = compileV3(
      [
        comp("lb", "load-balancer", { maxRetries: 0 }),
        comp("api", "app-server", { instances: 50, maxRetries: 3, timeoutMs: 60_000 }),
        comp("db", "nosql-db", { instances: 50 }),
      ],
      [wire("lb", "api"), wire("api", "db", { rule: { packetLoss: 0.2 } })],
    );
    const engine = engineFor(graph, { kind: "constant", rps: 1000 }, 50);
    const ticks = runFor(engine, 60).slice(TICKS_PER_SEC * 2);
    const sum = (f: (t: TickSnapshot) => number) => ticks.reduce((s, t) => s + f(t), 0);
    const ratio = sum((t) => t.edges["e-api-db"].rps) / sum((t) => t.nodes.api.rpsOut);
    expect(ratio).toBeCloseTo(retryAmplification(0.2, 3), 2);
  });
});

describe("tick loop: invariants", () => {
  it("throughput ≤ offered load every tick; every number finite (references + random graphs)", () => {
    const graphs: SimGraph[] = PROBLEMS.map((p) => {
      const { nodes, edges } = buildReferenceGraph(p);
      return compileV3(nodes, edges);
    });
    for (let seed = 1; seed <= 60; seed++) {
      const { nodes, edges } = randomCanvas(seed);
      graphs.push(compileV3(nodes as Node[], edges as Edge[]));
    }
    const pattern: TrafficPattern = {
      kind: "spike",
      baseRps: 20_000,
      multiplier: 5,
      startSec: 0.5,
      durationSec: 1,
    };
    for (const graph of graphs) {
      const engine = engineFor(graph, pattern, 20);
      for (const s of runFor(engine, 2.5)) {
        expect(s.global.throughput).toBeGreaterThanOrEqual(0);
        expect(s.global.throughput).toBeLessThanOrEqual(s.offeredRps + 1e-9);
        for (const v of Object.values(s.global)) expect(Number.isFinite(v)).toBe(true);
        expect(Object.keys(s.nodes).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
        for (const m of Object.values(s.nodes)) {
          for (const v of [
            m.rpsIn,
            m.rpsOut,
            m.utilization,
            m.queueDepth,
            m.p50,
            m.p95,
            m.p99,
            m.drops,
          ]) {
            expect(Number.isFinite(v) && v >= 0).toBe(true);
          }
          expect(m.errorRate).toBeGreaterThanOrEqual(0);
          expect(m.errorRate).toBeLessThanOrEqual(1);
          expect(m.p50).toBeLessThanOrEqual(m.p95 + 1e-9);
          expect(m.p95).toBeLessThanOrEqual(m.p99 + 1e-9);
        }
        for (const e of Object.values(s.edges))
          expect(Number.isFinite(e.rps) && e.rps >= 0).toBe(true);
      }
    }
  });

  it("same graph + seed + pattern → bit-identical snapshots", () => {
    const { nodes, edges } = buildReferenceGraph(PROBLEMS[0]);
    const graph = compileV3(nodes, edges);
    const run = () => {
      const engine = engineFor(graph, SPIKE, 200);
      const a = runFor(engine, 5);
      engine.setTraffic({ kind: "constant", rps: 80_000 }); // live change mid-run
      return [...a, ...runFor(engine, 5)];
    };
    const a = run();
    const b = run();
    expect(a).toHaveLength(200);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // a different seed changes the stream
    const other = new FlowEngine({ tickSamples: 200 });
    other.load(graph, { seed: 8 });
    other.setTraffic(SPIKE);
    expect(runFor(other, 5)).not.toEqual(a.slice(0, 100));
  });

  it("is fast: ≤ 5 ms per tick with 50 nodes and 80 edges (1000 samples)", () => {
    const nodes: Node[] = [comp("lb", "load-balancer")];
    const edges: Edge[] = [];
    // 7 layers of 7 services behind an LB: 50 nodes; each layer fans into the next
    const layers: string[][] = [];
    for (let l = 0; l < 7; l++) {
      const layer: string[] = [];
      for (let i = 0; i < 7; i++) {
        const id = `s${l}_${i}`;
        nodes.push(comp(id, l % 3 === 2 ? "cache" : "app-server", { instances: 20 }));
        layer.push(id);
      }
      layers.push(layer);
    }
    for (const id of layers[0]) edges.push(wire("lb", id));
    for (let l = 0; l + 1 < layers.length && edges.length < 80; l++) {
      for (let i = 0; i < 7 && edges.length < 80; i++) {
        edges.push(wire(layers[l][i], layers[l + 1][i], { rule: { callsPerRequest: 1 } }));
        if (edges.length < 80) {
          edges.push(
            wire(layers[l][i], layers[l + 1][(i + 1) % 7], {
              rule: { kind: "fraction", fraction: 0.3 },
            }),
          );
        }
      }
    }
    while (edges.length < 80) edges.push(wire("lb", layers[6][edges.length % 7]));
    const graph = compileV3(nodes, edges);
    expect(graph.nodes).toHaveLength(50);
    expect(graph.edges).toHaveLength(80);

    const sim = new TickSimulator(graph, { seed: 1 });
    for (let i = 0; i < 50; i++) sim.step(50_000); // warm up the JIT
    const n = 400;
    const start = performance.now();
    for (let i = 0; i < n; i++) sim.step(50_000);
    const perTickMs = (performance.now() - start) / n;
    console.info(`tick: ${perTickMs.toFixed(3)} ms (50 nodes, 80 edges, 1000 samples)`);
    expect(perTickMs).toBeLessThan(5);
  });
});

describe("tick loop: reads after a cache miss (request-flow)", () => {
  const RPS = 10_000;
  const call = (kind: EdgeCall["kind"], extra: Partial<EdgeCall> = {}): EdgeCall => ({
    kind,
    callsPerRequest: 1,
    ...extra,
  });
  const callWire = (source: string, target: string, calls: EdgeCall[]): Edge => ({
    id: `e-${source}-${target}`,
    source,
    target,
    data: { protocol: "http", async: false, rule: { calls, networkLatencyMs: 1, packetLoss: 0 } },
  });
  const graph = compileV3(
    [
      comp("client", "client"),
      comp("svc", "app-server", { instances: 10 }),
      comp("redis", "cache", { hitRate: 0.9, instances: 2, capacityPerInstance: 50_000 }),
      comp("db", "sql-db", { instances: 4, capacityPerInstance: 5000 }),
    ],
    [
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
    ],
  );
  const options = { readRatio: 0.9, seed: 11 };
  const kill = compileFault({ type: "kill-node", target: { kind: "node", id: "redis" } }, 0, {
    graph,
    readRatio: 0.9,
  });
  if (!kill.ok) throw new Error(kill.error);
  const killed = effectsAt(kill.modifiers, 1);

  /** Share of the arrivals that reach the database this tick. */
  const dbShare = (s: TickSnapshot) => s.nodes.db.rpsIn / s.offeredRps;

  it("a cache killed mid-run sends every read to the database within 2 ticks (FLW-13)", () => {
    const sim = new TickSimulator(graph, options);
    let healthy!: TickSnapshot;
    for (let i = 0; i < 40; i++) healthy = sim.step(RPS);
    expect(dbShare(healthy)).toBeCloseTo(0.19, 6);
    const faulted = [sim.step(RPS, killed), sim.step(RPS, killed), sim.step(RPS, killed)];
    expect(faulted[0].nodes.redis.status).toBe("down");
    expect(dbShare(faulted[1])).toBeCloseTo(1, 6);
    expect(dbShare(faulted[2])).toBeCloseTo(1, 6);
    // the cache's failure is a miss: requests keep succeeding
    expect(faulted[2].global.errorRate).toBeCloseTo(0, 9);
  });

  it("same graph + seed + faults → bit-identical snapshots; reset() forgets past failures (FLW-16)", () => {
    const run = (sim: TickSimulator) => {
      const out: TickSnapshot[] = [];
      for (let i = 0; i < 10; i++) out.push(sim.step(RPS));
      for (let i = 0; i < 10; i++) out.push(sim.step(RPS, killed));
      return out;
    };
    const a = new TickSimulator(graph, options);
    const b = new TickSimulator(graph, options);
    expect(run(a)).toEqual(run(b));
    // after a reset the first tick routes as if nothing had failed before
    const healthyRun = (sim: TickSimulator) => Array.from({ length: 10 }, () => sim.step(RPS));
    a.reset();
    expect(healthyRun(a)).toEqual(healthyRun(new TickSimulator(graph, options)));
  });
});

describe("FlowEngine playback (in-thread)", () => {
  function playing(pattern: TrafficPattern = { kind: "constant", rps: 1000 }) {
    const clock = manualClock();
    const engine = new FlowEngine({ clock, tickSamples: 20 });
    engine.load(overloadGraph());
    engine.setTraffic(pattern);
    return { clock, engine };
  }

  it("play advances simulated time at speed × wall time; pause stops it", () => {
    const { clock, engine } = playing();
    expect(engine.time).toBe(0);
    engine.play();
    expect(engine.isPlaying).toBe(true);
    clock.advance(1000);
    expect(engine.time).toBeCloseTo(1, 6);
    engine.pause();
    expect(engine.isPlaying).toBe(false);
    clock.advance(1000);
    expect(engine.time).toBeCloseTo(1, 6);
    engine.play(); // resumes from where it stopped
    clock.advance(500);
    expect(engine.time).toBeCloseTo(1.5, 6);
  });

  it("setSpeed(5|20) runs 5×/20× faster from the moment it's set", () => {
    const { clock, engine } = playing();
    engine.play();
    clock.advance(200);
    engine.setSpeed(20);
    clock.advance(1000);
    expect(engine.time).toBeCloseTo(0.2 + 20, 6);
    engine.setSpeed(5);
    clock.advance(1000);
    expect(engine.time).toBeCloseTo(25.2, 6);
    engine.setSpeed(7 as never); // invalid → 1×
    expect(engine.currentSpeed).toBe(1);
  });

  it("falls behind gracefully instead of bursting when the thread stalls", () => {
    const { clock, engine } = playing();
    engine.play();
    clock.advance(100);
    const stalled = { now: clock.now() };
    // one late slice after a 10 s stall: no 200-tick burst, the clock re-anchors
    (clock as unknown as { now: () => number }).now = () => stalled.now + 10_000;
    clock.advance(20);
    expect(engine.time).toBeLessThan(10);
  });

  it("reset rewinds to 0, clears history, keeps graph/speed/pattern and reproduces the run", () => {
    const { clock, engine } = playing(SPIKE);
    engine.setSpeed(5);
    const seen: TickSnapshot[] = [];
    engine.onTick((s) => seen.push(s));
    engine.play();
    clock.advance(1000);
    expect(engine.history.size).toBe(5 * TICKS_PER_SEC);
    const firstRun = seen.slice();
    engine.reset();
    expect(engine.isPlaying).toBe(false);
    expect(engine.time).toBe(0);
    expect(engine.history.size).toBe(0);
    expect(engine.currentSpeed).toBe(5);
    expect(engine.currentPattern).toEqual(SPIKE);
    seen.length = 0;
    engine.play();
    clock.advance(1000);
    expect(seen).toEqual(firstRun);
  });

  it("setTraffic changes the load on the very next tick; a new kind restarts the pattern clock", () => {
    const { engine } = playing({ kind: "constant", rps: 1000 });
    engine.step(TICKS_PER_SEC * 20);
    engine.setTraffic({ kind: "constant", rps: 1_000_000 });
    const next = engine.step(1)!;
    // Poisson(50 000) per tick: within 2%
    expect(next.offeredRps).toBeGreaterThan(980_000);
    expect(next.offeredRps).toBeLessThan(1_020_000);

    // switching to a spike starting at 10 s counts from now (t = 20.05), not from 0
    engine.setTraffic({ ...SPIKE, baseRps: 100, multiplier: 100 });
    expect(engine.patternTime).toBe(0);
    expect(engine.currentRate()).toBe(100);
    engine.step(TICKS_PER_SEC * 10);
    expect(engine.currentRate()).toBe(10_000);
    // editing the same kind keeps its clock
    engine.setTraffic({ ...SPIKE, baseRps: 200, multiplier: 100 });
    expect(engine.patternTime).toBeCloseTo(10, 6);
    expect(engine.currentRate()).toBe(rateAt({ ...SPIKE, baseRps: 200, multiplier: 100 }, 10));
  });

  it("keeps a ring buffer of HISTORY_TICKS ticks", () => {
    const { engine } = playing();
    engine.step(HISTORY_TICKS + 25);
    expect(engine.history.size).toBe(HISTORY_TICKS);
    expect(engine.history.last()!.t).toBeCloseTo((HISTORY_TICKS + 25) * TICK_SEC, 6);
  });

  it("hot-swapping the graph keeps the clock and surviving backlogs", () => {
    const { engine } = playing({ kind: "constant", rps: 3000 });
    engine.step(TICKS_PER_SEC * 5);
    const backlog = engine.history.last()!.nodes.app.queueDepth;
    expect(backlog).toBeGreaterThan(5000);
    // scale out mid-run: 4 instances drain the backlog
    const scaled = compileV3(
      [
        comp("lb", "load-balancer", { maxRetries: 0 }),
        comp("app", "app-server", {
          instances: 4,
          capacityPerInstance: 1000,
          serviceTimeMs: 20,
          maxQueue: 1_000_000,
          maxRetries: 0,
        }),
      ],
      [wire("lb", "app")],
    );
    engine.load(scaled);
    const after = engine.step(1)!;
    expect(after.t).toBeCloseTo(5.05, 6);
    expect(after.nodes.app.queueDepth).toBeGreaterThan(backlog - 1000);
    expect(after.nodes.app.rpsOut).toBeCloseTo(4000, 0);
    engine.step(TICKS_PER_SEC * 20);
    expect(engine.history.last()!.nodes.app.queueDepth).toBeLessThan(10);
  });

  it("play() and inject() need a graph; healing an unknown fault is a no-op", () => {
    const engine = new FlowEngine();
    expect(() => engine.play()).toThrow(/load/);
    expect(() => engine.inject({ type: "traffic-spike", target: { kind: "global" } })).toThrow(
      /load/,
    );
    expect(() => engine.heal("x")).not.toThrow();
  });
});

describe("SimSession streaming", () => {
  it("throttles frames to 10 Hz, flushes on pause and drops nothing after reset", () => {
    const clock = manualClock();
    const session = createSimSession({ clock, tickSamples: 10 });
    const frames: SimFrame[] = [];
    session.subscribe((f) => frames.push(f));
    session.load(overloadGraph());
    session.setTraffic({ kind: "constant", rps: 500 });
    session.reset(1);
    session.setSpeed(20);
    session.play();
    clock.advance(1000);
    // 50 slices of 20 ms → one frame per 100 ms
    expect(frames.length).toBeGreaterThanOrEqual(9);
    expect(frames.length).toBeLessThanOrEqual(11);
    expect(frames.every((f) => f.generation === 1)).toBe(true);
    session.pause();
    const last = frames.at(-1)!;
    expect(last.snapshot.t).toBeCloseTo(20, 6); // the exact paused state
    session.reset(2);
    session.play();
    clock.advance(200);
    expect(frames.at(-1)!.generation).toBe(2);
    expect(frames.at(-1)!.snapshot.t).toBeLessThan(5);
    session.dispose();
  });
});
