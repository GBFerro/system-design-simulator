import { describe, expect, it } from "vitest";
import { sanitizeParams } from "@/domain/components/registry";
import {
  techProfileOf,
  type LatencyShape,
  type PartitionThrottle,
  type QuotaThrottle,
  type TechCore,
  type TechProfile,
} from "@/domain/components/technologies/profile";
import type { Params } from "@/domain/components/types";
import { compileV3, comp, wire } from "./engineFixtures";
import { station, type StationState } from "@/engine/core/queueing";
import { mulberry32 } from "@/engine/core/rng";
import {
  admit,
  classTail,
  edgeWriteShare,
  sampleClassMs,
  techExceeds,
  techMeanMs,
  techPercentileMs,
  techSteadyFlow,
  type TechClassView,
  type TechFlowView,
} from "@/engine/core/tech";

const S = 4;

/** A station that never waits (no load). */
function idle(serviceTimeMs = S): StationState {
  return station({
    lambda: 0,
    instances: 1,
    capacityPerInstance: 1000,
    serviceTimeMs,
    maxQueue: Infinity,
    horizonSec: 10,
  });
}

function cls(shape: LatencyShape, st: StationState = idle(), addMs = 0): TechClassView {
  return { station: st, serviceTimeMs: S, shape, addMs, served: 0, dropProbability: 0 };
}

function view(read: TechClassView, write: TechClassView, ws = 0): TechFlowView {
  return { ws, read, write };
}

function nodeOf(componentId: string, raw: Params): { profile: TechProfile; core: TechCore } {
  const params = sanitizeParams(componentId, raw);
  return {
    profile: techProfileOf(componentId, params)!,
    core: {
      instances: params.instances as number,
      capacityPerInstance: params.capacityPerInstance as number,
      serviceTimeMs: params.serviceTimeMs as number,
    },
  };
}

