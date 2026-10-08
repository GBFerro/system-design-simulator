import { describe, expect, it } from "vitest";
import type { EdgeCall } from "@/domain/components/types";
import { planFor, type CallPlan, type PlanEdge } from "@/domain/graph/callPlan";

const CACHES = new Set(["redis", "cdn"]);
const hasHitRate = (id: string) => CACHES.has(id);

function edge(target: string, calls: EdgeCall[], async = false): PlanEdge {
  return { id: `b-${target}`, target, async, calls };
}

const call = (kind: EdgeCall["kind"], extra: Partial<EdgeCall> = {}): EdgeCall => ({
  kind,
  callsPerRequest: 1,
  ...extra,
});

/** Each step as "edgeId#index@step", for compact assertions. */
function shape(plan: CallPlan): string[][] {
  return plan.steps.map((group) => group.map((p) => `${p.edgeId}#${p.index}@${p.step}`));
}

describe("callPlan (request-flow)", () => {
  it("without explicit steps, the call at position i runs at step i + 1", () => {
    const plan = planFor(
      "b",
      [
        edge("redis", [call("reads")]),
        edge("db", [call("writes"), call("fraction", { fraction: 0.1 })]),
        edge("log", [call("always")], true),
        edge("search", [call("always")]),
      ],
      hasHitRate,
    );
    expect(shape(plan)).toEqual([["b-redis#0@1"], ["b-db#0@2"], ["b-db#1@3"], ["b-search#0@5"]]);
    expect(plan.async.map((p) => `${p.edgeId}#${p.index}@${p.step}`)).toEqual(["b-log#0@4"]);
    expect(plan.warnings).toEqual([]);
  });

  it("with an explicit step, calls without one go after the highest step, one per step", () => {
    const plan = planFor(
      "b",
      [
        edge("c", [call("always", { step: 2 })]),
        edge("d", [call("always")]),
        edge("e", [call("always", { step: 1 })]),
        edge("f", [call("always")]),
      ],
      hasHitRate,
    );
    expect(shape(plan)).toEqual([["b-e#0@1"], ["b-c#0@2"], ["b-d#0@3"], ["b-f#0@4"]]);
  });

  it("calls with the same step form one parallel group", () => {
    const plan = planFor(
      "b",
      [
        edge("c", [call("always", { step: 1 })]),
        edge("e", [call("always", { step: 1 })]),
        edge("d", [call("always", { step: 2 })]),
      ],
      hasHitRate,
    );
    expect(shape(plan)).toEqual([["b-c#0@1", "b-e#0@1"], ["b-d#0@2"]]);
  });

  describe("after_miss with an invalid dependency counts as reads, with a warning", () => {
    const cases: [string, PlanEdge[]][] = [
      [
        "missOf names a node that doesn't exist",
        [edge("db", [call("after_miss", { missOf: "ghost" })])],
      ],
      [
        "missOf names a node the source doesn't call synchronously",
        [
          edge("redis", [call("always")], true),
          edge("db", [call("after_miss", { missOf: "redis" })]),
        ],
      ],
      [
        "missOf names a node without hit rate",
        [edge("api", [call("always")]), edge("db", [call("after_miss", { missOf: "api" })])],
      ],
      ["missOf is missing", [edge("redis", [call("reads")]), edge("db", [call("after_miss")])]],
    ];
    it.each(cases)("%s", (_name, edges) => {
      const plan = planFor("b", edges, hasHitRate);
      const db = plan.steps.flat().find((p) => p.target === "db")!;
      expect(db.call).toEqual({ kind: "reads", callsPerRequest: 1 });
      expect(db.dependsOn).toBeUndefined();
      expect(plan.absorbed).toEqual([]);
      expect(plan.warnings).toHaveLength(1);
    });
  });

  it("a valid after_miss depends on the cache call, and that call's failure is absorbed", () => {
    const plan = planFor(
      "b",
      [
        edge("redis", [call("reads")]),
        edge("db", [call("writes"), call("after_miss", { missOf: "redis" })]),
      ],
      hasHitRate,
    );
    const afterMiss = plan.steps.flat().find((p) => p.call.kind === "after_miss")!;
    expect(afterMiss.dependsOn).toBe("b-redis");
    expect(afterMiss.call).toEqual(call("after_miss", { missOf: "redis" }));
    expect(plan.absorbed).toEqual(["b-redis"]);
    // implicit order already puts it after the cache call: no warning
    expect(shape(plan)).toEqual([["b-redis#0@1"], ["b-db#0@2"], ["b-db#1@3"]]);
    expect(plan.warnings).toEqual([]);
  });

  it("an after_miss at or before its dependency's step runs right after it, with a warning", () => {
    for (const step of [1, 2]) {
      const plan = planFor(
        "b",
        [
          edge("redis", [call("reads", { step: 2 })]),
          edge("db", [call("after_miss", { missOf: "redis", step })]),
        ],
        hasHitRate,
      );
      expect(shape(plan)).toEqual([["b-redis#0@2"], ["b-db#0@3"]]);
      expect(plan.warnings).toHaveLength(1);
    }
    const later = planFor(
      "b",
      [
        edge("redis", [call("reads", { step: 1 })]),
        edge("db", [call("after_miss", { missOf: "redis", step: 4 })]),
      ],
      hasHitRate,
    );
    expect(shape(later)).toEqual([["b-redis#0@1"], ["b-db#0@4"]]);
    expect(later.warnings).toEqual([]);
  });

  it.each(["lb", "queue"] as const)("%s ignores explicit steps", (routing) => {
    const plan = planFor(
      "b",
      [edge("c", [call("always", { step: 3 })]), edge("d", [call("always", { step: 1 })])],
      hasHitRate,
      { routing },
    );
    expect(shape(plan)).toEqual([["b-c#0@1"], ["b-d#0@2"]]);
    expect(plan.warnings).toEqual([]);
  });
});
