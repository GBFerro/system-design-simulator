import { describe, expect, it } from "vitest";
import type { EdgeCallKind } from "@/domain/components/types";
import { station } from "@/engine/core/queueing";
import { mulberry32, type Rng } from "@/engine/core/rng";
import {
  sampleLatency,
  type Recorder,
  type SampleCall,
  type SampleModel,
  type SampleNode,
} from "@/engine/core/sampler";
import { requestSeed, traceRequest } from "@/engine/core/trace";
import type { TraceEvent } from "@/engine/types";

/**
 * Trace of one request (request-flow, FLW-34/35/36/38): the sampler with a
 * recorder. Hops take 0 ms (`latencyShare` 0) unless a test says otherwise,
 * so a call lasts exactly its round trip (2 × networkLatencyMs) plus what
 * its target spends on its own calls.
 */

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

/** A call from `from` that takes `ms` round trip, at plan step `step`. */
function to(
  from: string,
  target: string,
  ms: number,
  step: number,
  kind: EdgeCallKind = "always",
  extra: Partial<SampleCall> = {},
): SampleCall {
  return {
    edgeId: `${from}-${target}`,
    target,
    kind,
    fraction: 1,
    callsPerRequest: 1,
    networkLatencyMs: ms / 2,
    packetLoss: 0,
    step,
    ...extra,
  };
}

function model(nodes: Record<string, SampleNode>, entries = ["b"]): SampleModel {
  return { nodes: new Map(Object.entries(nodes)), entries, readRatio: 0.5 };
}

const call = (
  edgeId: string,
  from: string,
  toId: string,
  step: number,
  t0: number,
  t1: number,
  ok = true,
  attempt = 0,
): TraceEvent => ({ type: "call", edgeId, from, to: toId, step, t0, t1, ok, attempt });

/** B reads through a look-aside cache: B → cache (reads), then B → db (writes, reads after a miss). */
function lookAside(cache: Partial<SampleNode>): SampleModel {
  return model({
    b: node(
      [
        [to("b", "cache", 2, 1, "reads")],
        [to("b", "db", 20, 2, "writes")],
        [to("b", "db", 20, 3, "after_miss", { missOf: "cache", dependsOn: "b-cache" })],
      ],
      { absorbed: ["b-cache"] },
    ),
    cache: node([], cache),
    db: node(),
  });
}