describe("latency tails of the shapes (T23, A.6)", () => {
  it("kth(1, n) is the tail of Exp(S/n), the fastest of n replies", () => {
    const n = 3;
    for (const t of [2, 3, 5, 8, 13]) {
      expect(classTail(cls({ kind: "kth", k: 1, n }), t)).toBeCloseTo(Math.exp((-n * t) / S), 12);
    }
  });

  it("kth(n, n) is the tail of the slowest of n replies, max(n)", () => {
    for (const n of [1, 2, 3, 5, 7]) {
      for (const t of [4, 8, 16, 30]) {
        expect(classTail(cls({ kind: "kth", k: n, n }), t)).toBeCloseTo(
          classTail(cls({ kind: "max", n }), t),
          12,
        );
      }
    }
    // The max of 3 above its mean (S·H₃): 1 − (1 − e^(−t/S))³.
    expect(classTail(cls({ kind: "max", n: 3 }), 20)).toBeCloseTo(
      1 - (1 - Math.exp(-20 / S)) ** 3,
      12,
    );
  });

  it("one without addMs is the generic sojourn tail; addMs shifts it", () => {
    const busy = station({
      lambda: 800,
      instances: 1,
      capacityPerInstance: 1000,
      serviceTimeMs: S,
      maxQueue: Infinity,
      horizonSec: 10,
    });
    const one = cls({ kind: "one" }, busy);
    expect(classTail(one, 25)).toBeCloseTo(
      Math.min(1, Math.exp(-25 / S) + busy.waitProbability * Math.exp(-busy.drainPerMs * (25 - S))),
      12,
    );
    expect(classTail(cls({ kind: "one" }, busy, 2), 27)).toBeCloseTo(classTail(one, 25), 12);
    expect(classTail(one, 0)).toBe(1);
    expect(classTail(cls({ kind: "one" }, busy, 5), 4)).toBe(1);
  });

  it("the mix by write share and the mean", () => {
    const tech = view(cls({ kind: "one" }), cls({ kind: "max", n: 4 }, idle(), 2), 0.25);
    const t = 20;
    expect(techExceeds(tech, 0.25, t)).toBeCloseTo(
      0.75 * classTail(tech.read, t) + 0.25 * classTail(tech.write, t),
      12,
    );
    // Mean: S for one; S·H₄ + 2 for the max of 4 with addMs 2.
    expect(techMeanMs(tech)).toBeCloseTo(
      0.75 * S + 0.25 * (S * (1 + 1 / 2 + 1 / 3 + 1 / 4) + 2),
      12,
    );
  });

  it("percentiles are non-decreasing in p, finite, and solve the tail", () => {
    const tech = view(cls({ kind: "kth", k: 2, n: 3 }), cls({ kind: "max", n: 8 }), 0.3);
    let last = -Infinity;
    for (const p of [0, 0.1, 0.5, 0.9, 0.95, 0.99, 0.999, 1]) {
      const v = techPercentileMs(tech, p);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    const p99 = techPercentileMs(tech, 0.99);
    expect(techExceeds(tech, 0.3, p99)).toBeLessThanOrEqual(0.01 + 1e-12);
    expect(techExceeds(tech, 0.3, p99 * 0.999)).toBeGreaterThan(0.01);
    // Same input, same answer (fixed iterations).
    expect(techPercentileMs(tech, 0.99)).toBe(p99);
  });
});

describe("sampled latency of the shapes (T23, A.5)", () => {
  const N = 200_000;

  function sampledMean(shape: LatencyShape): number {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < N; i++) sum += sampleClassMs(cls(shape), rng);
    return sum / N;
  }

  it("kth(k, n) averages S·Σ_{j=1..k} 1/(n−j+1) (Rényi)", () => {
    expect(sampledMean({ kind: "kth", k: 2, n: 3 }) / (S * (1 / 3 + 1 / 2))).toBeCloseTo(1, 1.7);
    expect(sampledMean({ kind: "kth", k: 1, n: 5 }) / (S / 5)).toBeCloseTo(1, 1.7);
    expect(sampledMean({ kind: "kth", k: 3, n: 3 }) / (S * (1 / 3 + 1 / 2 + 1))).toBeCloseTo(
      1,
      1.7,
    );
  });

  it("max(n) averages S·H_n (inverse CDF)", () => {
    const h8 = [1, 2, 3, 4, 5, 6, 7, 8].reduce((s, j) => s + 1 / j, 0);
    expect(sampledMean({ kind: "max", n: 8 }) / (S * h8)).toBeCloseTo(1, 1.7);
    expect(sampledMean({ kind: "one" }) / S).toBeCloseTo(1, 1.7);
  });

  it("u = 0 gives a finite latency for every shape", () => {
    const zero = () => 0;
    for (const shape of [
      { kind: "one" },
      { kind: "kth", k: 2, n: 3 },
      { kind: "max", n: 1024 },
    ] as LatencyShape[]) {
      const ms = sampleClassMs(cls(shape, idle(), 1.5), zero);
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBe(1.5);
    }
    const nearOne = () => 1 - 2 ** -32;
    expect(Number.isFinite(sampleClassMs(cls({ kind: "max", n: 1024 }), nearOne))).toBe(true);
  });

  it("draws: one and max take 1 draw, kth takes k (plus the wait's, none on an idle station)", () => {
    let draws = 0;
    const base = mulberry32(3);
    const counting = () => {
      draws++;
      return base();
    };
    for (const [shape, expected] of [
      [{ kind: "one" }, 1],
      [{ kind: "max", n: 16 }, 1],
      [{ kind: "kth", k: 3, n: 5 }, 3],
    ] as [LatencyShape, number][]) {
      draws = 0;
      sampleClassMs(cls(shape), counting);
      expect(draws).toBe(expected);
    }
  });
});

