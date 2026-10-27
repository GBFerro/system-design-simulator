import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { CENTRAL_TYPES, techPreset, technologiesOf } from "@/domain/components/technologies";
import type { Params } from "@/domain/components/types";
import type { SimGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { mulberry32, type Rng } from "@/engine/core/rng";
import { TickSimulator } from "@/engine/core/tick";
import { FlowEngine } from "@/engine/engine";
import { compileFault } from "@/engine/faults/compile";
import { effectsAt } from "@/engine/faults/effects";
import type { CompiledModifier, FaultSpec } from "@/engine/faults/types";
import { TICK_SEC } from "@/engine/traffic/types";
import type { TickSnapshot } from "@/engine/types";
import { comp, compileV3, wire } from "./engineFixtures";

/** Engine properties with technologies (component-technologies T30: TEC-27, TEC-47, TEC-48). */

/* ---------- random canvases with technologies (TEC-48) ---------- */

const GARBAGE: unknown[] = [NaN, -1, 0, Infinity, -Infinity, "abc", null, 1e12, 0.5, 5_000];
const KINDS = ["always", "reads", "writes", "fraction", "on_miss"] as const;

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** A value in range most of the time, garbage or out of range otherwise. */
function maybeGarbage(rng: Rng, valid: unknown): unknown {
  return rng() < 0.3 ? pick(rng, GARBAGE) : valid;
}

/**
 * A random design of central types with random technologies and mechanics
 * params, out of range ones included. Its own PRNG stream (not
 * `randomCanvas`'s), so the generic property tests keep their graphs.
 */
function randomTechCanvas(seed: number): { nodes: Node[]; edges: Edge[]; rps: number } {
  const rng = mulberry32(0x7ec0_0000 + seed);
  const count = 2 + Math.floor(rng() * 10);
  const nodes: Node[] = [comp("n0", "client")];
  for (let i = 1; i < count; i++) {
    const type = pick(rng, [...CENTRAL_TYPES, "app-server", "worker-pool"]);
    const techs = technologiesOf(type).map((t) => t.id);
    const technology = techs.length > 0 && rng() < 0.85 ? pick(rng, techs) : "generic";
    const params: Params = {
      ...techPreset(type, technology),
      technology,
      instances: maybeGarbage(rng, 1 + Math.floor(rng() * 12)) as number,
      shards: maybeGarbage(rng, 1 + Math.floor(rng() * 8)) as number,
      partitions: maybeGarbage(rng, 1 + Math.floor(rng() * 24)) as number,
      prefixes: maybeGarbage(rng, 1 + Math.floor(rng() * 4)) as number,
      replicationFactor: maybeGarbage(rng, 1 + Math.floor(rng() * 7)) as number,
      replicas: maybeGarbage(rng, Math.floor(rng() * 3)) as number,
      consumers: maybeGarbage(rng, 1 + Math.floor(rng() * 16)) as number,
      hotPartitionShare: maybeGarbage(rng, rng()) as number,
      consistencyLevel: pick(rng, ["one", "quorum", "all", "bogus"]),
      readConsistency: pick(rng, ["eventual", "strong", 3]) as string,
      readPreference: pick(rng, ["primary", "secondaryPreferred", "nearest"]),
      writeConcern: pick(rng, ["1", "majority", "zero"]),
    };
    if (rng() < 0.3) params.maxQueue = rng() < 0.3 ? 0 : 1 + Math.floor(rng() * 5_000);
    if (rng() < 0.3) params.timeoutMs = 1 + Math.floor(rng() * 2_000);
    if (rng() < 0.2) params.maxRetries = Math.floor(rng() * 4);
    nodes.push(comp(`n${i}`, type, params));
  }
  const edges: Edge[] = [];
  const edgeCount = count - 1 + Math.floor(rng() * count);
  for (let i = 0; i < edgeCount; i++) {
    const source = `n${i < count - 1 ? i : Math.floor(rng() * count)}`;
    const target = `n${i < count - 1 ? i + 1 : 1 + Math.floor(rng() * (count - 1))}`;
    edges.push({
      ...wire(source, target, {
        async: rng() < 0.15,
        rule: { kind: pick(rng, KINDS), fraction: rng(), callsPerRequest: 1 + rng() },
      }),
      id: `e${i}`,
    });
  }
  const rps = rng() < 0.1 ? (pick(rng, GARBAGE) as number) : Math.floor(rng() * 200_000);
  return { nodes, edges, rps };
}

function expectFiniteNonNegative(values: readonly number[]): void {
  for (const v of values) expect(Number.isFinite(v) && v >= 0).toBe(true);
}

describe("random graphs with technologies (TEC-48)", () => {
  it("analyze(): served ≤ offered, every number finite, p50 ≤ p95 ≤ p99, throughput ≤ offered", () => {
    let techNodes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { nodes, edges, rps } = randomTechCanvas(seed);
      const graph = compileV3(nodes, edges);
      techNodes += graph.nodes.filter((n) => n.tech).length;
      const s = analyze(graph, rps, { seed, samples: 200 });
      expect(s.throughputRps).toBeLessThanOrEqual(s.offeredRps + 1e-9);
      expectFiniteNonNegative([s.throughputRps, s.goodputRps, s.errorRate, s.availability]);
      expect(s.latency.p50Ms).toBeLessThanOrEqual(s.latency.p95Ms + 1e-9);
      expect(s.latency.p95Ms).toBeLessThanOrEqual(s.latency.p99Ms + 1e-9);
      for (const n of s.nodes) {
        expectFiniteNonNegative([
          n.offeredRps,
          n.servedRps,
          n.droppedRps,
          n.capacityRps,
          n.utilization,
          n.meanLatencyMs,
          n.p50Ms,
          n.p95Ms,
          n.p99Ms,
          n.queueWaitMs,
          n.queueDepth,
          n.limitUtilization ?? 0,
          n.writeRps ?? 0,
        ]);
        expect(n.servedRps).toBeLessThanOrEqual(n.offeredRps + 1e-6);
        expect(n.writeRps ?? 0).toBeLessThanOrEqual(n.offeredRps + 1e-6);
        expect(n.p50Ms).toBeLessThanOrEqual(n.p95Ms + 1e-9);
        expect(n.p95Ms).toBeLessThanOrEqual(n.p99Ms + 1e-9);
      }
      for (const e of s.edges) expectFiniteNonNegative([e.rps, e.failureRate]);
    }
    // (the generator does exercise technologies)
    expect(techNodes).toBeGreaterThan(300);
  });

  it("tick: the same invariants on every snapshot", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { nodes, edges, rps } = randomTechCanvas(seed);
      const sim = new TickSimulator(compileV3(nodes, edges), { seed, tickSamples: 50 });
      for (let i = 0; i < 15; i++) {
        const snap = sim.step(rps);
        const g = snap.global;
        expect(g.throughput).toBeLessThanOrEqual(snap.offeredRps + 1e-9);
        expectFiniteNonNegative([g.throughput, g.goodput, g.errorRate, g.availability]);
        expect(g.p50).toBeLessThanOrEqual(g.p95 + 1e-9);
        expect(g.p95).toBeLessThanOrEqual(g.p99 + 1e-9);
        for (const m of Object.values(snap.nodes)) {
          expectFiniteNonNegative([
            m.rpsIn,
            m.rpsOut,
            m.utilization,
            m.queueDepth,
            m.p50,
            m.p95,
            m.p99,
            m.errorRate,
            m.drops,
            m.limitUtilization ?? 0,
            m.writeRps ?? 0,
          ]);
          expect(m.drops).toBeLessThanOrEqual(m.rpsIn + 1e-6);
          expect(m.errorRate).toBeLessThanOrEqual(1);
          expect(m.p50).toBeLessThanOrEqual(m.p95 + 1e-9);
          expect(m.p95).toBeLessThanOrEqual(m.p99 + 1e-9);
        }
      }
    }
  });
});

