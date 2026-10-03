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
import type { RequestTrace, TraceEvent } from "../types";
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