describe("admission: quotas, hot partition, token bucket (T23)", () => {
  it("hot partition: only it loses, throttled = h·λ·(1 − 1/U) (D2, TEC-28)", () => {
    const throttle: PartitionThrottle = {
      kind: "partition",
      share: 0.5,
      readCost: 0.5,
      writeCost: 1,
      readUnits: 3000,
      writeUnits: 1000,
      nodeBound: false,
    };
    const read = 10_000;
    const write = 1_000;
    const u = 0.5 * ((read * 0.5) / 3000 + write / 1000);
    expect(u).toBeGreaterThan(1);
    const a = admit(throttle, { read, write }, 1);
    expect(a.throttled).toBeCloseTo(0.5 * (read + write) * (1 - 1 / u), 9);
    expect(a.read + a.write + a.throttled).toBeCloseTo(read + write, 9);
    // Each class loses in proportion to its share of the hot partition's requests.
    expect(a.read / read).toBeCloseTo(a.write / write, 12);
    // Below U = 1 nothing is throttled.
    expect(admit(throttle, { read: 1000, write: 100 }, 1).throttled).toBe(0);
  });

  it("a node-bound partition scales with the node's capacity", () => {
    const throttle: PartitionThrottle = {
      kind: "partition",
      share: 1,
      readCost: 2,
      writeCost: 3,
      readUnits: 1000,
      writeUnits: 1000,
      nodeBound: true,
    };
    expect(admit(throttle, { read: 400, write: 0 }, 1).throttled).toBe(0);
    // Half the capacity: U = 800 / 500 = 1.6.
    expect(admit(throttle, { read: 400, write: 0 }, 0.5).throttled).toBeCloseTo(
      400 * (1 - 1 / 1.6),
      9,
    );
  });

  it("quota: per class (S3: 10,000 GET on 5,500 → 4,500; 4,000 PUT on 3,500 → 500) and shared", () => {
    const s3: QuotaThrottle = {
      kind: "quota",
      limit: "prefix-limit",
      readRps: 5500,
      writeRps: 3500,
    };
    expect(admit(s3, { read: 10_000, write: 0 }, 1)).toEqual({
      read: 5500,
      write: 0,
      throttled: 4500,
    });
    expect(admit(s3, { read: 0, write: 4000 }, 1).throttled).toBe(500);
    const fifo: QuotaThrottle = { kind: "quota", limit: "queue-throughput", sharedRps: 3000 };
    const a = admit(fifo, { read: 1000, write: 3000 }, 1);
    expect(a.throttled).toBe(1000);
    expect(a.read).toBeCloseTo(750, 9);
    expect(a.write).toBeCloseTo(2250, 9);
    // Managed quotas don't scale with the node.
    expect(admit(fifo, { read: 0, write: 3000 }, 0.1).throttled).toBe(0);
  });

  it("token bucket: the burst absorbs the excess for ~1 s, then the steady limit holds (API Gateway, TEC-38)", () => {
    const gw: QuotaThrottle = {
      kind: "quota",
      limit: "account-throttle",
      sharedRps: 10_000,
      burst: 5_000,
    };
    const dt = 0.05;
    let tokens = 5_000; // starts full
    const throttled: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = admit(gw, { read: 15_000, write: 0 }, 1, { tokens, dtSec: dt });
      tokens = a.tokens!;
      throttled.push(a.throttled);
    }
    // The full bucket (5,000) pays 250 tokens of excess per 50 ms tick, the
    // tick's refill spent before the cap: 20 ticks (B ÷ (λ − L) = 1.0 s) without errors.
    expect(throttled.slice(0, 20).every((t) => t === 0)).toBe(true);
    expect(throttled.slice(20).every((t) => Math.abs(t - 5_000) < 1e-6)).toBe(true);
    // Steady state (no bucket): min(λ, L).
    expect(admit(gw, { read: 15_000, write: 0 }, 1).throttled).toBe(5_000);
    // Below the limit the bucket refills (+L·dt − λ·dt) up to the burst.
    const refill = admit(gw, { read: 1_000, write: 0 }, 1, { tokens: 1_000, dtSec: dt });
    expect(refill.throttled).toBe(0);
    expect(refill.tokens).toBeCloseTo(1_000 + (10_000 - 1_000) * dt, 9);
    const capped = admit(gw, { read: 1_000, write: 0 }, 1, { tokens: 4_990, dtSec: dt });
    expect(capped.tokens).toBe(5_000);
  });
});