/* ---------- determinism with technologies and a fault (TEC-47) ---------- */

function techDesign(): SimGraph {
  const t = (id: string, type: string, technology: string, params: Params = {}) =>
    comp(id, type, { ...techPreset(type, technology), ...params });
  return compileV3(
    [
      comp("client", "client"),
      t("gw", "api-gateway", "aws-api-gateway"),
      comp("app", "app-server", { instances: 6 }),
      t("cache", "cache", "redis"),
      t("db", "sql-db", "postgres", { instances: 2 }),
      t("nosql", "nosql-db", "cassandra", { instances: 3, hotPartitionShare: 0.2 }),
      t("q", "message-queue", "kafka", { consumers: 12 }),
      comp("worker", "worker-pool", { instances: 12 }),
    ],
    [
      wire("client", "gw"),
      wire("gw", "app"),
      wire("app", "cache", { rule: { kind: "reads" } }),
      wire("app", "db", { rule: { kind: "writes" } }),
      wire("app", "nosql"),
      wire("app", "q", { rule: { kind: "writes" }, async: true }),
      wire("q", "worker"),
    ],
  );
}

const FAULTS: FaultSpec[] = [
  { type: "db-primary-failure", target: { kind: "node", id: "db" } },
  { type: "iops-throttle", target: { kind: "node", id: "nosql" }, intensity: 0.5 },
];

