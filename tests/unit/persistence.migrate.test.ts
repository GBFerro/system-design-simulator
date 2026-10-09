import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM, defaultParams } from "@/domain/components/registry";
import type { EdgeRule } from "@/domain/components/types";
import { compileGraph } from "@/domain/graph/compile";
import { requestEdges, responseOf } from "@/domain/graph/returns";
import {
  migrateGraph,
  migrateGraphV1toV2,
  migrateGraphV3toV4,
  migrateV1toV2,
  type MigratedGraph,
} from "@/domain/persistence/migrate";
import { serializeEdges, serializeNodes } from "@/domain/persistence/serialize";
import { analyze } from "@/engine/analyze";
import { buildReferenceGraph } from "@/lib/loadReference";
import { migrateCanvasState, migrateSavedDesignsState } from "@/store/migrations";
import { comp } from "./engineFixtures";

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

// request-flow, FLW-18/19: schema v3 turns every edge rule into the link plus a list of calls.
describe("migrateGraph: v1 → v2 → v3", () => {
  const v2Rule = (kind: string, extra: Record<string, unknown> = {}) => ({
    kind,
    callsPerRequest: 1,
    networkLatencyMs: 1,
    packetLoss: 0,
    ...extra,
  });
  const v2Edge = (source: string, target: string, rule: unknown) => ({
    id: `e-${source}-${target}`,
    type: "animated",
    source,
    target,
    data: { label: "", protocol: "http", async: false, rule },
  });

  /** A v2 design: Client → App → Cache (reads), Cache → DB (on_miss), App → DB (writes), App → Search. */
  function v2Design() {
    return {
      nodes: [
        comp("client", "client"),
        comp("app", "app-server", { instances: 4 }),
        comp("cache", "cache", { hitRate: 0.8 }),
        comp("db", "sql-db"),
        comp("search", "search"),
      ],
      edges: [
        v2Edge("client", "app", v2Rule("always")),
        v2Edge("app", "cache", v2Rule("reads")),
        v2Edge("cache", "db", v2Rule("on_miss")),
        v2Edge("app", "db", v2Rule("writes")),
        v2Edge("app", "search", v2Rule("fraction", { fraction: 0.3, callsPerRequest: 2 })),
      ],
    };
  }

  const ruleOf = (g: MigratedGraph, source: string, target: string) =>
    g.edges.find((e) => e.source === source && e.target === target)!.data.rule as EdgeRule;

  it("a v2 cache → DB on_miss keeps every edge where it was and becomes one read-through call", () => {
    const { nodes, edges } = v2Design();
    const out = migrateGraph(nodes, edges);
    expect(out.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
    expect(requestEdges(out.edges).map((e) => [e.id, e.source, e.target])).toEqual(
      edges.map((e) => [e.id, e.source, e.target]),
    );
    expect(ruleOf(out, "cache", "db")).toEqual({
      calls: [{ kind: "on_miss", callsPerRequest: 1 }],
      networkLatencyMs: 1,
      packetLoss: 0,
    });
    expect(requestEdges(out.edges).map((e) => (e.data.rule as EdgeRule).calls)).toEqual([
      [{ kind: "always", callsPerRequest: 1 }],
      [{ kind: "reads", callsPerRequest: 1 }],
      [{ kind: "on_miss", callsPerRequest: 1 }],
      [{ kind: "writes", callsPerRequest: 1 }],
      [{ kind: "fraction", fraction: 0.3, callsPerRequest: 2 }],
    ]);
  });

  it("analyze() gives every node and edge the same load before and after the migration", () => {
    const { nodes, edges } = v2Design();
    const out = migrateGraph(nodes, edges);
    const before = analyze(compileGraph(nodes, edges), 5000);
    const after = analyze(compileGraph(out.nodes, out.edges), 5000);
    expect(before.nodes.find((n) => n.nodeId === "db")!.offeredRps).toBeGreaterThan(0);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
  });

  it("is idempotent for v1, v2 and v3 input, with no new warnings", () => {
    const v3 = migrateGraph(v2Design().nodes, v2Design().edges);
    const fixtures: { nodes: unknown; edges: unknown }[] = [
      SMALL,
      v2Design(),
      v3,
      { nodes: SMALL.nodes, edges: [...SMALL.edges, v1Edge("x", "app", "ghost")] },
    ];
    for (const fixture of fixtures) {
      const once = migrateGraph(fixture.nodes, fixture.edges);
      const warnings: string[] = [];
      const twice = migrateGraph(once.nodes, once.edges, { onWarning: (w) => warnings.push(w) });
      expect(twice).toEqual(once);
      expect(warnings).toEqual([]);
    }
  });

  it("never throws on invalid input, and every edge it keeps has at least one call", () => {
    const { nodes } = v2Design();
    const garbageRules: unknown[] = [
      "nope",
      42,
      { calls: 5 },
      { calls: [null, "x"] },
      { calls: [{ kind: 7, step: "a", callsPerRequest: "b" }], packetLoss: 9 },
      { kind: "bogus", fraction: NaN },
    ];
    const inputs: [unknown, unknown][] = [
      [null, undefined],
      ["x", 42],
      [
        [null, { id: 3 }],
        [null, { source: 1 }],
      ],
      [nodes, garbageRules.map((rule) => ({ ...v2Edge("app", "db", rule), id: String(rule) }))],
    ];
    for (const [n, e] of inputs) {
      expect(() => migrateGraph(n, e)).not.toThrow();
      for (const edge of requestEdges(migrateGraph(n, e).edges)) {
        expect((edge.data.rule as EdgeRule).calls.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("canvas and saved-design stores persisted at v2 come out with call lists", () => {
    const { nodes, edges } = v2Design();
    const expected = requestEdges(migrateGraph(nodes, edges).edges);
    expect(expected.map((e) => (e.data.rule as EdgeRule).calls.map((c) => c.kind))).toEqual([
      ["always"],
      ["reads"],
      ["on_miss"],
      ["writes"],
      ["fraction"],
    ]);
    const canvas = migrateCanvasState<{ edges: unknown[]; tabs: { edges: unknown[] }[] }>(
      { nodes, edges, tabs: [{ id: "t", label: "T", nodes, edges }], activeTabId: "t" },
      2,
    );
    expect(requestEdges(canvas.edges as MigratedGraph["edges"])).toEqual(expected);
    expect(requestEdges(canvas.tabs[0].edges as MigratedGraph["edges"])).toEqual(expected);
    const saved = migrateSavedDesignsState<{ designs: { edges: unknown[] }[] }>(
      { designs: [{ id: "d", name: "D", nodes, edges, strokes: [] }] },
      2,
    );
    expect(requestEdges(saved.designs[0].edges as MigratedGraph["edges"])).toEqual(expected);
  });
});

// guided-ui, RET-20/21/22: schema v4 gives every synchronous call its response.
describe("migrateGraphV3toV4", () => {
  const v3Edge = (source: string, target: string, async = false) => ({
    id: `e-${source}-${target}`,
    type: "animated",
    source,
    target,
    data: { label: "", protocol: "http", async },
  });
  const design = () => ({
    nodes: [
      comp("client", "client"),
      comp("app", "app-server"),
      comp("db", "sql-db"),
      comp("mon", "monitoring"),
      { id: "note", type: "text", position: { x: 0, y: 0 }, data: { text: "note" } },
    ],
    edges: [
      v3Edge("client", "app"),
      v3Edge("app", "db"),
      v3Edge("app", "mon", true),
      v3Edge("note", "app"),
    ] as MigratedGraph["edges"],
  });

  it("creates a response for each edge between components that is not async, and none for async ones (RET-20)", () => {
    const g = design();
    const out = migrateGraphV3toV4(g as unknown as MigratedGraph);
    const responses = responseOf(out.edges);
    expect([...responses.keys()].sort()).toEqual(["e-app-db", "e-client-app"]);
    const r = responses.get("e-app-db")!;
    expect([r.id, r.source, r.target]).toEqual(["ret:e-app-db", "db", "app"]);
  });

  it("leaves text nodes, strokes and the edges touching text nodes unchanged (RET-21)", () => {
    const g = design() as unknown as MigratedGraph;
    const out = migrateGraphV3toV4(g);
    expect(out.nodes).toEqual(g.nodes);
    expect(out.edges.filter((e) => !e.id.startsWith("ret:"))).toEqual(g.edges);
    expect(out.edges.some((e) => e.source === "app" && e.target === "note")).toBe(false);
    expect(responseOf(out.edges).has("e-note-app")).toBe(false);
  });

  it("is idempotent, pure and never throws (RET-21)", () => {
    const g = design() as unknown as MigratedGraph;
    const snapshot = JSON.stringify(g);
    const once = migrateGraphV3toV4(g);
    expect(JSON.stringify(g)).toBe(snapshot);
    expect(migrateGraphV3toV4(once)).toEqual(once);
    for (const bad of [
      { nodes: [], edges: [] },
      { nodes: null, edges: [{ id: 1 }] },
      { nodes: [{ id: "a" }], edges: [null, "x", { source: "a" }] },
    ]) {
      expect(() => migrateGraphV3toV4(bad as unknown as MigratedGraph)).not.toThrow();
    }
  });

  it("the whole chain answers a v3 design and skips data saved as v4 (fromVersion)", () => {
    const { nodes, edges } = design();
    const v3 = migrateGraph(nodes, edges, { fromVersion: 3 });
    expect(responseOf(v3.edges).size).toBe(2);
    const v4Async = migrateGraph(nodes, [v3Edge("app", "mon", true)], { fromVersion: 4 });
    expect(responseOf(v4Async.edges).size).toBe(0);
  });

  it("a migrated v3 design compiles to the same SimGraph as the original (RET-22)", () => {
    const { nodes, edges } = design();
    const before = compileGraph(nodes, edges);
    const after = compileGraph(
      nodes,
      migrateGraphV3toV4({ nodes, edges } as unknown as MigratedGraph).edges,
    );
    expect(after.edges).toEqual(before.edges);
    expect(after.order).toEqual(before.order);
    expect(after.warnings).toEqual(before.warnings);
  });
});
