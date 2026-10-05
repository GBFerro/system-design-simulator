import type { RequestTrace } from "@/engine/types";

/**
 * Layout of one request's sequence diagram (request-flow, the Flow tab;
 * FLW-34/35). Pure: a `RequestTrace` in, lifelines, arrows and hit/miss
 * marks with coordinates out, for `SequenceDiagram` to draw as SVG.
 *
 * - One lifeline per node the request touched, in order of first contact.
 * - Each sync call attempt is a call arrow and a response arrow back (its
 *   `t1`); an async call is a call arrow only. A call that wasn't made isn't
 *   in the trace, so it isn't drawn.
 * - Calls are numbered in the order they start; a response repeats its
 *   call's number. Rows go down in time: a response is drawn when it gets
 *   back, before what starts at that moment (the next step).
 * - A cache hit/miss marks the call into that cache.
 */

/** Horizontal distance between lifelines. */
export const LANE_WIDTH = 88;
/** Vertical distance between arrows. */
export const ROW_HEIGHT = 30;
/** Room above the first arrow for the lifeline headers. */
export const HEADER_HEIGHT = 40;
/** Left/right margin around the first and last lifeline. */
export const SIDE_MARGIN = 48;

export interface SequenceLifeline {
  nodeId: string;
  label: string;
  x: number;
}

export interface SequenceArrow {
  kind: "call" | "response" | "async";
  /** Number of the call in start order (1-based); a response repeats its call's. */
  n: number;
  edgeId: string;
  /** Where the arrow starts: the caller for a call, the callee for a response. */
  from: string;
  to: string;
  x1: number;
  x2: number;
  y: number;
  /** The call's outcome (an error or a timeout comes back as not ok); async: true. */
  ok: boolean;
  /** Call and response: the round trip, t1 − t0 (what the callee did included). */
  ms?: number;
  /** When it left (call, async) or came back (response), ms since the request started. */
  at: number;
  /** Retry number of a sync call (0 = first try). */
  attempt: number;
}

export interface SequenceMark {
  nodeId: string;
  hit: boolean;
  /** The cache call failed, so a miss. */
  viaFailure: boolean;
  /** Number of the call into the cache it marks. */
  n: number;
  x: number;
  y: number;
}

export interface SequenceLayout {
  lifelines: SequenceLifeline[];
  arrows: SequenceArrow[];
  marks: SequenceMark[];
  width: number;
  height: number;
}

type CallEvent = Extract<RequestTrace["events"][number], { type: "call" }>;

export function sequenceLayout(
  trace: RequestTrace,
  labels: Readonly<Record<string, string>> = {},
): SequenceLayout {
  // lifelines, in order of first contact
  const lane = new Map<string, number>();
  const touch = (id: string) => {
    if (!lane.has(id)) lane.set(id, lane.size);
  };
  for (const e of trace.events) {
    if (e.type === "cache") touch(e.nodeId);
    else {
      touch(e.from);
      touch(e.to);
    }
  }
  const xOf = (id: string) => SIDE_MARGIN + lane.get(id)! * LANE_WIDTH;
  const lifelines = [...lane.keys()].map((nodeId) => ({
    nodeId,
    label: labels[nodeId] ?? nodeId,
    x: xOf(nodeId),
  }));

  // rows, in time
  const arrows: SequenceArrow[] = [];
  const marks: SequenceMark[] = [];
  const pending: { call: CallEvent; n: number; started: number }[] = [];
  const lastCallInto = new Map<string, SequenceArrow>();
  let row = 0;
  const nextY = () => HEADER_HEIGHT + row++ * ROW_HEIGHT;

  /** Responses back by `t`: earliest first; on a tie the inner (later-started) call's first. */
  const flush = (t: number) => {
    const due = pending
      .filter((p) => p.call.t1 <= t)
      .sort((a, b) => a.call.t1 - b.call.t1 || b.started - a.started);
    for (const p of due) {
      pending.splice(pending.indexOf(p), 1);
      arrows.push({
        kind: "response",
        n: p.n,
        edgeId: p.call.edgeId,
        from: p.call.to,
        to: p.call.from,
        x1: xOf(p.call.to),
        x2: xOf(p.call.from),
        y: nextY(),
        ok: p.call.ok,
        ms: p.call.t1 - p.call.t0,
        at: p.call.t1,
        attempt: p.call.attempt,
      });
    }
  };

  let n = 0;
  for (const e of trace.events) {
    if (e.type === "cache") {
      const into = lastCallInto.get(e.nodeId);
      if (into) {
        marks.push({
          nodeId: e.nodeId,
          hit: e.hit,
          viaFailure: e.viaFailure,
          n: into.n,
          x: into.x2,
          y: into.y,
        });
      }
      continue;
    }
    flush(e.t0);
    n++;
    const arrow: SequenceArrow = {
      kind: e.type === "call" ? "call" : "async",
      n,
      edgeId: e.edgeId,
      from: e.from,
      to: e.to,
      x1: xOf(e.from),
      x2: xOf(e.to),
      y: nextY(),
      ok: e.type === "call" ? e.ok : true,
      at: e.t0,
      attempt: e.type === "call" ? e.attempt : 0,
    };
    if (e.type === "call") {
      arrow.ms = e.t1 - e.t0;
      pending.push({ call: e, n, started: arrows.length });
      lastCallInto.set(e.to, arrow);
    }
    arrows.push(arrow);
  }
  flush(Infinity);

  return {
    lifelines,
    arrows,
    marks,
    width: lifelines.length === 0 ? 0 : 2 * SIDE_MARGIN + (lifelines.length - 1) * LANE_WIDTH,
    height: lifelines.length === 0 ? 0 : HEADER_HEIGHT + row * ROW_HEIGHT,
  };
}