describe("per-class stations in the steady state (T23)", () => {
  const steady = (profile: TechProfile, core: TechCore, offered: number, writeShare: number) =>
    techSteadyFlow({ profile, core, offered, writeShare, maxQueue: 1000, horizonSec: 10 });

  it("SQL: writes beyond the primary queue then drop; more instances don't add write throughput (TEC-26)", () => {
    const eight = nodeOf("sql-db", { technology: "postgres", instances: 8 });
    const sixteen = nodeOf("sql-db", { technology: "postgres", instances: 16 });
    const a = steady(eight.profile, eight.core, 8_000, 1);
    const b = steady(sixteen.profile, sixteen.core, 8_000, 1);
    expect(a.view.write.served).toBeCloseTo(5_000, 6);
    expect(b.view.write.served).toBe(a.view.write.served);
    expect(a.stations[1].regime).toBe("overloaded");
    expect(a.view.write.dropProbability).toBeCloseTo(3 / 8, 9);
    // Reads go to the instances and are all served.
    const reads = steady(eight.profile, eight.core, 100_000, 0);
    expect(reads.served).toBeCloseTo(100_000, 6);
    expect(reads.view.read.dropProbability).toBe(0);
  });

  it("quorum classes consume k and RF replica ops at the shared station (TEC-29)", () => {
    const n = nodeOf("nosql-db", {
      technology: "cassandra",
      instances: 3,
      consistencyLevel: "quorum",
    });
    const s = steady(n.profile, n.core, 1_000, 0.5);
    // 500 reads × 2 + 500 writes × 3 replica ops.
    expect(s.stations[0].servedRps).toBeCloseTo(2_500, 9);
    expect(s.view.read.shape).toEqual({ kind: "kth", k: 2, n: 3 });
  });

  it("a fault's error rate and the throttle both count as drops; served ≤ offered and finite", () => {
    const n = nodeOf("object-storage", { technology: "s3", prefixes: 1 });
    const s = techSteadyFlow({
      profile: n.profile,
      core: n.core,
      offered: 10_000,
      writeShare: 0,
      errorRate: 0.1,
      maxQueue: 1000,
      horizonSec: 10,
    });
    // 10% fail, 9,000 reach the quota of 5,500.
    expect(s.throttled).toBeCloseTo(3_500, 9);
    expect(s.served).toBeCloseTo(5_500, 9);
    expect(s.view.read.dropProbability).toBeCloseTo(0.45, 12);
    for (const [id, raw, offered, ws] of [
      ["sql-db", { technology: "aurora-postgres" }, 1e9, 0.3],
      ["nosql-db", { technology: "mongodb", instances: 6, shards: 2 }, 0, 0.5],
      ["search", { technology: "opensearch" }, NaN, 0.1],
      ["api-gateway", { technology: "aws-api-gateway" }, 50_000, 2],
    ] as const) {
      const node = nodeOf(id, raw);
      const r = steady(node.profile, node.core, offered as number, ws);
      const all = [r.served, r.throttled, r.view.read.served, r.view.write.served];
      expect(all.every(Number.isFinite)).toBe(true);
      const o = Number.isFinite(offered) ? Math.max(0, offered as number) : 0;
      expect(r.served).toBeLessThanOrEqual(o + 1e-9);
    }
  });
});

describe("write share of an edge (A.3)", () => {
  it("writes → 1, reads → 0, always → the caller's mix, mixed calls weighted; an LB passes its mix on", () => {
    const sim = compileV3(
      [
        comp("app", "app-server"),
        comp("db", "sql-db"),
        comp("cache", "cache"),
        comp("lb", "load-balancer"),
      ],
      [
        wire("app", "db", { rule: { kind: "writes" } }),
        wire("app", "cache", { rule: { kind: "reads" } }),
        wire("lb", "app"),
      ],
    );
    const byId = new Map(sim.nodes.map((n) => [n.id, n]));
    const edge = (s: string, t: string) => sim.edges.find((e) => e.source === s && e.target === t)!;
    const ctx = { readRatio: 0.8, byId };
    expect(edgeWriteShare(edge("app", "db"), byId.get("app")!, 0.2, ctx)).toBe(1);
    expect(edgeWriteShare(edge("app", "cache"), byId.get("app")!, 0.2, ctx)).toBe(0);
    expect(edgeWriteShare(edge("lb", "app"), byId.get("lb")!, 0.35, ctx)).toBe(0.35);

    const mixed = compileV3(
      [comp("app", "app-server"), comp("db", "sql-db")],
      [wire("app", "db", { rule: { kind: "always" } })],
    );
    const app = mixed.nodes.find((n) => n.id === "app")!;
    expect(edgeWriteShare(mixed.edges[0], app, 0.25, { readRatio: 0.8 })).toBe(0.25);
  });
});
