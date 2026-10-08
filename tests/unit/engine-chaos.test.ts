import { describe, expect, it } from "vitest";
import { GENERIC_DRILL_QA } from "@/data/interviewData";
import { compileGraph, type SimGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { FlowEngine } from "@/engine/engine";
import { analyzeUnderFault } from "@/engine/faults/steady";
import { edgeTargets, FAULT_CATALOG, getFaultType, nodeTargets } from "@/engine/faults/catalog";
import { compileFault } from "@/engine/faults/compile";
import { effectsAt } from "@/engine/faults/effects";
import { BLAST_TAIL_SEC, FaultError } from "@/engine/faults/runner";
import type { CompiledModifier, FaultSpec } from "@/engine/faults/types";
import { TICK_SEC } from "@/engine/traffic/types";
import type { TickSnapshot } from "@/engine/types";
import type { Edge } from "@xyflow/react";
import type { EdgeCall } from "@/domain/components/types";
import { comp, wire } from "./engineFixtures";

const TICKS_PER_SEC = Math.round(1 / TICK_SEC);
const RPS = 1500;

/**
 * LB (health check 5 s × 2 = 10 s) → App ×4 (1000 rps each)
 *   App → Cache (hit 80%) → DB on miss      (reads)
 *   App → DB (writes: 10% of requests)
 *   App → Queue → Workers                    (async consumers)
 */
function shop(dbInstances = 2): SimGraph {
  return compileGraph(
    [
      comp("lb", "load-balancer", { healthCheckIntervalSec: 5, unhealthyThreshold: 2 }),
      comp("app", "app-server", {
        instances: 4,
        capacityPerInstance: 1000,
        serviceTimeMs: 20,
        maxRetries: 0,
        timeoutMs: 1000,
      }),
      comp("cache", "cache", { instances: 2, capacityPerInstance: 50_000, hitRate: 0.8 }),
      comp("db", "sql-db", {
        instances: dbInstances,
        capacityPerInstance: 5000,
        failoverSec: 10,
      }),
      comp("q", "message-queue", { consumers: 4 }),
      comp("wk", "worker-pool", { instances: 4, capacityPerInstance: 1000 }),
    ],
    [
      wire("lb", "app"),
      wire("app", "cache"),
      wire("cache", "db", { sourceComponent: "cache" }),
      wire("app", "db", { rule: { kind: "writes" } }),
      wire("app", "q"),
      wire("q", "wk"),
    ],
  );
}

/**
 * DNS (10% fresh lookups) → LB (health check 5 s × 2) → App A, App B → DB:
 * what `shop()` lacks for the CHS-03 faults (a resolver, an LB with two targets).
 */
function wide(): SimGraph {
  return compileGraph(
    [
      comp("dns", "dns", { lookupShare: 0.1, capacityPerInstance: 100_000 }),
      comp("lb", "load-balancer", { healthCheckIntervalSec: 5, unhealthyThreshold: 2 }),
      comp("a", "app-server", { instances: 2, capacityPerInstance: 1000, maxRetries: 0 }),
      comp("b", "app-server", { instances: 2, capacityPerInstance: 1000, maxRetries: 0 }),
      comp("db", "sql-db", { instances: 2, capacityPerInstance: 5000 }),
    ],
    [wire("dns", "lb"), wire("lb", "a"), wire("lb", "b"), wire("a", "db"), wire("b", "db")],
  );
}

function engineFor(graph: SimGraph = shop()): FlowEngine {
  const engine = new FlowEngine({ tickSamples: 200 });
  engine.load(graph, { seed: 11 });
  engine.setTraffic({ kind: "constant", rps: RPS });
  return engine;
}

function run(engine: FlowEngine, seconds: number): TickSnapshot[] {
  const out: TickSnapshot[] = [];
  const off = engine.onTick((s) => out.push(s));
  engine.step(Math.round(seconds * TICKS_PER_SEC));
  off();
  return out;
}

const mean = (snaps: TickSnapshot[], f: (s: TickSnapshot) => number) =>
  snaps.reduce((s, x) => s + f(x), 0) / snaps.length;

/** Warm up 5 s, then average `metric` over the next 2 s. */
function baseline(engine: FlowEngine, metric: (s: TickSnapshot) => number): number {
  run(engine, 5);
  return mean(run(engine, 2), metric);
}

const errorRate = (s: TickSnapshot) => s.global.errorRate;

describe("fault catalog", () => {
  it("has one entry per FaultType (the drill's Record<FaultType> is the full list), valid ranges", () => {
    const types = FAULT_CATALOG.map((f) => f.type);
    expect(new Set(types).size).toBe(types.length);
    // GENERIC_DRILL_QA must cover every FaultType to compile: a type added
    // without a catalog entry (or an entry left behind) fails here.
    expect(new Set(types)).toEqual(new Set(Object.keys(GENERIC_DRILL_QA)));
    for (const f of FAULT_CATALOG) {
      expect(f.targets.length).toBeGreaterThan(0);
      if (f.intensity) {
        expect(f.intensity.min).toBeLessThanOrEqual(f.intensity.default);
        expect(f.intensity.default).toBeLessThanOrEqual(f.intensity.max);
      }
    }
  });

  it("filters targets by type", () => {
    const g = shop();
    const ids = (type: string) => nodeTargets(getFaultType(type)!, g).map((n) => n.id);
    expect(ids("cache-flush")).toEqual(["cache"]);
    expect(ids("db-primary-failure")).toEqual(["db"]);
    expect(ids("consumer-stopped")).toEqual(["wk"]);
    expect(ids("traffic-spike")).toEqual(["lb"]);
    expect(ids("kill-node")).toHaveLength(6);
    expect(edgeTargets(getFaultType("partition")!, g)).toHaveLength(6);
    expect(edgeTargets(getFaultType("kill-node")!, g)).toHaveLength(0);
  });
});

describe("compileFault", () => {
  const ctx = { graph: shop(), readRatio: 0.9 };

  it("is pure: same spec + graph + start → same modifiers", () => {
    for (const f of FAULT_CATALOG) {
      const hasTarget = (g: SimGraph) =>
        f.targets.includes("global") ||
        nodeTargets(f, g).length > 0 ||
        edgeTargets(f, g).length > 0;
      const make = hasTarget(shop()) ? shop : wide;
      const graph = make();
      const target: FaultSpec["target"] = f.targets.includes("global")
        ? { kind: "global" }
        : f.targets.includes("edge")
          ? { kind: "edge", id: edgeTargets(f, graph)[0].id }
          : { kind: "node", id: nodeTargets(f, graph)[0].id };
      const spec: FaultSpec = { type: f.type, target, durationSec: 30 };
      const a = compileFault(spec, 12.5, { ...ctx, graph });
      const b = compileFault(structuredClone(spec), 12.5, { ...ctx, graph: make() });
      expect(a.ok, f.type).toBe(true);
      expect(a).toEqual(b);
    }
  });

  it("rejects unknown types, wrong target kinds and ineligible targets", () => {
    const bad = (spec: unknown) => compileFault(spec as FaultSpec, 0, ctx);
    expect(bad({ type: "meteor", target: { kind: "global" } }).ok).toBe(false);
    expect(bad({ type: "kill-node", target: { kind: "global" } }).ok).toBe(false);
    expect(bad({ type: "kill-node", target: { kind: "node", id: "ghost" } }).ok).toBe(false);
    expect(bad({ type: "cache-flush", target: { kind: "node", id: "app" } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/cache/i),
    });
    expect(bad({ type: "partition", target: { kind: "edge", id: "e-x-y" } }).ok).toBe(false);
  });

  it("clamps intensity, sets the auto-heal end and keeps modifier windows inside it", () => {
    const r = compileFault(
      { type: "slow-node", target: { kind: "node", id: "app" }, intensity: 1e9, durationSec: 20 },
      5,
      ctx,
    );
    expect(r.ok && r.spec.intensity).toBe(getFaultType("slow-node")!.intensity!.max);
    expect(r.ok && r.endT).toBe(25);
    const manual = compileFault(
      { type: "slow-node", target: { kind: "node", id: "app" }, durationSec: 20, autoHeal: false },
      5,
      ctx,
    );
    expect(manual.ok && manual.endT).toBeUndefined();
    const kill = compileFault(
      { type: "kill-instances", target: { kind: "node", id: "app" }, intensity: 2, durationSec: 4 },
      0,
      ctx,
    );
    // The 10 s detection window is clipped by the 4 s fault.
    expect(kill.ok && kill.modifiers.every((m) => (m.endT ?? Infinity) <= 4)).toBe(true);
  });
});

describe("effectsAt", () => {
  const m = (over: Partial<CompiledModifier>): CompiledModifier => ({
    kind: "capacityMultiplier",
    targetIds: ["a"],
    value: 0.5,
    startT: 0,
    ...over,
  });

  it("is null with nothing active and folds overlapping modifiers", () => {
    expect(effectsAt([m({ startT: 5 })], 1)).toBeNull();
    expect(effectsAt([m({ endT: 1 })], 1)).toBeNull();
    const fx = effectsAt(
      [
        m({}),
        m({ value: 0.5 }),
        m({ kind: "errorRate", value: 0.5 }),
        m({ kind: "errorRate", value: 0.5 }),
        m({ kind: "trafficMultiplier", targetIds: [], value: 2 }),
        m({ kind: "trafficMultiplier", targetIds: [], value: 3 }),
        m({ kind: "latencyAddMs", targetIds: ["e"], onEdges: true, value: 10 }),
        m({ kind: "latencyAddMs", targetIds: ["e"], onEdges: true, value: 5 }),
      ],
      0,
    )!;
    expect(fx.nodes.get("a")).toMatchObject({ capacity: 0.25, errorRate: 0.75 });
    expect(fx.traffic).toBe(6);
    expect(fx.edges.get("e")!.latencyAddMs).toBe(15);
  });

  it("recovers an overridden hit rate as h(t) = h(1 − e^(−t/τ))", () => {
    const flush = m({
      kind: "hitRateOverride",
      value: 0,
      startT: 10,
      recover: { to: 0.9, tauSec: 20 },
    });
    expect(effectsAt([flush], 10)!.nodes.get("a")!.hitRate).toBeCloseTo(0, 9);
    expect(effectsAt([flush], 30)!.nodes.get("a")!.hitRate).toBeCloseTo(
      0.9 * (1 - Math.exp(-1)),
      9,
    );
  });
});

describe("chaos in the tick loop (each MVP fault: baseline → inject → heal → baseline)", () => {
  it("kill node: every request fails while it's down, then recovers", () => {
    const engine = engineFor();
    expect(baseline(engine, errorRate)).toBeLessThan(0.01);
    const id = engine.inject({ type: "kill-node", target: { kind: "node", id: "app" } });
    const during = run(engine, 2);
    expect(mean(during, errorRate)).toBeGreaterThan(0.99);
    expect(during.at(-1)!.nodes.app.status).toBe("down");
    engine.heal(id);
    run(engine, 3);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("kill instances behind an LB: errors during the health check window, none after", () => {
    const engine = engineFor();
    const util = baseline(engine, (s) => s.nodes.app.utilization);
    const id = engine.inject({
      type: "kill-instances",
      target: { kind: "node", id: "app" },
      intensity: 2,
    });
    const detecting = run(engine, 10);
    // Half the app's requests hit the dead instances until the LB notices (5 s × 2).
    expect(mean(detecting.slice(5), errorRate)).toBeGreaterThan(0.4);
    const after = run(engine, 5);
    expect(mean(after.slice(20), errorRate)).toBe(0);
    expect(mean(after.slice(20), (s) => s.nodes.app.utilization)).toBeGreaterThan(util * 1.8);
    engine.heal(id);
    run(engine, 3);
    expect(mean(run(engine, 2), (s) => s.nodes.app.utilization)).toBeCloseTo(util, 1);
  });

  it("kill node behind an LB with a second target: routed around after the health check", () => {
    const g = compileGraph(
      [
        comp("lb", "load-balancer", { healthCheckIntervalSec: 5, unhealthyThreshold: 2 }),
        comp("a", "app-server", { instances: 2, capacityPerInstance: 1000, maxRetries: 0 }),
        comp("b", "app-server", { instances: 2, capacityPerInstance: 1000, maxRetries: 0 }),
      ],
      [wire("lb", "a"), wire("lb", "b")],
    );
    const engine = engineFor(g);
    baseline(engine, errorRate);
    engine.inject({ type: "kill-node", target: { kind: "node", id: "a" } });
    expect(mean(run(engine, 9), errorRate)).toBeGreaterThan(0.45);
    const routed = run(engine, 3).slice(20);
    expect(mean(routed, errorRate)).toBe(0);
    expect(mean(routed, (s) => s.nodes.b.rpsIn)).toBeGreaterThan(RPS * 0.95);
  });

  it("slow node (grey failure): p99 rises without errors, then returns", () => {
    const engine = engineFor();
    const p99 = baseline(engine, (s) => s.global.p99);
    const id = engine.inject({
      type: "slow-node",
      target: { kind: "node", id: "app" },
      intensity: 5,
    });
    const during = run(engine, 3);
    expect(mean(during, (s) => s.global.p99)).toBeGreaterThan(p99 * 2);
    engine.heal(id);
    run(engine, 5);
    expect(mean(run(engine, 2), (s) => s.global.p99)).toBeLessThan(p99 * 1.3);
  });

  it("traffic spike: offered load ×N while active, auto-heals after its duration", () => {
    const engine = engineFor();
    const offered = baseline(engine, (s) => s.offeredRps);
    engine.inject({
      type: "traffic-spike",
      target: { kind: "global" },
      intensity: 3,
      durationSec: 2,
    });
    const spiked = mean(run(engine, 2), (s) => s.offeredRps);
    expect(Math.abs(spiked / (offered * 3) - 1)).toBeLessThan(0.05);
    expect(engine.faults[0]).toMatchObject({ active: false, endT: expect.closeTo(9, 6) });
    const after = mean(run(engine, 2), (s) => s.offeredRps);
    expect(Math.abs(after / offered - 1)).toBeLessThan(0.05);
  });

  it("latency on a link: end-to-end latency grows by the round trip, then returns", () => {
    const engine = engineFor();
    const p50 = baseline(engine, (s) => s.global.p50);
    const id = engine.inject({
      type: "edge-latency",
      target: { kind: "edge", id: "e-lb-app" },
      intensity: 300,
    });
    expect(mean(run(engine, 2), (s) => s.global.p50)).toBeGreaterThan(p50 + 550);
    engine.heal(id);
    expect(mean(run(engine, 2), (s) => s.global.p50)).toBeLessThan(p50 + 20);
  });

  it("packet loss: calls on the link fail (no retries), then recover", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({
      type: "packet-loss",
      target: { kind: "edge", id: "e-app-cache" },
      intensity: 0.5,
    });
    expect(mean(run(engine, 2), errorRate)).toBeGreaterThan(0.4);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("partition: the target gets nothing over the link and every call fails", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({ type: "partition", target: { kind: "edge", id: "e-app-cache" } });
    const during = run(engine, 2);
    expect(mean(during, errorRate)).toBeGreaterThan(0.99);
    expect(mean(during, (s) => s.nodes.cache.rpsIn)).toBe(0);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("cache flush: every read misses to the DB, then the hit rate warms back", () => {
    const engine = engineFor();
    const dbIn = baseline(engine, (s) => s.nodes.db.rpsIn);
    engine.inject({ type: "cache-flush", target: { kind: "node", id: "cache" }, intensity: 4 });
    const first = run(engine, 0.5);
    // Hit rate ≈ 0: the DB sees all 1500 reads + the writes instead of 20%.
    expect(mean(first, (s) => s.nodes.db.rpsIn)).toBeGreaterThan(dbIn * 3);
    expect(first[0].nodes.cache.extra?.hitRatio).toBeLessThan(0.05);
    run(engine, 5 * 4); // 5τ: auto-healed
    expect(engine.faults[0].active).toBe(false);
    expect(mean(run(engine, 2), (s) => s.nodes.db.rpsIn)).toBeLessThan(dbIn * 1.1);
  });

  it("DB primary failure: writes fail until the failover, then the standby serves", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({ type: "db-primary-failure", target: { kind: "node", id: "db" } });
    const failingOver = run(engine, 9);
    // Writes are 10% of requests (read ratio 0.9).
    expect(mean(failingOver, errorRate)).toBeGreaterThan(0.07);
    expect(mean(failingOver, errorRate)).toBeLessThan(0.13);
    expect(mean(run(engine, 3).slice(20), errorRate)).toBeLessThan(0.005);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.005);
  });

  it("DB primary failure with a single instance: down until healed", () => {
    const engine = engineFor(shop(1));
    baseline(engine, errorRate);
    const id = engine.inject({ type: "db-primary-failure", target: { kind: "node", id: "db" } });
    const during = run(engine, 12);
    expect(during.at(-1)!.nodes.db.status).toBe("down");
    expect(mean(during.slice(-20), errorRate)).toBeGreaterThan(0.2);
    engine.heal(id);
    run(engine, 2);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("consumer stopped: queue lag grows, then drains after the heal", () => {
    const engine = engineFor();
    const depth = baseline(engine, (s) => s.nodes.q.queueDepth);
    const id = engine.inject({ type: "consumer-stopped", target: { kind: "node", id: "wk" } });
    const during = run(engine, 3);
    expect(during.at(-1)!.nodes.q.queueDepth).toBeGreaterThan(RPS * 2.5);
    expect(during.at(-1)!.nodes.q.status).toBe("critical");
    // The user path doesn't wait on the queue's consumers.
    expect(mean(during, errorRate)).toBeLessThan(0.01);
    engine.heal(id);
    run(engine, 5);
    expect(mean(run(engine, 2), (s) => s.nodes.q.queueDepth)).toBeLessThanOrEqual(depth + 1);
  });
});

describe("FlowEngine faults", () => {
  it("records the timeline, applies from the next tick and never edits the graph", () => {
    const graph = shop();
    const before = structuredClone(graph);
    const engine = engineFor(graph);
    run(engine, 1);
    const id = engine.inject({
      type: "slow-node",
      target: { kind: "node", id: "app" },
      durationSec: 1,
    });
    expect(engine.faults).toEqual([
      expect.objectContaining({
        id,
        active: true,
        startT: 1,
        endT: 2,
        label: "Slow node (grey failure) · app",
      }),
    ]);
    const v = engine.faultVersion;
    run(engine, 2);
    expect(engine.faults[0]).toMatchObject({ active: false, endT: 2 });
    expect(engine.faultVersion).toBeGreaterThan(v);
    expect(graph).toEqual(before);
  });

  it("same graph + seed + fault calls → bit-identical snapshots", () => {
    const play = () => {
      const engine = engineFor();
      run(engine, 1);
      engine.inject({
        type: "packet-loss",
        target: { kind: "edge", id: "e-app-cache" },
        intensity: 0.3,
      });
      run(engine, 1);
      engine.inject({ type: "traffic-spike", target: { kind: "node", id: "lb" }, intensity: 2 });
      return run(engine, 2);
    };
    expect(play()).toEqual(play());
  });

  it("marks the blast radius and clears it once recovered", () => {
    const engine = engineFor();
    run(engine, 3);
    expect(engine.history.last()!.nodes.app.blast).toBeUndefined();
    const id = engine.inject({ type: "kill-node", target: { kind: "node", id: "cache" } });
    const hit = run(engine, 1).at(-1)!;
    expect(hit.nodes.cache.blast).toBe("target");
    expect(hit.nodes.app.blast).toBe("affected"); // its calls to the cache fail
    expect(hit.nodes.lb.blast).toBe("affected");
    expect(hit.nodes.wk.blast).toBeUndefined();
    expect(hit.edges["e-app-cache"].blast).toBe("affected");
    engine.heal(id);
    const healed = run(engine, 3).at(-1)!;
    expect(Object.values(healed.nodes).every((n) => n.blast === undefined)).toBe(true);
    expect(BLAST_TAIL_SEC).toBeGreaterThan(3);
  });

  it("reset clears faults; a hot-swapped graph heals faults whose target left", () => {
    const engine = engineFor();
    run(engine, 1);
    engine.inject({ type: "kill-node", target: { kind: "node", id: "wk" } });
    engine.load(
      compileGraph([comp("lb", "load-balancer"), comp("app", "app-server")], [wire("lb", "app")]),
    );
    expect(engine.faults[0]).toMatchObject({ active: false });
    expect(engine.faults[0].notes.join(" ")).toMatch(/left the design/);
    engine.reset();
    expect(engine.faults).toEqual([]);
    expect(() =>
      engine.inject({ type: "cache-flush", target: { kind: "node", id: "app" } }),
    ).toThrow(FaultError);
  });
});

describe("faults that fail writes: write share per call (request-flow)", () => {
  const callWire = (source: string, target: string, calls: EdgeCall[]): Edge => ({
    id: `e-${source}-${target}`,
    source,
    target,
    data: { protocol: "http", async: false, rule: { calls, networkLatencyMs: 1, packetLoss: 0 } },
  });
  const call = (kind: EdgeCall["kind"], extra: Partial<EdgeCall> = {}): EdgeCall => ({
    kind,
    callsPerRequest: 1,
    ...extra,
  });
  /** The error rate disk-full puts on each edge into the database, by edge source. */
  function diskFullShares(edges: Edge[]): Record<string, number> {
    const graph = compileGraph(
      [
        comp("client", "client"),
        comp("svc", "app-server", { instances: 10 }),
        comp("redis", "cache", { hitRate: 0.9 }),
        comp("worker", "worker-pool"),
        comp("db", "sql-db", { instances: 2 }),
      ],
      edges,
    );
    const fault = compileFault({ type: "disk-full", target: { kind: "node", id: "db" } }, 0, {
      graph,
      readRatio: 0.9,
    });
    if (!fault.ok) throw new Error(fault.error);
    const out: Record<string, number> = {};
    for (const m of fault.modifiers) {
      if (m.kind !== "errorRate" || !m.onEdges) continue;
      for (const id of m.targetIds) {
        out[graph.edges.find((e) => e.id === id)!.source] = m.value;
      }
    }
    return out;
  }

  it("writes + reads after a miss: (1 − r) / ((1 − r) + P(after miss))", () => {
    const shares = diskFullShares([
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
    ]);
    // P(after miss) = r × (1 − h) = 0.9 × 0.1
    expect(shares.svc).toBeCloseTo(0.1 / (0.1 + 0.09), 12);
  });

  it("each call weighs by its calls per request: writes ×2 + reads after a miss ×1", () => {
    const shares = diskFullShares([
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [
        call("writes", { callsPerRequest: 2 }),
        call("after_miss", { missOf: "redis" }),
      ]),
    ]);
    // 2(1 − r) / (2(1 − r) + r(1 − h)), r = 0.9, h = 0.9
    const r = 0.9;
    const h = 0.9;
    const expected = (2 * (1 - r)) / (2 * (1 - r) + r * (1 - h));
    expect(Math.abs(shares.svc - expected)).toBeLessThan(1e-9);
    expect(shares.svc).not.toBeCloseTo((1 - r) / (1 - r + r * (1 - h)), 3); // k matters
  });

  it("an edge with one call keeps the write share it had (writes 1, reads 0, always 1 − r)", () => {
    const shares = diskFullShares([
      wire("client", "svc"),
      callWire("svc", "db", [call("writes")]),
      callWire("worker", "db", [call("always")]),
      callWire("redis", "db", [call("on_miss")]),
    ]);
    expect(shares.svc).toBe(1);
    expect(shares.worker).toBe(1 - 0.9);
    expect(shares.redis).toBeUndefined(); // read-through misses are reads: no error
    const reads = diskFullShares([wire("client", "svc"), callWire("svc", "db", [call("reads")])]);
    expect(reads.svc).toBeUndefined();
  });
});

describe("analyzeUnderFault (Spec 09 scoring)", () => {
  it("reads the fault after its transients: an LB routes around dead instances", () => {
    const g = shop();
    const base = analyze(g, RPS);
    const r = analyzeUnderFault(g, RPS, {
      type: "kill-instances",
      target: { kind: "node", id: "app" },
      intensity: 2,
      durationSec: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Past the health-check window: no errors, twice the utilization.
    expect(r.steady.errorRate).toBeLessThan(0.01);
    const util = (s: typeof base) => s.nodes.find((n) => n.nodeId === "app")!.utilization;
    expect(util(r.steady)).toBeCloseTo(util(base) * 2, 5);
  });

  it("a dead single target fails every request; a spike multiplies the offered load", () => {
    const g = shop();
    const down = analyzeUnderFault(g, RPS, {
      type: "kill-node",
      target: { kind: "node", id: "app" },
    });
    expect(down.ok && down.steady.errorRate).toBeGreaterThan(0.99);
    const spike = analyzeUnderFault(g, RPS, {
      type: "traffic-spike",
      target: { kind: "global" },
      intensity: 3,
      durationSec: 30,
    });
    expect(spike.ok && spike.steady.offeredRps).toBeCloseTo(RPS * 3, 6);
  });

  it("a DB primary failure with a standby: writes are back after the failover", () => {
    const r = analyzeUnderFault(shop(), RPS, {
      type: "db-primary-failure",
      target: { kind: "node", id: "db" },
      durationSec: 90,
    });
    expect(r.ok && r.steady.errorRate).toBeLessThan(0.01);
  });

  it("rejects a fault that can't apply", () => {
    expect(
      analyzeUnderFault(shop(), RPS, { type: "cache-flush", target: { kind: "node", id: "app" } })
        .ok,
    ).toBe(false);
  });

  it("analyze() without effects is unchanged", () => {
    const g = shop();
    expect(analyze(g, RPS, { seed: 5 }, null)).toEqual(analyze(g, RPS, { seed: 5 }));
  });
});

describe("DNS resolver (lookupShare)", () => {
  const dnsGraph = (share: number) =>
    compileGraph(
      [
        comp("dns", "dns", { lookupShare: share, capacityPerInstance: 1000, serviceTimeMs: 20 }),
        comp("app", "app-server", { instances: 10, capacityPerInstance: 5000, serviceTimeMs: 5 }),
      ],
      [wire("dns", "app")],
    );

  it("only the uncached share loads the resolver and pays its lookup time", () => {
    const cached = analyze(dnsGraph(0.01), 10_000);
    const uncached = analyze(dnsGraph(1), 10_000);
    const dns = (s: typeof cached) => s.nodes.find((n) => n.nodeId === "dns")!;
    // 1% of 10k = 100 lookups/s on a 1000/s resolver; all 10k would overload it.
    expect(dns(cached).utilization).toBeCloseTo(0.1, 6);
    expect(dns(uncached).utilization).toBeGreaterThan(1);
    // Every request still reaches the app.
    expect(cached.nodes.find((n) => n.nodeId === "app")!.offeredRps).toBeCloseTo(10_000, 6);
    expect(cached.errorRate).toBe(0);
    // p50 no longer includes the 20 ms lookup.
    expect(cached.latency.p50Ms).toBeLessThan(10);
  });

  it("the tick loop agrees: traffic passes, the resolver sees only lookups", () => {
    const engine = new FlowEngine({ tickSamples: 100 });
    engine.load(dnsGraph(0.01), { seed: 3 });
    engine.setTraffic({ kind: "constant", rps: 10_000 });
    const snaps = run(engine, 3);
    expect(mean(snaps, (s) => s.nodes.app.rpsIn)).toBeGreaterThan(9_000);
    expect(mean(snaps, (s) => s.nodes.dns.utilization)).toBeLessThan(0.2);
  });
});

describe("CHS-03 faults in the tick loop (baseline → inject → heal → baseline)", () => {
  it("zone outage: every tier loses ⌈n/zones⌉ instances; a single-instance tier is down", () => {
    const g = compileGraph(
      [
        comp("lb", "load-balancer", { healthCheckIntervalSec: 1, unhealthyThreshold: 1 }),
        comp("app", "app-server", { instances: 3, capacityPerInstance: 1000, maxRetries: 0 }),
        comp("db", "sql-db", { instances: 1, capacityPerInstance: 5000 }),
      ],
      [wire("lb", "app"), wire("app", "db")],
    );
    const engine = engineFor(g);
    const util = baseline(engine, (s) => s.nodes.app.utilization);
    const id = engine.inject({ type: "zone-failure", target: { kind: "global" }, intensity: 3 });
    const during = run(engine, 3);
    expect(during.at(-1)!.nodes.db.status).toBe("down");
    expect(mean(during, errorRate)).toBeGreaterThan(0.99);
    expect(engine.faults[0].notes.join(" ")).toContain("db");
    engine.heal(id);
    run(engine, 3);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
    expect(mean(run(engine, 2), (s) => s.nodes.app.utilization)).toBeCloseTo(util, 1);
  });

  it("zone outage with redundant tiers: survivors carry it after the health check", () => {
    const g = compileGraph(
      [
        comp("lb", "load-balancer", {
          instances: 2,
          healthCheckIntervalSec: 5,
          unhealthyThreshold: 2,
        }),
        comp("app", "app-server", { instances: 4, capacityPerInstance: 1000, maxRetries: 0 }),
        comp("db", "sql-db", { instances: 2, capacityPerInstance: 5000 }),
      ],
      [wire("lb", "app"), wire("app", "db")],
    );
    const engine = engineFor(g);
    const util = baseline(engine, (s) => s.nodes.app.utilization);
    engine.inject({ type: "zone-failure", target: { kind: "global" }, intensity: 2 });
    run(engine, 12); // the LB's health check (5 s × 2) routes around the dead half
    const after = run(engine, 2);
    expect(mean(after, errorRate)).toBeLessThan(0.01);
    // App 4 → 2 instances: twice the utilization.
    expect(mean(after, (s) => s.nodes.app.utilization)).toBeGreaterThan(util * 1.8);
  });

  it("memory leak: latency climbs in steps, then the node crashes until healed", () => {
    const engine = engineFor();
    const p99 = baseline(engine, (s) => s.nodes.app.p99);
    const id = engine.inject({
      type: "memory-leak",
      target: { kind: "node", id: "app" },
      intensity: 20,
    });
    const early = run(engine, 4);
    const late = run(engine, 14);
    expect(mean(late, (s) => s.nodes.app.p99)).toBeGreaterThan(mean(early, (s) => s.nodes.app.p99));
    expect(mean(late, (s) => s.nodes.app.p99)).toBeGreaterThan(p99 * 1.5);
    const crashed = run(engine, 3);
    expect(crashed.at(-1)!.nodes.app.status).toBe("down");
    engine.heal(id);
    run(engine, 3);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("thread pool exhausted: the node queues without errors from health checks", () => {
    const engine = engineFor();
    const util = baseline(engine, (s) => s.nodes.app.utilization);
    const id = engine.inject({
      type: "thread-pool-exhausted",
      target: { kind: "node", id: "app" },
      intensity: 0.75,
    });
    const during = run(engine, 2);
    expect(mean(during, (s) => s.nodes.app.utilization)).toBeGreaterThan(util * 3.5);
    engine.heal(id);
    run(engine, 8);
    expect(mean(run(engine, 2), (s) => s.nodes.app.utilization)).toBeCloseTo(util, 1);
  });

  it("transient errors: the share fails; a caller's retries multiply the load on it", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({
      type: "transient-errors",
      target: { kind: "node", id: "app" },
      intensity: 0.3,
    });
    expect(mean(run(engine, 2), errorRate)).toBeCloseTo(0.3, 1);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);

    // With 3 retries on the caller, the target sees λ(1 − f⁴)/(1 − f) ≈ 1.42 λ.
    const g = compileGraph(
      [
        comp("api", "api-gateway", { instances: 4, capacityPerInstance: 10_000, maxRetries: 3 }),
        comp("app", "app-server", { instances: 4, capacityPerInstance: 1000 }),
      ],
      [wire("api", "app")],
    );
    const retrying = engineFor(g);
    const load = baseline(retrying, (s) => s.nodes.app.rpsIn);
    retrying.inject({
      type: "transient-errors",
      target: { kind: "node", id: "app" },
      intensity: 0.3,
    });
    run(retrying, 1);
    expect(mean(run(retrying, 2), (s) => s.nodes.app.rpsIn) / load).toBeCloseTo(1.42, 1);
  });

  it("disk full: writes fail, reads are served", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({ type: "disk-full", target: { kind: "node", id: "db" } });
    const during = mean(run(engine, 2), errorRate);
    // Writes are 10% of requests; the cache's misses (reads) still work.
    expect(during).toBeGreaterThan(0.08);
    expect(during).toBeLessThan(0.12);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("IOPS throttled: the node does a fraction of its work", () => {
    const engine = engineFor();
    const util = baseline(engine, (s) => s.nodes.db.utilization);
    const id = engine.inject({
      type: "iops-throttle",
      target: { kind: "node", id: "db" },
      intensity: 0.25,
    });
    expect(mean(run(engine, 2), (s) => s.nodes.db.utilization)).toBeCloseTo(util * 4, 1);
    engine.heal(id);
    run(engine, 2);
    expect(mean(run(engine, 2), (s) => s.nodes.db.utilization)).toBeCloseTo(util, 2);
  });

  it("deadlocks: a share of the writes is aborted", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({
      type: "deadlock",
      target: { kind: "node", id: "db" },
      intensity: 0.5,
    });
    // Half of the writes (10% of requests) fail.
    expect(mean(run(engine, 2), errorRate)).toBeCloseTo(0.05, 1);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("TLS certificate expired: every call to the node fails", () => {
    const engine = engineFor();
    baseline(engine, errorRate);
    const id = engine.inject({ type: "tls-expired", target: { kind: "node", id: "app" } });
    expect(mean(run(engine, 2), errorRate)).toBeGreaterThan(0.99);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
  });

  it("DNS outage: only requests that need a fresh lookup fail", () => {
    const engine = engineFor(wide());
    baseline(engine, errorRate);
    const id = engine.inject({ type: "dns-outage", target: { kind: "node", id: "dns" } });
    expect(mean(run(engine, 2), errorRate)).toBeCloseTo(0.1, 1);
    engine.heal(id);
    expect(mean(run(engine, 2), errorRate)).toBeLessThan(0.01);
    // Same in steady state (`analyze()` under the fault).
    const steady = analyzeUnderFault(wide(), RPS, {
      type: "dns-outage",
      target: { kind: "node", id: "dns" },
    });
    expect(steady.ok && steady.steady.errorRate).toBeCloseTo(0.1, 2);
  });

  it("health check flapping: the target drops in and out of rotation", () => {
    const engine = engineFor(wide());
    baseline(engine, errorRate);
    engine.inject({
      type: "health-check-flapping",
      target: { kind: "edge", id: "e-lb-a" },
      intensity: 4,
      durationSec: 8,
    });
    const snaps = run(engine, 8);
    const aIn = snaps.map((s) => s.nodes.a.rpsIn);
    // In rotation for the first half of each 4 s period, out for the second.
    expect(mean(snaps.slice(0, 30), (s) => s.nodes.a.rpsIn)).toBeGreaterThan(RPS * 0.4);
    expect(mean(snaps.slice(50, 70), (s) => s.nodes.a.rpsIn)).toBe(0);
    expect(Math.max(...aIn)).toBeGreaterThan(0);
    expect(mean(run(engine, 2), (s) => s.nodes.a.rpsIn)).toBeGreaterThan(RPS * 0.4);
  });
});

describe("circuit breaker (tick loop)", () => {
  /** Client → App (no retries) → Breaker → Payments. */
  const guarded = (breaker: Record<string, number> = {}) =>
    compileGraph(
      [
        comp("app", "app-server", { instances: 4, capacityPerInstance: 1000, maxRetries: 0 }),
        comp("cb", "circuit-breaker", {
          instances: 2,
          capacityPerInstance: 50_000,
          openDurationSec: 5,
          minimumCalls: 100,
          ...breaker,
        }),
        comp("pay", "app-server", { instances: 4, capacityPerInstance: 1000 }),
      ],
      [wire("app", "cb"), wire("cb", "pay")],
    );
  const state = (s: TickSnapshot) => s.nodes.cb.extra?.breakerState;

  it("stays closed (and changes nothing) while the dependency is healthy", () => {
    const engine = engineFor(guarded());
    const snaps = run(engine, 5);
    expect(snaps.every((s) => state(s) === "closed")).toBe(true);
    expect(mean(snaps.slice(20), errorRate)).toBe(0);
  });

  it("opens on failures (nothing reaches the dependency), probes half-open, closes after the heal", () => {
    const engine = engineFor(guarded());
    run(engine, 3);
    const id = engine.inject({ type: "kill-node", target: { kind: "node", id: "pay" } });
    const failing = run(engine, 2);
    expect(failing.some((s) => state(s) === "open")).toBe(true);
    // Open: the dependency gets nothing and callers fail fast (from the tick
    // after the one whose failures tripped it).
    const open = failing.filter((s) => state(s) === "open").slice(1);
    expect(mean(open, (s) => s.nodes.pay.rpsIn)).toBe(0);
    expect(mean(open, errorRate)).toBeGreaterThan(0.99);

    engine.heal(id);
    // After the open duration (5 s) the probes succeed and it closes.
    const recovering = run(engine, 7);
    expect(recovering.some((s) => state(s) === "half-open")).toBe(true);
    expect(state(recovering.at(-1)!)).toBe("closed");
    expect(mean(run(engine, 2), errorRate)).toBe(0);
  });

  it("a slow dependency trips it through its own timeout", () => {
    const engine = engineFor(guarded({ timeoutMs: 50 }));
    run(engine, 3);
    engine.inject({ type: "slow-node", target: { kind: "node", id: "pay" }, intensity: 10 });
    const snaps = run(engine, 3);
    expect(snaps.some((s) => state(s) === "open")).toBe(true);
  });

  it("is bit-identical across runs (no random numbers)", () => {
    const go = () => {
      const engine = engineFor(guarded());
      run(engine, 2);
      engine.inject({ type: "kill-node", target: { kind: "node", id: "pay" } });
      return run(engine, 8).map((s) => [state(s), s.global.errorRate, s.nodes.pay.rpsIn]);
    };
    expect(go()).toEqual(go());
  });
});
