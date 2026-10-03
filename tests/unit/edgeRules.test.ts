import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { MAX_INSTANCES, PARAM } from "@/domain/components/registry";
import { parseParamInput } from "@/domain/components/paramInput";
import type { EdgeCall, EdgeRule, ParamSpec } from "@/domain/components/types";
import {
  DEFAULT_DLQ_FRACTION,
  DEFAULT_RULE_FRACTION,
  EDGE_CALL_KIND_OPTIONS,
  EDGE_CALL_SPECS,
  EDGE_LINK_SPECS,
  MAX_CALL_STEP,
  MAX_EDGE_CALLS,
  defaultEdgeAsync,
  defaultEdgeRule,
  edgeCallSpecsFor,
  edgeCallValues,
  edgeCallsBadge,
  edgeRuleBadge,
  migrateEdgeRuleV2toV3,
  sanitizeEdgeCalls,
} from "@/domain/graph/edgeRules";
import { planFor } from "@/domain/graph/callPlan";
import { createComponentNode } from "@/lib/nodeFactory";
import { useCanvasStore, type CustomEdgeData } from "@/store/canvasStore";

const s = () => useCanvasStore.getState();

function node(componentId: string, id = componentId): Node {
  const c = SYSTEM_COMPONENTS.find((x) => x.id === componentId)!;
  return { ...createComponentNode(c, { x: 0, y: 0 }), id };
}

function setCanvas(nodes: Node[], edges: Edge[] = [], readOnly = false) {
  useCanvasStore.setState({
    nodes,
    edges,
    history: [],
    future: [],
    clipboard: null,
    isDragging: false,
    tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly }],
    activeTabId: "t",
  });
}

const connect = (source: string, target: string) =>
  s().onConnect({ source, target, sourceHandle: null, targetHandle: null });

/** A one-call rule in the flat view these tests read (its call plus the link). */
function flat(rule: EdgeRule) {
  expect(rule.calls).toHaveLength(1);
  return { ...rule.calls[0], networkLatencyMs: rule.networkLatencyMs, packetLoss: rule.packetLoss };
}

const defaultRule = (...args: Parameters<typeof defaultEdgeRule>) => flat(defaultEdgeRule(...args));

function ruleOf(source: string, target: string) {
  const edge = s().edges.find((e) => e.source === source && e.target === target);
  const rule = (edge?.data as CustomEdgeData | undefined)?.rule;
  return rule && flat(rule);
}

describe("defaultEdgeRule", () => {
  it("cache and CDN outputs are on_miss", () => {
    expect(defaultRule("cache", "sql-db").kind).toBe("on_miss");
    expect(defaultRule("cdn", "object-storage").kind).toBe("on_miss");
    expect(defaultRule("origin-shield", "app-server").kind).toBe("on_miss");
  });

  it("LB and plain calls are always", () => {
    expect(defaultRule("load-balancer", "app-server").kind).toBe("always");
    expect(defaultRule("app-server", "sql-db").kind).toBe("always");
    expect(defaultRule("load-balancer", "read-replica").kind).toBe("always");
    expect(defaultRule(undefined, "sql-db").kind).toBe("always");
  });

  it("service → SQL DB with a replica writes; service → replica reads", () => {
    expect(defaultRule("app-server", "sql-db", "http", { targetHasReadReplica: true }).kind).toBe(
      "writes",
    );
    expect(defaultRule("app-server", "read-replica").kind).toBe("reads");
    expect(defaultRule("worker-pool", "read-replica").kind).toBe("reads");
    // A cache in front of the replica still only calls it on a miss
    expect(defaultRule("cache", "read-replica").kind).toBe("on_miss");
  });

  it("new components get meaningful defaults", () => {
    expect(defaultRule("sql-db", "read-replica").kind).toBe("writes");
    const dlq = defaultRule("message-queue", "dlq");
    expect(dlq.kind).toBe("fraction");
    expect(dlq.fraction).toBe(DEFAULT_DLQ_FRACTION);
    expect(defaultRule("autoscaler", "app-server").callsPerRequest).toBe(0);
    expect(defaultEdgeAsync("message-queue", "dlq")).toBe(true);
    expect(defaultEdgeAsync("sql-db", "read-replica")).toBe(true);
    expect(defaultEdgeAsync("autoscaler", "app-server")).toBe(true);
    expect(defaultEdgeAsync("app-server", "sql-db")).toBe(false);
  });

  it("network latency follows the protocol", () => {
    expect(defaultEdgeRule("app-server", "cache", "grpc").networkLatencyMs).toBe(0.5);
    expect(defaultEdgeRule("app-server", "cache", "http").networkLatencyMs).toBe(1);
  });

  it("badges summarize non-trivial rules", () => {
    expect(edgeRuleBadge(defaultEdgeRule("cache", "sql-db"))).toBe("miss");
    expect(edgeRuleBadge(defaultEdgeRule("app-server", "sql-db"))).toBeNull();
    expect(edgeRuleBadge(defaultEdgeRule("message-queue", "dlq"))).toBe("1%");
    expect(edgeRuleBadge(defaultEdgeRule("autoscaler", "app-server"))).toBe("×0");
  });
});

