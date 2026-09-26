import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM, defaultParams } from "@/domain/components/registry";
import { migrateGraphV1toV2, migrateV1toV2 } from "@/domain/persistence/migrate";
import { serializeEdges, serializeNodes } from "@/domain/persistence/serialize";
import { buildReferenceGraph } from "@/lib/loadReference";

// Spec 05, PER-01: migrateV1toV2 fixtures, idempotence, and the 35 references.

function v1Component(
  id: string,
  componentId: string,
  replicas: number,
  maxQPS: number,
  latencyMs: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    type: "component",
    position: { x: 10, y: 20 },
    data: {
      componentId,
      label: `${componentId} label`,
      icon: "Server",
      category: "compute",
      replicas,
      maxQPS,
      latencyMs,
      scalable: true,
      ...extra,
    },
  };
}

function v1Edge(id: string, source: string, target: string, data?: Record<string, unknown>) {
  return { id, type: "animated", source, target, sourceHandle: null, targetHandle: null, data };
}

/** migrate collecting warnings. */
function run<T extends object>(design: T) {
  const warnings: string[] = [];
  const out = migrateV1toV2(design, { onWarning: (w) => warnings.push(w) });
  return { out, warnings };
}

const SMALL = {
  name: "small",
  nodes: [
    v1Component("lb", "load-balancer", 2, 1_000_000, 1),
    v1Component("app", "app-server", 4, 6000, 25, {
      utilization: 0.9,
      status: "critical",
      isBottleneck: true,
    }),
    v1Component("cache", "cache", 1, 150_000, 1),
    v1Component("cdn", "cdn", 1, 500_000, 15),
    v1Component("db", "sql-db", 3, 12_000, 8),
  ],
  edges: [
    v1Edge("e1", "lb", "app", { label: "HTTPS", protocol: "http", async: false }),
    v1Edge("e2", "app", "cache", { label: "GET", protocol: "tcp", async: false }),
    v1Edge("e3", "cache", "db", { label: "miss", protocol: "tcp", async: false }),
    v1Edge("e4", "cdn", "lb", { label: "", protocol: "http", async: true }),
    // v1 edges created by very old builds had no data at all
    v1Edge("e5", "app", "db"),
  ],
};

const STROKES = [{ id: "s1", points: [[1, 2] as [number, number]], color: "#fff", width: 4 }];
const TEXT_NODE = {
  id: "note",
  type: "text",
  position: { x: 5, y: 5 },
  data: { text: "hello", fontSize: "lg" },
  connectable: false,
};

