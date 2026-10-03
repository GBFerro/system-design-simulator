/**
 * Trace of one request (request-flow, OBS-06: the Flow tab).
 *
 * Samples ONE request through the sampler's model with a recorder attached,
 * so the trace takes the same path, the same hit/miss and the same times as
 * the requests behind the latency percentiles: there is no second model of
 * a request. Request `index` of a sequence draws from its own seeded stream,
 * so the same model + seed + index always gives the same trace and "another
 * request" is just the next index.
 */
import type { SimGraph } from "@/domain/graph/compile";
import { analyzeWithModel } from "../analyze";
import { NO_ENTRY_WARNING } from "../constants";
import type { RequestTrace, SimConfig, TraceEvent } from "../types";
import { mulberry32, type Rng } from "./rng";
import { sampleLatency, type Recorder, type SampleModel, type TracedCall } from "./sampler";

/** Seed of request `index` of the sequence that starts at `seed`. */
export function requestSeed(seed: number, index: number): number {
  const i = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  return (Math.trunc(Number.isFinite(seed) ? seed : 0) ^ Math.imul(i + 1, 0x9e3779b1)) | 0;
}

/** The recorder's own stream (async calls' conditions), apart from the sampler's. */
const TRACE_STREAM = 0x85ebca6b;

/** Events with the time that orders them (a cache result has no `t0` of its own). */
interface Timed {
  at: number;
  event: TraceEvent;
}

class TraceRecorder implements Recorder {
  readonly rng: Rng;
  readonly timed: Timed[] = [];
  private readonly calls: Extract<TraceEvent, { type: "call" }>[] = [];

  constructor(rng: Rng) {
    this.rng = rng;
  }

  onCall(from: string, call: TracedCall, attempt: number, t0: number): number {
    const event: Extract<TraceEvent, { type: "call" }> = {
      type: "call",
      edgeId: call.edgeId,
      from,
      to: call.target,
      step: call.step,
      t0,
      t1: t0,
      ok: false,
      attempt,
    };
    this.timed.push({ at: t0, event });
    this.calls.push(event);
    return this.calls.length - 1;
  }

  onReturn(handle: number, t1: number, ok: boolean): void {
    const event = this.calls[handle];
    event.t1 = t1;
    event.ok = ok;
  }

  onAsync(from: string, call: TracedCall, t0: number): void {
    this.timed.push({
      at: t0,
      event: { type: "async", edgeId: call.edgeId, from, to: call.target, step: call.step, t0 },
    });
  }

  onCacheResult(nodeId: string, hit: boolean, viaFailure: boolean, t: number): void {
    this.timed.push({ at: t, event: { type: "cache", nodeId, hit, viaFailure } });
  }
}

/**
 * Request `index` of the sequence `seed` through `model`, as a read or a
 * write. Pure and deterministic.
 */
export function traceRequest(
  model: SampleModel,
  seed: number,
  index: number,
  cls: "read" | "write",
): RequestTrace {
  const base = requestSeed(seed, index);
  const recorder = new TraceRecorder(mulberry32(base ^ TRACE_STREAM));
  // The class draw still happens (rng() < 1 is always a read, < 0 never), so
  // the request takes the sampler's own path through its stream.
  const forced: SampleModel = { ...model, readRatio: cls === "read" ? 1 : 0 };
  const result = sampleLatency(forced, 1, mulberry32(base), undefined, recorder);

  // Stable: what starts at the same time keeps the order it happened in.
  const events = recorder.timed.sort((a, b) => a.at - b.at).map((t) => t.event);
  const ok = result.successRate > 0;
  // The entry makes the first call (nothing starts before it).
  const entryId = events.find((e) => e.type !== "cache")?.from;
  // A failed request ends when the entry's last call came back (or gave up).
  const lastEnd = events.reduce(
    (end, e) => (e.type === "call" && e.from === entryId ? Math.max(end, e.t1) : end),
    0,
  );
  return { cls, ok, totalMs: ok ? result.latency.meanMs : lastEnd, events };
}

/** What `traceGraph` (and `traceCanvas`) traces. */
export interface TraceOptions {
  /** Load of the steady state the request is sampled at; missing or invalid = 1 req/s. */
  rps?: number;
  config?: SimConfig;
  cls: "read" | "write";
  /** Request number in the sequence ("Another request" = the next one). */
  index: number;
}

/** A trace plus the warnings of the design it ran on. */
export type GraphTrace = RequestTrace & { warnings: string[] };

/**
 * One request through a compiled graph: `analyze()` at the given load, then
 * `traceRequest` on its sampler model with the run's seed. Without an entry
 * there's nothing to trace: no events and `NO_ENTRY_WARNING`.
 */
export function traceGraph(graph: SimGraph, options: TraceOptions): GraphTrace {
  const rps =
    options.rps !== undefined && Number.isFinite(options.rps) && options.rps > 0 ? options.rps : 1;
  const { steady, model } = analyzeWithModel(graph, rps, options.config);
  if (model.entries.length === 0) {
    return {
      cls: options.cls,
      ok: false,
      totalMs: 0,
      events: [],
      warnings: [...steady.warnings, NO_ENTRY_WARNING],
    };
  }
  const trace = traceRequest(model, steady.seed, options.index, options.cls);
  return { ...trace, warnings: steady.warnings };
}