describe("connecting from the UI", () => {
  beforeEach(() => setCanvas([]));

  it("cache → DB is born on_miss", () => {
    setCanvas([node("cache"), node("sql-db")]);
    connect("cache", "sql-db");
    expect(ruleOf("cache", "sql-db")?.kind).toBe("on_miss");
  });

  it("adding a replica splits the service's DB edge into writes/reads in one undo step", () => {
    setCanvas([node("app-server"), node("sql-db"), node("read-replica")]);
    connect("app-server", "sql-db");
    expect(ruleOf("app-server", "sql-db")?.kind).toBe("always");
    connect("app-server", "read-replica");
    expect(ruleOf("app-server", "read-replica")?.kind).toBe("reads");
    expect(ruleOf("app-server", "sql-db")?.kind).toBe("writes");
    s().undo();
    expect(ruleOf("app-server", "read-replica")).toBeUndefined();
    expect(ruleOf("app-server", "sql-db")?.kind).toBe("always");
  });

  it("service → DB that already has a replica is born writes", () => {
    setCanvas([node("app-server"), node("sql-db"), node("read-replica")]);
    connect("sql-db", "read-replica");
    expect(ruleOf("sql-db", "read-replica")?.kind).toBe("writes");
    expect((s().edges[0].data as CustomEdgeData).async).toBe(true);
    connect("app-server", "sql-db");
    expect(ruleOf("app-server", "sql-db")?.kind).toBe("writes");
  });

  it("a DB without replica stays always", () => {
    setCanvas([node("app-server"), node("sql-db")]);
    connect("app-server", "sql-db");
    expect(ruleOf("app-server", "sql-db")?.kind).toBe("always");
  });
});

describe("look-aside connect default (FLW-24)", () => {
  beforeEach(() => setCanvas([]));

  const callsOf = (source: string, target: string) => {
    const edge = s().edges.find((e) => e.source === source && e.target === target);
    return (edge?.data as CustomEdgeData | undefined)?.rule?.calls;
  };

  it("Service → DB with a call to a cache is born writes + reads after a miss in that cache", () => {
    setCanvas([node("app-server", "app"), node("cache", "redis"), node("sql-db", "db")]);
    connect("app", "redis");
    connect("app", "db");
    expect(callsOf("app", "db")).toEqual([
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", missOf: "redis", callsPerRequest: 1 },
    ]);
    // The cache edge came first, so the plan runs the DB call after it, without a warning
    const plan = planFor(
      "app",
      s().edges.map((e) => ({
        id: e.id,
        target: e.target,
        async: false,
        calls: (e.data as CustomEdgeData).rule!.calls,
      })),
      (id) => id === "redis",
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.steps.map((step) => step.map((p) => p.target))).toEqual([
      ["redis"],
      ["db"],
      ["db"],
    ]);
  });

  it("a NoSQL database gets the same look-aside calls", () => {
    setCanvas([node("app-server", "app"), node("cache", "redis"), node("nosql-db", "db")]);
    connect("app", "redis");
    connect("app", "db");
    expect(callsOf("app", "db")).toEqual([
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", missOf: "redis", callsPerRequest: 1 },
    ]);
  });

  it("without a sync call to a cache the default stays as before", () => {
    setCanvas([node("app-server", "app"), node("cache", "redis"), node("sql-db", "db")]);
    // an async edge to the cache isn't a cache call on the request path
    s().onConnect({ source: "app", target: "redis", sourceHandle: null, targetHandle: null });
    s().updateEdgeData(s().edges[0].id, { async: true });
    connect("app", "db");
    expect(callsOf("app", "db")).toEqual([{ kind: "always", callsPerRequest: 1 }]);
  });

  it("with a read replica the DB keeps only the writes (the replica takes the reads)", () => {
    setCanvas([
      node("app-server", "app"),
      node("cache", "redis"),
      node("sql-db", "db"),
      node("read-replica", "rr"),
    ]);
    connect("db", "rr");
    connect("app", "redis");
    connect("app", "db");
    expect(callsOf("app", "db")).toEqual([{ kind: "writes", callsPerRequest: 1 }]);
  });

  it("a cache's own output stays read-through", () => {
    setCanvas([node("app-server", "app"), node("cache", "redis"), node("sql-db", "db")]);
    connect("app", "redis");
    connect("redis", "db");
    expect(callsOf("redis", "db")).toEqual([{ kind: "on_miss", callsPerRequest: 1 }]);
  });
});

