import { describe, expect, it } from "vitest";
import { compileGraph, type SimGraph } from "@/domain/graph/compile";
import { FlowEngine } from "@/engine/engine";
import { edgeTargets, FAULT_CATALOG, getFaultType, nodeTargets } from "@/engine/faults/catalog";
import { compileFault } from "@/engine/faults/compile";
import { effectsAt } from "@/engine/faults/effects";
import { BLAST_TAIL_SEC, FaultError } from "@/engine/faults/runner";
import type { CompiledModifier, FaultSpec } from "@/engine/faults/types";
import { TICK_SEC } from "@/engine/traffic/types";
import type { TickSnapshot } from "@/engine/types";
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
  it("covers the CHS-02 MVP with unique types and valid intensity ranges", () => {
    const types = FAULT_CATALOG.map((f) => f.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual(
      expect.arrayContaining([
        "kill-instances",
        "kill-node",
        "slow-node",
        "traffic-spike",
        "edge-latency",
        "packet-loss",
        "partition",
        "cache-flush",
        "db-primary-failure",
        "consumer-stopped",
      ]),
    );
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
      const target: FaultSpec["target"] = f.targets.includes("global")
        ? { kind: "global" }
        : f.targets.includes("edge")
          ? { kind: "edge", id: edgeTargets(f, ctx.graph)[0].id }
          : { kind: "node", id: nodeTargets(f, ctx.graph)[0].id };
      const spec: FaultSpec = { type: f.type, target, durationSec: 30 };
      const a = compileFault(spec, 12.5, ctx);
      const b = compileFault(structuredClone(spec), 12.5, { ...ctx, graph: shop() });
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
