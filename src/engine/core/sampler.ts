/**
 * End-to-end latency sampler (Spec 04, step 4 of the tick).
 *
 * Walks N synthetic requests through the graph using the routing
 * probabilities, adding each hop's sampled service time + queue wait and the
 * edge's network round trip. Retries and timeouts are replayed per call. Only
 * synchronous hops count: async edges and edges out of a queue are
 * fire-and-forget for the user. The cost is O(N × path length), independent
 * of the RPS. Seeded, so the same model + seed gives the same percentiles.
 */
import type { EdgeRuleKind } from "@/domain/components/types";
import type { LatencySummary } from "../types";
import { sampleServiceMs, sampleWaitMs, type StationState } from "./queueing";
import type { Rng } from "./rng";

export interface SampleEdge {
  target: string;
  /** Only LB edges can be async here: picking one ends the user's wait. */
  async: boolean;
  kind: EdgeRuleKind;
  /** kind = "fraction": P(taken). */
  fraction: number;
  callsPerRequest: number;
  networkLatencyMs: number;
  packetLoss: number;
  /** LB only: split share. */
  share: number;
}

export interface SampleNode {
  station: StationState;
  /** P(request is dropped/rejected here). */
  dropProbability: number;
  /** P(request pays this hop's service + wait): 1 except resolvers (cached answers skip it). */
  latencyShare: number;
  kind: "lb" | "queue" | "rules";
  /** Timeout on outgoing calls; undefined = no timeout. */
  timeoutMs?: number;
  maxRetries: number;
  /** 1 − hitRate. */
  missProbability: number;
  /** Forward edges on the user path (sync only, except an LB keeps all its targets). */
  edges: SampleEdge[];
}

export interface SampleModel {
  nodes: Map<string, SampleNode>;
  entries: string[];
  readRatio: number;
}

export interface SampleResult {
  latency: LatencySummary;
  /** Fraction of sampled requests that succeeded. */
  successRate: number;
  /**
   * Share of the successful sampled requests slower than `slowerThanMs` (the
   * latency SLO's threshold, Spec 11); 0 without one.
   */
  slowShare: number;
  /** Some requests hit the per-request hop budget (huge fan-out). */
  truncated: boolean;
}

/** Hop budget per request: protects against exponential fan-out (calls × depth). */
export const MAX_VISITS_PER_REQUEST = 2000;

interface Hop {
  ok: boolean;
  ms: number;
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1];
}

export function sampleLatency(
  model: SampleModel,
  samples: number,
  rng: Rng,
  slowerThanMs?: number,
): SampleResult {
  const empty: SampleResult = {
    latency: { meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    successRate: 0,
    slowShare: 0,
    truncated: false,
  };
  const entries = model.entries.filter((id) => model.nodes.has(id));
  const n = Math.max(1, Math.floor(samples));
  if (entries.length === 0) return empty;

  let visits = 0;
  let truncated = false;
  let isRead = true;

  const visit = (id: string): Hop => {
    const node = model.nodes.get(id)!;
    visits++;
    if (rng() < node.dropProbability) return { ok: false, ms: 0 };
    // (short-circuit: a share of 1 consumes no extra random numbers)
    let ms =
      node.latencyShare >= 1 || rng() < node.latencyShare
        ? sampleServiceMs(node.station, rng) + sampleWaitMs(node.station, rng)
        : 0;
    if (node.kind === "queue" || node.edges.length === 0) return { ok: true, ms };
    if (visits > MAX_VISITS_PER_REQUEST) {
      truncated = true;
      return { ok: true, ms };
    }

    if (node.kind === "lb") {
      const u = rng();
      let acc = 0;
      let chosen = node.edges[node.edges.length - 1];
      for (const e of node.edges) {
        acc += e.share;
        if (u < acc) {
          chosen = e;
          break;
        }
      }
      if (chosen.async) return { ok: true, ms };
      const r = call(node, chosen);
      return { ok: r.ok, ms: ms + r.ms };
    }

    const miss = rng() < node.missProbability;
    for (const e of node.edges) {
      let taken: boolean;
      switch (e.kind) {
        case "reads":
          taken = isRead;
          break;
        case "writes":
          taken = !isRead;
          break;
        case "on_miss":
          taken = miss;
          break;
        case "fraction":
          taken = rng() < e.fraction;
          break;
        default:
          taken = true;
      }
      if (!taken) continue;
      const whole = Math.floor(e.callsPerRequest);
      const count = whole + (rng() < e.callsPerRequest - whole ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const r = call(node, e);
        ms += r.ms;
        if (!r.ok) return { ok: false, ms };
      }
    }
    return { ok: true, ms };
  };

  /** One logical call with retries; calls are sequential. */
  const call = (caller: SampleNode, e: SampleEdge): Hop => {
    let ms = 0;
    const timeout = caller.timeoutMs;
    for (let attempt = 0; attempt <= caller.maxRetries; attempt++) {
      const rtt = 2 * e.networkLatencyMs;
      if (rng() < e.packetLoss) {
        // Lost: the caller notices at its timeout (or after a round trip).
        ms += timeout ?? rtt;
        continue;
      }
      const r = visit(e.target);
      const attemptMs = rtt + r.ms;
      if (timeout !== undefined && attemptMs > timeout) {
        ms += timeout;
        continue;
      }
      ms += attemptMs;
      if (r.ok) return { ok: true, ms };
    }
    return { ok: false, ms };
  };

  const latencies: number[] = [];
  for (let i = 0; i < n; i++) {
    visits = 0;
    isRead = rng() < model.readRatio;
    const entry = entries[Math.floor(rng() * entries.length)] ?? entries[0];
    const r = visit(entry);
    if (r.ok && Number.isFinite(r.ms)) latencies.push(r.ms);
  }
  if (latencies.length === 0) return { ...empty, truncated };

  latencies.sort((a, b) => a - b);
  const mean = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  // Counted after sampling: the threshold never changes the random stream.
  let slow = 0;
  if (slowerThanMs !== undefined && slowerThanMs >= 0) {
    while (slow < latencies.length && latencies[latencies.length - 1 - slow] > slowerThanMs) slow++;
  }
  return {
    latency: {
      meanMs: mean,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
    },
    successRate: latencies.length / n,
    slowShare: slow / latencies.length,
    truncated,
  };
}