describe("store edits", () => {
  it("updateNodeParams validates, pushes one history entry and is undoable", () => {
    setCanvas([node("cache", "c")]);
    s().updateNodeParams("c", { [PARAM.hitRate]: 0.5, bogus: 3 });
    const params = s().nodes[0].data.params as Record<string, unknown>;
    expect(params[PARAM.hitRate]).toBe(0.5);
    expect(params).not.toHaveProperty("bogus");
    expect(s().history).toHaveLength(1);
    s().updateNodeParams("c", { [PARAM.hitRate]: 0.5 }); // unchanged → no-op
    expect(s().history).toHaveLength(1);
    s().updateNodeParams("c", { [PARAM.hitRate]: 7 }); // invalid → default
    expect((s().nodes[0].data.params as Record<string, unknown>)[PARAM.hitRate]).toBe(0.9);
    s().undo();
    expect((s().nodes[0].data.params as Record<string, unknown>)[PARAM.hitRate]).toBe(0.5);
  });

  it("changeReplicas writes params.instances and clamps to MAX_INSTANCES", () => {
    setCanvas([node("app-server", "a")]);
    s().updateNodeParams("a", { [PARAM.instances]: MAX_INSTANCES });
    s().changeReplicas("a", 1);
    expect((s().nodes[0].data.params as Record<string, unknown>)[PARAM.instances]).toBe(
      MAX_INSTANCES,
    );
    s().changeReplicas("a", -1);
    expect((s().nodes[0].data.params as Record<string, unknown>)[PARAM.instances]).toBe(
      MAX_INSTANCES - 1,
    );
  });

  it("updateEdgeRule normalizes and defaults the fraction", () => {
    setCanvas([node("app-server"), node("cache")]);
    connect("app-server", "cache");
    const id = s().edges[0].id;
    s().updateEdgeRule(id, { kind: "fraction" });
    expect(ruleOf("app-server", "cache")).toMatchObject({
      kind: "fraction",
      fraction: DEFAULT_RULE_FRACTION,
    });
    s().updateEdgeRule(id, { packetLoss: 5, callsPerRequest: 3 });
    expect(ruleOf("app-server", "cache")).toMatchObject({ packetLoss: 1, callsPerRequest: 3 });
    s().updateEdgeRule(id, { kind: "always" });
    expect(ruleOf("app-server", "cache")?.fraction).toBeUndefined();
    expect(s().history).toHaveLength(4);
  });

  it("read-only tabs reject param and rule edits", () => {
    setCanvas(
      [node("app-server", "a"), node("cache", "c")],
      [{ id: "e", source: "a", target: "c", data: { rule: defaultEdgeRule("app-server") } }],
      true,
    );
    s().updateNodeParams("a", { [PARAM.instances]: 5 });
    s().updateEdgeRule("e", { kind: "reads" });
    expect((s().nodes[0].data.params as Record<string, unknown>)[PARAM.instances]).toBe(1);
    expect(ruleOf("a", "c")?.kind).toBe("always");
    expect(s().history).toHaveLength(0);
  });
});