function modifiersOf(graph: SimGraph, readRatio: number): CompiledModifier[] {
  return FAULTS.flatMap((spec) => {
    const c = compileFault(spec, 1, { graph, readRatio });
    if (!c.ok) throw new Error(c.error);
    return c.modifiers;
  });
}

describe("determinism with technologies and faults (TEC-47)", () => {
  it("analyze(): same graph, seed and faults → deep-equal", () => {
    const run = () => {
      const graph = techDesign();
      return analyze(graph, 12_000, { seed: 9 }, effectsAt(modifiersOf(graph, 0.9), 5));
    };
    const a = run();
    expect(a.nodes.some((n) => n.limitKind !== undefined)).toBe(true);
    expect(run()).toEqual(a);
  });

  it("tick: same graph, seed, traffic and faults → deep-equal snapshots", () => {
    const run = (): TickSnapshot[] => {
      const graph = techDesign();
      const mods = modifiersOf(graph, 0.9);
      const sim = new TickSimulator(graph, { seed: 9, tickSamples: 100 });
      return Array.from({ length: 80 }, (_, i) => sim.step(12_000, effectsAt(mods, i * TICK_SEC)));
    };
    const a = run();
    expect(run()).toEqual(a);
  });
});

/* ---------- the technology's failover and an IOPS throttle ---------- */

describe("faults on a SQL database with a technology", () => {
  const sqlDesign = (technology: string) =>
    compileV3(
      [
        comp("client", "client"),
        comp("app", "app-server", { instances: 4 }),
        comp("db", "sql-db", { ...techPreset("sql-db", technology), instances: 2 }),
      ],
      [wire("client", "app"), wire("app", "db")],
    );

  /** Global error rate each second of a writes-only run with the DB primary failing at t = 0. */
  function errorsBySecond(technology: string, seconds: number): number[] {
    const engine = new FlowEngine({ tickSamples: 20 });
    engine.load(sqlDesign(technology), { seed: 4, readRatio: 0 });
    engine.setTraffic({ kind: "constant", rps: 1_000 });
    engine.inject({ type: "db-primary-failure", target: { kind: "node", id: "db" } });
    const snaps: TickSnapshot[] = [];
    const off = engine.onTick((s) => snaps.push(s));
    engine.step(Math.round(seconds / TICK_SEC));
    off();
    const perSecond = Math.round(1 / TICK_SEC);
    return Array.from({ length: seconds }, (_, k) => {
      const slice = snaps.slice(k * perSecond, (k + 1) * perSecond);
      return slice.reduce((sum, s) => sum + s.global.errorRate, 0) / slice.length;
    });
  }

  it.each([
    ["aurora-postgres", 30],
    ["postgres", 90],
  ])("%s fails writes for its failoverSec (%i s, TEC-27)", (technology, failover) => {
    const graph = sqlDesign(technology);
    const c = compileFault({ type: "db-primary-failure", target: { kind: "node", id: "db" } }, 0, {
      graph,
      readRatio: 0,
    });
    expect(c.ok).toBe(true);
    const writeFailures = c.ok ? c.modifiers.filter((m) => m.kind === "errorRate") : [];
    expect(writeFailures.length).toBeGreaterThan(0);
    for (const m of writeFailures) expect(m.endT).toBe(failover);

    const errors = errorsBySecond(technology, failover + 5);
    // Every write fails until the failover, none a few seconds after it.
    for (const e of errors.slice(1, failover - 1)) expect(e).toBeGreaterThan(0.99);
    for (const e of errors.slice(failover + 2)) expect(e).toBeLessThan(0.01);
  });

  it("an IOPS throttle scales the write primary with the node (capScale)", () => {
    const graph = sqlDesign("postgres");
    const writeCap = techPreset("sql-db", "postgres").writeCapacityRps as number;
    const c = compileFault(
      { type: "iops-throttle", target: { kind: "node", id: "db" }, intensity: 0.5 },
      0,
      { graph, readRatio: 0 },
    );
    if (!c.ok) throw new Error(c.error);
    const db = (fx: ReturnType<typeof effectsAt>) =>
      analyze(graph, 4_000, { seed: 2, readRatio: 0 }, fx).nodes.find((n) => n.nodeId === "db")!;
    expect(db(null).servedRps).toBeCloseTo(4_000, 6);
    const throttled = db(effectsAt(c.modifiers, 1));
    expect(throttled.servedRps).toBeCloseTo(0.5 * writeCap, 6);
    expect(throttled.limitKind).toBe("write-primary");
    expect(throttled.limitUtilization).toBeCloseTo(4_000 / (0.5 * writeCap), 9);
  });
});
