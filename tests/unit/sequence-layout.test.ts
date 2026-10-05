import { describe, expect, it } from "vitest";
import type { RequestTrace, TraceEvent } from "@/engine/types";
import { LANE_WIDTH, SIDE_MARGIN, sequenceLayout } from "@/lib/sequenceLayout";

/** The sequence diagram's layout (request-flow, FLW-34/35). */

const call = (from: string, to: string, t0: number, t1: number, ok = true): TraceEvent => ({
  type: "call",
  edgeId: `${from}-${to}`,
  from,
  to,
  step: 1,
  t0,
  t1,
  ok,
  attempt: 0,
});
const async = (from: string, to: string, t0: number): TraceEvent => ({
  type: "async",
  edgeId: `${from}-${to}`,
  from,
  to,
  step: 2,
  t0,
});
const cache = (nodeId: string, hit: boolean, viaFailure = false): TraceEvent => ({
  type: "cache",
  nodeId,
  hit,
  viaFailure,
});
const trace = (events: TraceEvent[], totalMs = 0): RequestTrace => ({
  cls: "read",
  ok: true,
  totalMs,
  events,
});

/** A read through the URL Shortener shape: lb → app; app → cache (miss), app → db; app → mon (async). */
const missRead = trace([
  call("lb", "app", 0, 40),
  call("app", "cache", 2, 6),
  cache("cache", false),
  call("app", "db", 6, 36),
  async("app", "mon", 36),
]);

describe("sequenceLayout", () => {
  it("one lifeline per touched node, in order of first contact, with its label", () => {
    const layout = sequenceLayout(missRead, { lb: "Load Balancer", app: "App Server" });
    expect(layout.lifelines.map((l) => [l.nodeId, l.label])).toEqual([
      ["lb", "Load Balancer"],
      ["app", "App Server"],
      ["cache", "cache"],
      ["db", "db"],
      ["mon", "mon"],
    ]);
    expect(layout.lifelines.map((l) => l.x)).toEqual(
      [0, 1, 2, 3, 4].map((i) => SIDE_MARGIN + i * LANE_WIDTH),
    );
  });

  it("a sync call is an arrow there and one back; an async call only the one there", () => {
    const { arrows } = sequenceLayout(missRead);
    const of = (edgeId: string) => arrows.filter((a) => a.edgeId === edgeId).map((a) => a.kind);
    expect(of("lb-app")).toEqual(["call", "response"]);
    expect(of("app-cache")).toEqual(["call", "response"]);
    expect(of("app-db")).toEqual(["call", "response"]);
    expect(of("app-mon")).toEqual(["async"]);
    const there = arrows.find((a) => a.edgeId === "app-db" && a.kind === "call")!;
    const back = arrows.find((a) => a.edgeId === "app-db" && a.kind === "response")!;
    expect([back.from, back.to, back.x1, back.x2]).toEqual(["db", "app", there.x2, there.x1]);
    expect(there.ms).toBe(30);
  });

  it("a call that wasn't made isn't drawn: a hit has no database lifeline nor arrow", () => {
    const hit = sequenceLayout(
      trace([call("lb", "app", 0, 10), call("app", "cache", 2, 6), cache("cache", true)]),
    );
    expect(hit.lifelines.map((l) => l.nodeId)).toEqual(["lb", "app", "cache"]);
    expect(hit.arrows.some((a) => a.to === "db" || a.from === "db")).toBe(false);
  });

  it("calls are numbered in start order; rows go down in time, each response after its call", () => {
    const { arrows } = sequenceLayout(missRead);
    expect(arrows.map((a) => `${a.kind}:${a.edgeId}:${a.n}`)).toEqual([
      "call:lb-app:1",
      "call:app-cache:2",
      "response:app-cache:2",
      "call:app-db:3",
      "response:app-db:3",
      "async:app-mon:4",
      "response:lb-app:1",
    ]);
    const ys = arrows.map((a) => a.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
  });

  it("parallel calls take consecutive numbers; on a tie the inner response comes back first", () => {
    // app calls b ∥ c at 0; b calls d with no network time, so d and b end together at 5
    const { arrows } = sequenceLayout(
      trace([call("app", "b", 0, 5), call("app", "c", 0, 8), call("b", "d", 0, 5)]),
    );
    expect(arrows.map((a) => `${a.kind}:${a.edgeId}:${a.n}`)).toEqual([
      "call:app-b:1",
      "call:app-c:2",
      "call:b-d:3",
      "response:b-d:3",
      "response:app-b:1",
      "response:app-c:2",
    ]);
  });

  it("marks the cache's hit or miss on the call into it", () => {
    const { arrows, marks } = sequenceLayout(missRead);
    const into = arrows.find((a) => a.kind === "call" && a.to === "cache")!;
    expect(marks).toEqual([
      { nodeId: "cache", hit: false, viaFailure: false, n: into.n, x: into.x2, y: into.y },
    ]);
    const failed = sequenceLayout(
      trace([
        call("app", "cache", 0, 2, false),
        cache("cache", false, true),
        call("app", "db", 2, 9),
      ]),
    );
    expect(failed.marks[0]).toMatchObject({ hit: false, viaFailure: true, n: 1 });
    expect(failed.arrows.find((a) => a.kind === "response" && a.from === "cache")!.ok).toBe(false);
  });

  it("an empty trace lays out nothing", () => {
    expect(sequenceLayout(trace([]))).toEqual({
      lifelines: [],
      arrows: [],
      marks: [],
      width: 0,
      height: 0,
    });
  });
});