describe("edge calls (request-flow, schema v3)", () => {
  const FALLBACK: EdgeCall[] = [{ kind: "on_miss", callsPerRequest: 1 }];

  function sanitize(raw: unknown, fallback: EdgeCall[] = FALLBACK) {
    const warnings: string[] = [];
    const calls = sanitizeEdgeCalls(raw, fallback, (w) => warnings.push(w));
    return { calls, warnings };
  }

  describe("migrateEdgeRuleV2toV3", () => {
    it("turns a flat v2 rule into the link plus one call, keeping on_miss", () => {
      expect(
        migrateEdgeRuleV2toV3({
          kind: "on_miss",
          callsPerRequest: 2,
          networkLatencyMs: 1.5,
          packetLoss: 0.01,
        }),
      ).toEqual({
        calls: [{ kind: "on_miss", callsPerRequest: 2 }],
        networkLatencyMs: 1.5,
        packetLoss: 0.01,
      });
      expect(
        migrateEdgeRuleV2toV3({
          kind: "fraction",
          fraction: 0.1,
          callsPerRequest: 1,
          networkLatencyMs: 1,
          packetLoss: 0,
        }),
      ).toEqual({
        calls: [{ kind: "fraction", fraction: 0.1, callsPerRequest: 1 }],
        networkLatencyMs: 1,
        packetLoss: 0,
      });
    });

    it("is idempotent", () => {
      const inputs: unknown[] = [
        { kind: "writes", callsPerRequest: 1, networkLatencyMs: 1, packetLoss: 0 },
        { kind: "on_miss", callsPerRequest: 1, networkLatencyMs: 2, packetLoss: 0 },
        { packetLoss: 0.2 },
        {},
        { calls: [{ kind: "reads", callsPerRequest: 1 }], networkLatencyMs: 1, packetLoss: 0 },
      ];
      for (const raw of inputs) {
        const once = migrateEdgeRuleV2toV3(raw);
        expect(migrateEdgeRuleV2toV3(once)).toEqual(once);
      }
      const v3 = {
        calls: [{ kind: "reads", callsPerRequest: 1 }],
        networkLatencyMs: 1,
        packetLoss: 0,
      };
      expect(migrateEdgeRuleV2toV3(v3)).toEqual(v3);
    });

    it("never throws on invalid input", () => {
      const garbage: unknown[] = [null, undefined, 42, "rule", [], [1, 2], { calls: 5 }, NaN];
      for (const raw of garbage) {
        expect(() => migrateEdgeRuleV2toV3(raw)).not.toThrow();
        expect(migrateEdgeRuleV2toV3(raw)).toEqual(raw);
      }
    });
  });

  describe("sanitizeEdgeCalls", () => {
    it("keeps a valid list as it is, without warnings", () => {
      const raw: EdgeCall[] = [
        { kind: "writes", callsPerRequest: 1, step: 2 },
        { kind: "after_miss", missOf: "redis", callsPerRequest: 1, step: 3 },
        { kind: "fraction", fraction: 0.25, callsPerRequest: 3 },
      ];
      expect(sanitize(raw)).toEqual({ calls: raw, warnings: [] });
    });

    it(`keeps the first MAX_EDGE_CALLS calls and warns`, () => {
      const raw = Array.from({ length: MAX_EDGE_CALLS + 3 }, (_, i) => ({
        kind: "always",
        callsPerRequest: i + 1,
      }));
      const { calls, warnings } = sanitize(raw);
      expect(calls).toHaveLength(MAX_EDGE_CALLS);
      expect(calls.map((c) => c.callsPerRequest)).toEqual(
        raw.slice(0, MAX_EDGE_CALLS).map((c) => c.callsPerRequest),
      );
      expect(warnings).toHaveLength(1);
    });

    it("brings a step outside 1..MAX_CALL_STEP into range and warns", () => {
      const { calls, warnings } = sanitize([
        { kind: "reads", callsPerRequest: 1, step: 0 },
        { kind: "writes", callsPerRequest: 1, step: MAX_CALL_STEP + 5 },
        { kind: "always", callsPerRequest: 1, step: MAX_CALL_STEP },
      ]);
      expect(calls.map((c) => c.step)).toEqual([1, MAX_CALL_STEP, MAX_CALL_STEP]);
      expect(warnings).toHaveLength(2);
    });

    it("replaces an unknown condition by always and warns", () => {
      const { calls, warnings } = sanitize([{ kind: "sometimes", callsPerRequest: 2 }]);
      expect(calls).toEqual([{ kind: "always", callsPerRequest: 2 }]);
      expect(warnings).toHaveLength(1);
    });

    it("an empty or missing list is the fallback", () => {
      const fallback: EdgeCall[] = [
        { kind: "writes", callsPerRequest: 1 },
        { kind: "after_miss", missOf: "redis", callsPerRequest: 1 },
      ];
      for (const raw of [[], undefined, null, "calls"]) {
        const { calls } = sanitize(raw, fallback);
        expect(calls).toEqual(fallback);
        expect(calls).not.toBe(fallback);
      }
    });
  });
});