describe("traceRequest: one request through the sampler's model", () => {
  it("the same model + seed + index gives the same trace; other indices can differ (FLW-38)", () => {
    const m = lookAside({ missProbability: 0.5 });
    expect(traceRequest(m, 7, 3, "read")).toEqual(traceRequest(m, 7, 3, "read"));
    const distinct = new Set(
      Array.from({ length: 20 }, (_, i) => JSON.stringify(traceRequest(m, 7, i, "read"))),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("a read that misses: the cache call, its miss, then the database call (FLW-35)", () => {
    const trace = traceRequest(lookAside({ missProbability: 1 }), 1, 0, "read");
    expect(trace.cls).toBe("read");
    expect(trace.ok).toBe(true);
    expect(trace.events).toEqual([
      call("b-cache", "b", "cache", 1, 0, 2),
      { type: "cache", nodeId: "cache", hit: false, viaFailure: false },
      call("b-db", "b", "db", 3, 2, 22),
    ]);
    expect(trace.totalMs).toBe(22);
  });

  it("a read that hits makes no database call (FLW-35)", () => {
    const trace = traceRequest(lookAside({ missProbability: 0 }), 1, 0, "read");
    expect(trace.events).toEqual([
      call("b-cache", "b", "cache", 1, 0, 2),
      { type: "cache", nodeId: "cache", hit: true, viaFailure: false },
    ]);
    expect(trace.totalMs).toBe(2);
  });

  it("a failed cache call is a miss: the database call follows and the request succeeds", () => {
    const trace = traceRequest(lookAside({ dropProbability: 1 }), 1, 0, "read");
    expect(trace.events).toEqual([
      call("b-cache", "b", "cache", 1, 0, 2, false),
      { type: "cache", nodeId: "cache", hit: false, viaFailure: true },
      call("b-db", "b", "db", 3, 2, 22),
    ]);
    expect(trace.ok).toBe(true);
  });

  it("a write takes only the write call (FLW-34: Read or Write)", () => {
    const trace = traceRequest(lookAside({ missProbability: 1 }), 1, 0, "write");
    expect(trace.cls).toBe("write");
    expect(trace.events).toEqual([call("b-db", "b", "db", 2, 0, 20)]);
    expect(trace.totalMs).toBe(20);
  });

  it("an async call is an event without a response, never a call, and adds no time (FLW-34)", () => {
    const m = model({
      b: node([[to("b", "c", 10, 1)]], { asyncCalls: [to("b", "mon", 6, 2)] }),
      c: node(),
      mon: node(),
    });
    const trace = traceRequest(m, 1, 0, "read");
    expect(trace.events).toEqual([
      call("b-c", "b", "c", 1, 0, 10),
      { type: "async", edgeId: "b-mon", from: "b", to: "mon", step: 2, t0: 10 },
    ]);
    expect("t1" in trace.events[1]).toBe(false);
    expect(trace.totalMs).toBe(10);
  });

  it("the total is the end of the entry's last sync call: steps in sequence, calls of a step in parallel (FLW-36)", () => {
    // B: step 1 = C (10 ms, C calls F 4 ms) ∥ E (30 ms); step 2 = D (20 ms).
    const m = model({
      b: node([[to("b", "c", 10, 1), to("b", "e", 30, 1)], [to("b", "d", 20, 2)]]),
      c: node([[to("c", "f", 4, 1)]]),
      d: node(),
      e: node(),
      f: node(),
    });
    const trace = traceRequest(m, 1, 0, "read");
    expect(trace.events).toEqual([
      call("b-c", "b", "c", 1, 0, 14),
      call("b-e", "b", "e", 1, 0, 30),
      call("c-f", "c", "f", 1, 5, 9),
      call("b-d", "b", "d", 2, 30, 50),
    ]);
    const entryEnd = Math.max(
      ...trace.events.flatMap((e) => (e.type === "call" && e.from === "b" ? [e.t1] : [])),
    );
    expect(trace.totalMs).toBe(50);
    expect(trace.totalMs).toBe(entryEnd);
  });

  it("times come from the sampler: the total is that request's sampled latency (FLW-36)", () => {
    const timed = (steps: SampleCall[][] = []) => node(steps, { latencyShare: 1 });
    const m = model({
      b: timed([[to("b", "c", 4, 1)], [to("b", "d", 6, 2)]]),
      c: timed(),
      d: timed([[to("d", "e", 2, 1)]]),
      e: timed(),
    });
    for (const index of [0, 1, 2]) {
      const trace = traceRequest(m, 11, index, "read");
      const sampled = sampleLatency({ ...m, readRatio: 1 }, 1, mulberry32(requestSeed(11, index)));
      expect(trace.ok).toBe(true);
      expect(trace.totalMs).toBe(sampled.latency.meanMs);
      const entryEnd = Math.max(
        ...trace.events.flatMap((e) => (e.type === "call" && e.from === "b" ? [e.t1] : [])),
      );
      expect(trace.totalMs).toBeCloseTo(entryEnd, 9);
      // the hops take sampled time now: D's call starts after C's came back
      const calls = trace.events.filter((e) => e.type === "call");
      expect(calls.map((e) => e.edgeId)).toEqual(["b-c", "b-d", "d-e"]);
      expect(calls[1].t0).toBeGreaterThan(calls[0].t1 - 1e-9);
    }
  });
});

/** A seeded PRNG that counts its draws. */
function countingRng(seed: number): Rng & { draws: number } {
  const inner = mulberry32(seed);
  const rng = (() => {
    rng.draws++;
    return inner();
  }) as Rng & { draws: number };
  rng.draws = 0;
  return rng;
}

describe("the recorder never changes the sampling (FLW-32 golden)", () => {
  it("same draws from the sampler's stream and the same result, with or without a recorder", () => {
    // Every branch that draws: LB split (with an async target), fractions,
    // reads after a miss, read-through, retries, packet loss, timeouts,
    // async calls of every kind and real service times.
    const timed = (steps: SampleCall[][] = [], extra: Partial<SampleNode> = {}) =>
      node(steps, { latencyShare: 1, ...extra });
    const m: SampleModel = {
      nodes: new Map(
        Object.entries({
          lb: timed([], {
            kind: "lb",
            edges: [
              {
                edgeId: "lb-b",
                target: "b",
                async: false,
                kind: "always",
                fraction: 1,
                callsPerRequest: 1,
                networkLatencyMs: 1,
                packetLoss: 0.05,
                share: 0.9,
              },
              {
                edgeId: "lb-q",
                target: "q",
                async: true,
                kind: "always",
                fraction: 1,
                callsPerRequest: 1,
                networkLatencyMs: 1,
                packetLoss: 0,
                share: 0.1,
              },
            ],
          }),
          b: timed(
            [
              [to("b", "cache", 2, 1, "reads"), to("b", "s", 8, 1, "fraction", { fraction: 0.3 })],
              [to("b", "db", 20, 2, "after_miss", { missOf: "cache", dependsOn: "b-cache" })],
              [to("b", "db", 20, 3, "writes", { packetLoss: 0.1, callsPerRequest: 1.5 })],
            ],
            {
              absorbed: ["b-cache"],
              maxRetries: 2,
              timeoutMs: 40,
              asyncCalls: [
                to("b", "mon", 2, 1, "always"),
                to("b", "q", 2, 2, "fraction", { fraction: 0.5 }),
                to("b", "q2", 2, 3, "after_miss", { missOf: "cache", dependsOn: "b-cache" }),
                to("b", "q3", 2, 4, "writes", { callsPerRequest: 2.5 }),
              ],
            },
          ),
          cache: timed([], { missProbability: 0.3, dropProbability: 0.05 }),
          cdn: timed(),
          s: timed([[to("s", "cdn", 2, 1, "on_miss")]], {
            missProbability: 0.4,
            asyncCalls: [to("s", "mon", 2, 2, "on_miss")],
          }),
          db: timed([], { dropProbability: 0.02 }),
          mon: timed(),
          q: timed([], { kind: "queue" }),
          q2: timed([], { kind: "queue" }),
          q3: timed([], { kind: "queue" }),
        }),
      ),
      entries: ["lb"],
      readRatio: 0.7,
    };

    let heard = 0;
    const recorder: Recorder = {
      rng: mulberry32(99),
      onCall: () => ++heard,
      onReturn: () => void heard++,
      onAsync: () => void heard++,
      onCacheResult: () => void heard++,
    };
    const plain = countingRng(5);
    const recorded = countingRng(5);
    const without = sampleLatency(m, 3000, plain, 50);
    const withRecorder = sampleLatency(m, 3000, recorded, 50, recorder);
    expect(heard).toBeGreaterThan(3000);
    expect(recorded.draws).toBe(plain.draws);
    expect(withRecorder).toEqual(without);
  });
});
