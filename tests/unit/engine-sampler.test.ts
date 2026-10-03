import { describe, expect, it } from "vitest";
import type { EdgeCallKind } from "@/domain/components/types";
import { station } from "@/engine/core/queueing";
import { mulberry32, type Rng } from "@/engine/core/rng";
import {
  sampleLatency,
  type SampleCall,
  type SampleModel,
  type SampleNode,
} from "@/engine/core/sampler";

/**
 * The sampler with fixed times (request-flow, FLW-10/11/12/27/28): every
 * hop takes 0 ms (`latencyShare` 0), so a call lasts exactly its round trip
 * (2 × networkLatencyMs) plus what its target spends on its own calls.
 */

const SAMPLES = 2000;

function node(steps: SampleCall[][] = [], extra: Partial<SampleNode> = {}): SampleNode {
  return {
    station: station({
      lambda: 0,
      instances: 1,
      capacityPerInstance: 100,
      serviceTimeMs: 10,
      maxQueue: Infinity,
      horizonSec: 10,
    }),
    dropProbability: 0,
    latencyShare: 0,
    kind: "rules",
    maxRetries: 0,
    missProbability: 1,
    edges: [],
    steps,
    absorbed: [],
    ...extra,
  };
}

/** A call from B that takes `ms` round trip. */
function to(
  target: string,
  ms: number,
  kind: EdgeCallKind = "always",
  extra: Partial<SampleCall> = {},
): SampleCall {
  return {
    edgeId: `b-${target}`,
    target,
    kind,
    fraction: 1,
    callsPerRequest: 1,
    networkLatencyMs: ms / 2,
    packetLoss: 0,
    ...extra,
  };
}

function model(nodes: Record<string, SampleNode>, readRatio = 0.9): SampleModel {
  return { nodes: new Map(Object.entries(nodes)), entries: ["b"], readRatio };
}

/** A seeded PRNG that counts its draws. */
function countingRng(seed = 1): Rng & { draws: number } {
  const inner = mulberry32(seed);
  const rng = (() => {
    rng.draws++;
    return inner();
  }) as Rng & { draws: number };
  rng.draws = 0;
  return rng;
}

describe("sampler: steps run in sequence, the calls of a step in parallel", () => {
  it("B = own time + the slowest call of each step: 10 ∥ 30 then 20 → +50 ms (FLW-27)", () => {
    const parallel = model({
      b: node([[to("c", 10), to("e", 30)], [to("d", 20)]]),
      c: node(),
      d: node(),
      e: node(),
    });
    const r = sampleLatency(parallel, SAMPLES, mulberry32(1));
    expect(r.successRate).toBe(1);
    expect(r.latency.p50Ms).toBe(50);
    expect(r.latency.p99Ms).toBe(50);
    expect(r.latency.meanMs).toBeCloseTo(50, 9);

    // the same calls one per step add up: 10 + 30 + 20
    const sequential = model({
      b: node([[to("c", 10)], [to("e", 30)], [to("d", 20)]]),
      c: node(),
      d: node(),
      e: node(),
    });
    expect(sampleLatency(sequential, SAMPLES, mulberry32(1)).latency.p50Ms).toBe(60);
  });

  it("a failed call ends the request after its step: the next step isn't called, the rest of the step is (FLW-28)", () => {
    const failing = { c: node([], { dropProbability: 1 }), d: node(), e: node() };
    const draws = (steps: SampleCall[][]) => {
      const rng = countingRng();
      const r = sampleLatency(model({ b: node(steps), ...failing }), SAMPLES, rng);
      return { draws: rng.draws, successRate: r.successRate };
    };
    const full = draws([[to("c", 10), to("e", 30)], [to("d", 20)]]);
    expect(full.successRate).toBe(0);
    // D is never called: the same draws as without step 2
    expect(full.draws).toBe(draws([[to("c", 10), to("e", 30)]]).draws);
    // E is called although C failed: more draws than without it
    expect(full.draws).toBeGreaterThan(draws([[to("c", 10)], [to("d", 20)]]).draws);
  });
});

describe("sampler: reads after a cache miss (look-aside)", () => {
  // B reads the cache C (10 ms) and, after a miss, the database D (20 ms).
  const lookAside = (cache: Partial<SampleNode>, readRatio = 1) =>
    model(
      {
        b: node(
          [[to("c", 10, "reads")], [to("d", 20, "after_miss", { missOf: "c", dependsOn: "b-c" })]],
          { absorbed: ["b-c"] },
        ),
        c: node([], cache),
        d: node(),
      },
      readRatio,
    );

  it("a read that hits the cache doesn't call the database (FLW-11)", () => {
    const r = sampleLatency(lookAside({ missProbability: 0 }), SAMPLES, mulberry32(2));
    expect(r.successRate).toBe(1);
    expect(r.latency.p99Ms).toBe(10);
  });

  it("a read that misses calls the database after the cache answers (FLW-10)", () => {
    const r = sampleLatency(lookAside({ missProbability: 1 }), SAMPLES, mulberry32(2));
    expect(r.successRate).toBe(1);
    expect(r.latency.p50Ms).toBe(30);
    expect(r.latency.p99Ms).toBe(30);
  });

  it("misses follow the cache's hit rate: 10% of reads at h = 0.9", () => {
    const r = sampleLatency(lookAside({ missProbability: 0.1 }), 20_000, mulberry32(3));
    expect(r.latency.p50Ms).toBe(10);
    expect(r.latency.p95Ms).toBe(30);
    expect(r.latency.meanMs).toBeGreaterThan(10 + 20 * 0.08);
    expect(r.latency.meanMs).toBeLessThan(10 + 20 * 0.12);
  });

  it("a failed cache call is a miss: the database is called and the request succeeds (FLW-12)", () => {
    const r = sampleLatency(
      lookAside({ dropProbability: 1, missProbability: 0 }),
      SAMPLES,
      mulberry32(2),
    );
    expect(r.successRate).toBe(1);
    expect(r.latency.p50Ms).toBe(30);
  });

  it("writes never take the call after a miss", () => {
    const r = sampleLatency(lookAside({ missProbability: 1 }, 0), SAMPLES, mulberry32(2));
    expect(r.successRate).toBe(1);
    expect(r.latency.p99Ms).toBe(0);
  });
});