describe("call form and badge (T14)", () => {
  const specOf = (specs: readonly ParamSpec[], key: string) => specs.find((s) => s.key === key)!;
  const kindValues = (specs: readonly ParamSpec[]) =>
    specOf(specs, "kind").options!.map((o) => o.value);
  const rule = (...calls: EdgeCall[]): EdgeRule => ({
    calls,
    networkLatencyMs: 1,
    packetLoss: 0,
  });
  const labelOf = (id: string) => ({ redis: "Redis" })[id] ?? id;

  it("edits condition, fraction, step and calls per request per call; latency and loss per link", () => {
    expect(EDGE_CALL_SPECS.map((s) => s.key)).toEqual(
      expect.arrayContaining(["kind", "fraction", "step", "callsPerRequest"]),
    );
    expect(EDGE_CALL_SPECS.map((s) => s.key)).not.toContain("networkLatencyMs");
    expect(EDGE_LINK_SPECS.map((s) => s.key)).toEqual(["networkLatencyMs", "packetLoss"]);
  });

  it("bounds the step by MAX_CALL_STEP (FLW-26, FLW-49)", () => {
    const step = specOf(EDGE_CALL_SPECS, "step");
    expect(step).toMatchObject({ kind: "number", min: 1, max: MAX_CALL_STEP, step: 1 });
    expect(parseParamInput(step, String(MAX_CALL_STEP)).value).toBe(MAX_CALL_STEP);
    expect(parseParamInput(step, String(MAX_CALL_STEP + 1)).rejected).toBe(true);
    expect(parseParamInput(step, "0").rejected).toBe(true);
  });

  it("labels read-through and the look-aside condition, keeping on_miss as the stored value (FLW-14)", () => {
    const label = (v: string) => EDGE_CALL_KIND_OPTIONS.find((o) => o.value === v)?.label;
    expect(label("on_miss")).toBe("Read-through (cache's own miss)");
    expect(label("after_miss")).toBe("Reads after a miss in…");
  });

  it("offers reads-after-a-miss only when the source calls a cache, listing those caches (FLW-08)", () => {
    const plain = edgeCallSpecsFor(
      { caches: [], readThrough: false },
      { kind: "writes", callsPerRequest: 1 },
    );
    expect(kindValues(plain)).not.toContain("after_miss");

    const withCache = edgeCallSpecsFor(
      { caches: [{ id: "redis", label: "Redis" }], readThrough: false },
      { kind: "writes", callsPerRequest: 1 },
    );
    expect(kindValues(withCache)).toContain("after_miss");
    expect(specOf(withCache, "missOf").options).toEqual([{ value: "redis", label: "Redis" }]);
    const missOf = specOf(withCache, "missOf");
    expect(missOf.visibleIf!({ kind: "after_miss" })).toBe(true);
    expect(missOf.visibleIf!({ kind: "writes" })).toBe(false);
  });

  it("offers read-through only out of a node with a hit rate, unless the call already uses it (FLW-14)", () => {
    const writes = { kind: "writes", callsPerRequest: 1 } as const;
    expect(kindValues(edgeCallSpecsFor({ caches: [], readThrough: false }, writes))).not.toContain(
      "on_miss",
    );
    expect(kindValues(edgeCallSpecsFor({ caches: [], readThrough: true }, writes))).toContain(
      "on_miss",
    );
    expect(
      kindValues(
        edgeCallSpecsFor(
          { caches: [], readThrough: false },
          { kind: "on_miss", callsPerRequest: 1 },
        ),
      ),
    ).toContain("on_miss");
  });

  it("form values carry the call's fields and the step it runs at", () => {
    expect(edgeCallValues({ kind: "after_miss", missOf: "redis", callsPerRequest: 2 }, 3)).toEqual({
      kind: "after_miss",
      missOf: "redis",
      fraction: DEFAULT_RULE_FRACTION,
      step: 3,
      callsPerRequest: 2,
    });
  });

  it("badges the calls with the cache's name (FLW-15)", () => {
    expect(
      edgeCallsBadge(
        rule(
          { kind: "writes", callsPerRequest: 1 },
          { kind: "after_miss", missOf: "redis", callsPerRequest: 1 },
        ),
        labelOf,
      ),
    ).toBe("writes · miss: Redis");
    expect(edgeCallsBadge(rule({ kind: "reads", callsPerRequest: 1 }), labelOf)).toBe("reads");
    expect(edgeCallsBadge(rule({ kind: "always", callsPerRequest: 3 }), labelOf)).toBe("×3");
    expect(edgeCallsBadge(rule({ kind: "always", callsPerRequest: 1 }), labelOf)).toBeNull();
  });
});