describe("migrateV1toV2", () => {
  it("handles an empty design", () => {
    expect(run({ nodes: [], edges: [] })).toEqual({ out: { nodes: [], edges: [] }, warnings: [] });
    // Missing arrays / garbage never throw
    expect(migrateV1toV2({}).nodes).toEqual([]);
    expect(migrateGraphV1toV2(null, "nope")).toEqual({ nodes: [], edges: [] });
    expect(migrateGraphV1toV2([null, 42, { id: "" }], [null])).toEqual({ nodes: [], edges: [] });
  });

  it("maps maxQPS/latencyMs/replicas to params and fills the rest from schema defaults", () => {
    const { out, warnings } = run(SMALL);
    expect(warnings).toEqual([]);
    const app = out.nodes.find((n) => n.id === "app")!;
    expect(app.data.params).toEqual({
      ...defaultParams("app-server"),
      [PARAM.capacityPerInstance]: 6000,
      [PARAM.serviceTimeMs]: 25,
      [PARAM.instances]: 4,
    });
    for (const field of [
      "maxQPS",
      "latencyMs",
      "replicas",
      "utilization",
      "status",
      "isBottleneck",
    ])
      expect(app.data).not.toHaveProperty(field);
    // Non-owned node fields survive
    expect(app).toMatchObject({ id: "app", type: "component", position: { x: 10, y: 20 } });
    expect(app.data).toMatchObject({
      componentId: "app-server",
      label: "app-server label",
      icon: "Server",
      category: "compute",
      scalable: true,
    });
    // Cache params include the routing-specific defaults
    expect(out.nodes.find((n) => n.id === "cache")!.data.params).toHaveProperty(PARAM.hitRate);
  });

  it("gives every edge a rule: on_miss out of cache/CDN, always otherwise", () => {
    const { out } = run(SMALL);
    const rule = (id: string) => out.edges.find((e) => e.id === id)!.data.rule;
    expect(rule("e1")).toMatchObject({ kind: "always", callsPerRequest: 1, packetLoss: 0 });
    expect(rule("e2")).toMatchObject({ kind: "always", callsPerRequest: 1 });
    expect(rule("e3")).toMatchObject({ kind: "on_miss", callsPerRequest: 1 });
    expect(rule("e4")).toMatchObject({ kind: "on_miss" });
    expect(rule("e5")).toMatchObject({ kind: "always", callsPerRequest: 1 });
  });

  it("preserves edge.data label/protocol/async", () => {
    const { out } = run(SMALL);
    for (const edge of SMALL.edges) {
      const migrated = out.edges.find((e) => e.id === edge.id)!;
      expect(migrated).toMatchObject({
        source: edge.source,
        target: edge.target,
        type: "animated",
        sourceHandle: null,
        targetHandle: null,
      });
      const { rule, ...rest } = migrated.data;
      expect(rule).toBeDefined();
      expect(rest).toEqual(edge.data ?? {});
    }
  });

  it("leaves text nodes and strokes untouched", () => {
    const design = {
      ...SMALL,
      nodes: [...SMALL.nodes, TEXT_NODE],
      edges: [...SMALL.edges, v1Edge("to-note", "app", "note", { protocol: "http" })],
      strokes: STROKES,
    };
    const { out, warnings } = run(design);
    expect(warnings).toEqual([]);
    expect(out.nodes.find((n) => n.id === "note")).toBe(TEXT_NODE);
    expect(out.strokes).toBe(STROKES);
    expect(out.name).toBe("small");
    // An edge touching a text node is kept (the engine skips it)
    expect(out.edges.find((e) => e.id === "to-note")!.data.rule).toMatchObject({ kind: "always" });
  });

  it("drops edges to non-existent nodes with a warning", () => {
    const design = {
      nodes: SMALL.nodes.slice(0, 2),
      edges: [
        v1Edge("ok", "lb", "app", { protocol: "http" }),
        v1Edge("dangling-target", "app", "ghost", { protocol: "http" }),
        v1Edge("dangling-source", "ghost", "lb"),
        { id: "no-endpoints" },
      ],
    };
    const { out, warnings } = run(design);
    expect(out.edges.map((e) => e.id)).toEqual(["ok"]);
    expect(out.nodes).toHaveLength(2);
    expect(warnings).toHaveLength(3);
    expect(warnings.join("\n")).toMatch(/missing node/);
  });

  it("keeps an unknown component type as custom with a warning", () => {
    const design = {
      nodes: [
        v1Component("q", "quantum-db", 2, 777, 3),
        v1Component("lb", "load-balancer", 1, 9, 1),
      ],
      edges: [v1Edge("e", "lb", "q", { protocol: "http" })],
    };
    const { out, warnings } = run(design);
    const q = out.nodes.find((n) => n.id === "q")!;
    expect(q.data.componentId).toBe("custom");
    expect(q.data.label).toBe("quantum-db label");
    expect(q.data.params).toMatchObject({
      [PARAM.capacityPerInstance]: 777,
      [PARAM.instances]: 2,
      [PARAM.serviceTimeMs]: 3,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/quantum-db/);
  });

  it("keeps v2 params and rules, sanitizing invalid values", () => {
    const design = {
      nodes: [
        {
          ...v1Component("cache", "cache", 1, 100, 1),
          data: {
            componentId: "cache",
            label: "Cache",
            icon: "Zap",
            category: "storage",
            scalable: true,
            // v2 params win over leftover v1 fields; invalid/unknown are fixed
            maxQPS: 1,
            params: { [PARAM.capacityPerInstance]: 4242, [PARAM.hitRate]: 7, bogus: 1 },
          },
        },
        v1Component("db", "sql-db", 1, 100, 1),
      ],
      edges: [
        v1Edge("e", "cache", "db", {
          protocol: "tcp",
          rule: { kind: "fraction", fraction: 0.25, callsPerRequest: 3, networkLatencyMs: -5 },
        }),
      ],
    };
    const { out } = run(design);
    const params = out.nodes[0].data.params as Record<string, unknown>;
    expect(params[PARAM.capacityPerInstance]).toBe(4242);
    expect(params[PARAM.hitRate]).toBe(defaultParams("cache")[PARAM.hitRate]);
    expect(params).not.toHaveProperty("bogus");
    expect(out.edges[0].data.rule).toEqual({
      kind: "fraction",
      fraction: 0.25,
      callsPerRequest: 3,
      networkLatencyMs: 0,
      packetLoss: 0,
    });
  });

  it("is idempotent: migrate(migrate(x)) equals migrate(x), with no new warnings", () => {
    const fixtures: object[] = [
      { nodes: [], edges: [] },
      SMALL,
      { ...SMALL, nodes: [...SMALL.nodes, TEXT_NODE], strokes: STROKES },
      { nodes: SMALL.nodes, edges: [...SMALL.edges, v1Edge("x", "app", "ghost")] },
      { nodes: [v1Component("q", "quantum-db", 2, 777, 3)], edges: [] },
      { nodes: [null, { id: "p", type: "component", position: "bad", data: 5 }], edges: [] },
    ];
    for (const fixture of fixtures) {
      const once = migrateV1toV2(fixture);
      const warnings: string[] = [];
      const twice = migrateV1toV2(once, { onWarning: (w) => warnings.push(w) });
      expect(twice).toEqual(once);
      expect(warnings).toEqual([]);
    }
  });

  it("all 35 reference solutions survive serialize → migrate unchanged", () => {
    expect(PROBLEMS).toHaveLength(35);
    for (const problem of PROBLEMS) {
      const { nodes, edges } = buildReferenceGraph(problem);
      expect(nodes.length, problem.id).toBeGreaterThan(0);

      // Storage shape (saved designs, export)
      const serialized = { nodes: serializeNodes(nodes), edges: serializeEdges(edges) };
      const warnings: string[] = [];
      const migrated = migrateV1toV2(serialized, { onWarning: (w) => warnings.push(w) });
      expect(migrated, problem.id).toEqual(serialized);
      expect(warnings, problem.id).toEqual([]);

      // Live shape (canvas tabs)
      const live = migrateGraphV1toV2(nodes, edges);
      expect(live.nodes as unknown as Node[], problem.id).toEqual(nodes);
      expect(live.edges as unknown as Edge[], problem.id).toEqual(edges);
    }
  });
});
