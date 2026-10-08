/**
 * End-to-end latency sampler (Spec 04, step 4 of the tick).
 *
 * Walks N synthetic requests through the graph using the routing
 * probabilities, adding each hop's sampled service time + queue wait and the
 * edge's network round trip. Retries and timeouts are replayed per call. Only
 * synchronous hops count: async edges and edges out of a queue are
 * fire-and-forget for the user. The cost is O(N × path length), independent
 * of the RPS. Seeded, so the same model + seed gives the same percentiles.
 *
 * A node makes its calls by step, as its call plan orders them
 * (request-flow): steps run in sequence and the calls of one step in
 * parallel, so a step lasts as long as its slowest call. A failed sync call
 * fails the request after its step (the others of the step were already
 * out); a failed look-aside cache call is a miss instead. A read after a
 * miss goes to the database when the cache call failed or missed.
 *
 * An optional `Recorder` (request-flow, the Flow tab's trace) hears about
 * every call, response, async call and cache hit/miss, with times relative
 * to the start of the request. It never changes the sampling: the random
 * stream and every number are the same with or without one, and the
 * trace-only decisions (whether an async call goes out) draw from the
 * recorder's own stream.
 */
import type { EdgeCallKind } from "@/domain/components/types";
import type { LatencySummary } from "../types";
import { sampleServiceMs, sampleWaitMs, type StationState } from "./queueing";
import type { Rng } from "./rng";

/** A load balancer's target. */
export interface SampleEdge {
  /** For the trace only. */
  edgeId?: string;
  target: string;
  /** Picking an async target ends the user's wait. */
  async: boolean;
  kind: EdgeCallKind;
  /** kind = "fraction": P(taken). */
  fraction: number;
  callsPerRequest: number;
  networkLatencyMs: number;
  packetLoss: number;
  /** Split share. */
  share: number;
}

/** One sync call of a rule node (from its call plan). */
export interface SampleCall {
  edgeId: string;
  target: string;
  kind: EdgeCallKind;
  /** kind = "fraction": P(taken). */
  fraction: number;
  callsPerRequest: number;
  networkLatencyMs: number;
  packetLoss: number;
  /** kind = "after_miss": the cache node whose miss it follows. */
  missOf?: string;
  /** kind = "after_miss": edge id of the cache call it depends on. */
  dependsOn?: string;
  /** Effective step in the caller's call plan (for the trace only). */
  step?: number;
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
  /** Load balancer: all its targets (sync and async). Empty for other nodes. */
  edges: SampleEdge[];
  /** Rule nodes: sync calls by step, in order (same step = parallel). Empty for the others. */
  steps: SampleCall[][];
  /** Edge ids of cache calls whose failure is a miss (an `after_miss` depends on them). */
  absorbed: string[];
  /** Rule nodes: async calls in step order, for the trace only (never read without a recorder). */
  asyncCalls?: SampleCall[];
}

/** A call as a recorder hears about it. */
export interface TracedCall {
  edgeId: string;
  target: string;
  /** Step in the caller's call plan. */
  step: number;
}

/**
 * Listener of sampled requests (the trace, `core/trace.ts`). Times are ms
 * since the request started.
 */
export interface Recorder {
  /** Trace-only draws (whether an async call goes out): never the sampler's stream. */
  readonly rng: Rng;
  /** An attempt of a sync call leaves `from`; returns a handle for `onReturn`. */
  onCall(from: string, call: TracedCall, attempt: number, t0: number): number;
  /** That attempt's response is back at the caller (or the caller gave up on it). */
  onReturn(handle: number, t1: number, ok: boolean): void;
  /** An async call leaves `from`: fire-and-forget, no response. */
  onAsync(from: string, call: TracedCall, t0: number): void;
  /** A look-aside or read-through cache hit or missed (a failed cache call is a miss). */
  onCacheResult(nodeId: string, hit: boolean, viaFailure: boolean, t: number): void;
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
  recorder?: Recorder,
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

  /** `at`: when the visit starts, ms since the request did (only the recorder reads it). */
  const visit = (id: string, at: number): Hop => {
    const node = model.nodes.get(id)!;
    visits++;
    if (rng() < node.dropProbability) return { ok: false, ms: 0 };
    // (short-circuit: a share of 1 consumes no extra random numbers)
    let ms =
      node.latencyShare >= 1 || rng() < node.latencyShare
        ? sampleServiceMs(node.station, rng) + sampleWaitMs(node.station, rng)
        : 0;
    if (node.kind === "queue" || (node.kind === "lb" ? node.edges : node.steps).length === 0) {
      if (recorder && node.kind === "rules") fireAsync(id, node, 0, Infinity, at + ms);
      return { ok: true, ms };
    }
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
      if (chosen.async) {
        recorder?.onAsync(id, traced(chosen, 1), at + ms);
        return { ok: true, ms };
      }
      const r = call(node, chosen, id, 1, at + ms);
      return { ok: r.ok, ms: ms + r.ms };
    }

