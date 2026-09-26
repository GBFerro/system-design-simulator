import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { MAX_INSTANCES, PARAM } from "@/domain/components/registry";
import type { EdgeRule } from "@/domain/components/types";
import {
  DEFAULT_DLQ_FRACTION,
  DEFAULT_RULE_FRACTION,
  defaultEdgeAsync,
  defaultEdgeRule,
  edgeRuleBadge,
} from "@/domain/graph/edgeRules";
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

function ruleOf(source: string, target: string): EdgeRule | undefined {
  const edge = s().edges.find((e) => e.source === source && e.target === target);
  return (edge?.data as CustomEdgeData | undefined)?.rule;
}

describe("defaultEdgeRule", () => {
  it("cache and CDN outputs are on_miss", () => {
    expect(defaultEdgeRule("cache", "sql-db").kind).toBe("on_miss");
    expect(defaultEdgeRule("cdn", "object-storage").kind).toBe("on_miss");
    expect(defaultEdgeRule("origin-shield", "app-server").kind).toBe("on_miss");
  });

  it("LB and plain calls are always", () => {
    expect(defaultEdgeRule("load-balancer", "app-server").kind).toBe("always");
    expect(defaultEdgeRule("app-server", "sql-db").kind).toBe("always");
    expect(defaultEdgeRule("load-balancer", "read-replica").kind).toBe("always");
    expect(defaultEdgeRule(undefined, "sql-db").kind).toBe("always");
  });

  it("service → SQL DB with a replica writes; service → replica reads", () => {
    expect(
      defaultEdgeRule("app-server", "sql-db", "http", { targetHasReadReplica: true }).kind,
    ).toBe("writes");
    expect(defaultEdgeRule("app-server", "read-replica").kind).toBe("reads");
    expect(defaultEdgeRule("worker-pool", "read-replica").kind).toBe("reads");
    // A cache in front of the replica still only calls it on a miss
    expect(defaultEdgeRule("cache", "read-replica").kind).toBe("on_miss");
  });

  it("new components get meaningful defaults", () => {
    expect(defaultEdgeRule("sql-db", "read-replica").kind).toBe("writes");
    const dlq = defaultEdgeRule("message-queue", "dlq");
    expect(dlq.kind).toBe("fraction");
    expect(dlq.fraction).toBe(DEFAULT_DLQ_FRACTION);
    expect(defaultEdgeRule("autoscaler", "app-server").callsPerRequest).toBe(0);
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