    const miss = rng() < node.missProbability;
    if (recorder && readsThrough(node)) recorder.onCacheResult(id, !miss, false, at + ms);
    // Look-aside cache calls of this request: edge id → the call failed.
    const cacheFailed = node.absorbed.length > 0 ? new Map<string, boolean>() : undefined;
    let fired = 0;
    for (let s = 0; s < node.steps.length; s++) {
      const step = node.steps[s];
      const stepNo = step[0]?.step ?? s + 1;
      // Every call of the step starts now; the step ends with the slowest.
      const start = ms;
      if (recorder) fired = fireAsync(id, node, fired, stepNo, at + start, miss, cacheFailed);
      let failed = false;
      for (const e of step) {
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
          case "after_miss":
            taken = isRead && missedCache(e, cacheFailed, at + start);
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
        let end = start;
        let ok = true;
        for (let i = 0; i < count && ok; i++) {
          const r = call(node, e, id, stepNo, at + end);
          end += r.ms;
          ok = r.ok;
        }
        // (one call per step: exactly the old running sum, NaN included)
        if (!(end <= ms)) ms = end;
        if (cacheFailed && node.absorbed.includes(e.edgeId)) cacheFailed.set(e.edgeId, !ok);
        else if (!ok) failed = true;
      }
      if (failed) return { ok: false, ms };
    }
    if (recorder) fireAsync(id, node, fired, Infinity, at + ms, miss, cacheFailed);
    return { ok: true, ms };
  };

  /**
   * A read goes on after the cache call `e` depends on when that call failed
   * or wasn't made, or else when it misses (P = 1 − the cache's hit rate).
   */
  const missedCache = (
    e: SampleCall,
    cacheFailed: Map<string, boolean> | undefined,
    t: number,
  ): boolean => {
    const failed = e.dependsOn === undefined ? undefined : cacheFailed?.get(e.dependsOn);
    if (failed !== false) {
      if (recorder && failed && e.missOf !== undefined) {
        recorder.onCacheResult(e.missOf, false, true, t);
      }
      return true;
    }
    const cache = e.missOf === undefined ? undefined : model.nodes.get(e.missOf);
    const missed = rng() < (cache?.missProbability ?? 1);
    if (recorder && e.missOf !== undefined) recorder.onCacheResult(e.missOf, !missed, false, t);
    return missed;
  };

  /**
   * One logical call with retries; the attempts are sequential. `from`,
   * `step` and `at` (when the call leaves) are for the recorder only.
   */
  const call = (
    caller: SampleNode,
    e: SampleEdge | SampleCall,
    from: string,
    step: number,
    at: number,
  ): Hop => {
    let ms = 0;
    const timeout = caller.timeoutMs;
    for (let attempt = 0; attempt <= caller.maxRetries; attempt++) {
      const rtt = 2 * e.networkLatencyMs;
      const handle = recorder ? recorder.onCall(from, traced(e, step), attempt, at + ms) : 0;
      if (rng() < e.packetLoss) {
        // Lost: the caller notices at its timeout (or after a round trip).
        recorder?.onReturn(handle, at + ms + (timeout ?? rtt), false);
        ms += timeout ?? rtt;
        continue;
      }
      const r = visit(e.target, at + ms + e.networkLatencyMs);
      const attemptMs = rtt + r.ms;
      if (timeout !== undefined && attemptMs > timeout) {
        recorder?.onReturn(handle, at + ms + timeout, false);
        ms += timeout;
        continue;
      }
      recorder?.onReturn(handle, at + ms + attemptMs, r.ok);
      ms += attemptMs;
      if (r.ok) return { ok: true, ms };
    }
    return { ok: false, ms };
  };

  /* ---------- recorder only: never runs without one ---------- */

  const traced = (e: SampleEdge | SampleCall, step: number): TracedCall => ({
    edgeId: e.edgeId ?? "",
    target: e.target,
    step: "step" in e && e.step !== undefined ? e.step : step,
  });

  /** A node whose own miss sends calls on (read-through: CDN → origin). */
  const readsThrough = (node: SampleNode): boolean =>
    node.steps.some((group) => group.some((c) => c.kind === "on_miss")) ||
    (node.asyncCalls ?? []).some((c) => c.kind === "on_miss");

  /**
   * Sends the node's async calls whose step comes before `beforeStep` (or is
   * it), from index `next` of its step-ordered `asyncCalls`, at time `t`;
   * returns where it stopped. Their conditions draw from the recorder's stream.
   */
  const fireAsync = (
    id: string,
    node: SampleNode,
    next: number,
    beforeStep: number,
    t: number,
    miss?: boolean,
    cacheFailed?: Map<string, boolean>,
  ): number => {
    const calls = node.asyncCalls ?? [];
    const draw = recorder!.rng;
    let i = next;
    for (; i < calls.length && (calls[i].step ?? Infinity) <= beforeStep; i++) {
      const e = calls[i];
      let taken: boolean;
      switch (e.kind) {
        case "reads":
          taken = isRead;
          break;
        case "writes":
          taken = !isRead;
          break;
        case "on_miss":
          taken = miss ?? draw() < node.missProbability;
          break;
        case "after_miss": {
          const failed = e.dependsOn === undefined ? undefined : cacheFailed?.get(e.dependsOn);
          const cache = e.missOf === undefined ? undefined : model.nodes.get(e.missOf);
          taken = isRead && (failed !== false || draw() < (cache?.missProbability ?? 1));
          break;
        }
        case "fraction":
          taken = draw() < e.fraction;
          break;
        default:
          taken = true;
      }
      if (!taken) continue;
      const whole = Math.floor(e.callsPerRequest);
      const count = whole + (draw() < e.callsPerRequest - whole ? 1 : 0);
      for (let k = 0; k < count; k++) recorder!.onAsync(id, traced(e, 1), t);
    }
    return i;
  };

  const latencies: number[] = [];
  for (let i = 0; i < n; i++) {
    visits = 0;
    isRead = rng() < model.readRatio;
    const entry = entries[Math.floor(rng() * entries.length)] ?? entries[0];
    const r = visit(entry, 0);
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
