import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM } from "@/domain/components/registry";
import type { EdgeRule } from "@/domain/components/types";
import { MAX_CALL_STEP, MAX_EDGE_CALLS } from "@/domain/graph/edgeRules";
import {
  parseEnvelope,
  parseEnvelopeJson,
  stringifyEnvelope,
  type DesignEnvelope,
} from "@/domain/persistence/envelope";
import {
  deserializeEdges,
  deserializeNodes,
  serializeEdges,
  serializeNodes,
} from "@/domain/persistence/serialize";
import { buildReferenceGraph } from "@/lib/loadReference";
import { createTextNode } from "@/lib/nodeFactory";
import type { Stroke } from "@/store/penStore";

// Spec 05, PER-02: export envelope v2 round-trip and v1 import.

const STROKES: Stroke[] = [
  {
    id: "s1",
    points: [
      [0, 0],
      [10, 12.5],
    ],
    color: "#22d3ee",
    width: 8,
  },
];

function canvasGraph() {
  const problem = PROBLEMS.find((p) => p.id === "url-shortener")!;
  const { nodes, edges } = buildReferenceGraph(problem);
  const note = { ...createTextNode({ x: -100, y: -50 }), data: { text: "note", fontSize: "sm" } };
  // User edits on top of the reference: edge metadata and a non-default rule
  edges[0] = {
    ...edges[0],
    data: {
      ...edges[0].data,
      label: "HTTPS",
      protocol: "grpc",
      async: true,
      rule: {
        calls: [{ kind: "fraction", fraction: 0.3, callsPerRequest: 2 }],
        networkLatencyMs: 4,
        packetLoss: 0.01,
      },
    },
  };
  return { nodes: [...nodes, note], edges };
}

describe("export envelope v2", () => {
  it("export → import returns the same graph", () => {
    const { nodes, edges } = canvasGraph();
    const json = stringifyEnvelope({
      name: "URL shortener",
      problemId: "url-shortener",
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
      strokes: STROKES,
      chaosScript: { steps: [{ at: 10, fault: "kill", node: "x" }] },
      slo: { percentile: 95, thresholdMs: 200, availability: 0.9999 },
    });
    const exported = JSON.parse(json) as DesignEnvelope;
    expect(exported.schemaVersion).toBe(4);
    expect(Object.keys(exported).sort()).toEqual(
      [
        "chaosScript",
        "edges",
        "name",
        "nodes",
        "problemId",
        "schemaVersion",
        "slo",
        "strokes",
      ].sort(),
    );

    const result = parseEnvelopeJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(result.design).toEqual(exported);

    // Back onto the canvas: same nodes/edges, including params and edge.data.rule
    expect(serializeNodes(deserializeNodes(result.design.nodes))).toEqual(serializeNodes(nodes));
    expect(deserializeEdges(result.design.edges)).toEqual(
      edges.map((e) => ({ ...e, sourceHandle: undefined, targetHandle: undefined })),
    );
    expect(result.design.edges[0].data).toEqual(edges[0].data);
  });

  it("imports a v1 top-bar export (maxQPS/latencyMs/replicas, no rules)", () => {
    const v1 = {
      schemaVersion: 1,
      name: "URL Shortener",
      problemId: "url-shortener",
      nodes: [
        {
          id: "cache-1",
          type: "component",
          position: { x: 0, y: 0 },
          data: {
            componentId: "cache",
            label: "Redis",
            icon: "Zap",
            category: "storage",
            replicas: 3,
            maxQPS: 120000,
            latencyMs: 1,
            scalable: true,
          },
        },
        {
          id: "db-1",
          type: "component",
          position: { x: 0, y: 200 },
          data: {
            componentId: "sql-db",
            label: "Postgres",
            icon: "Database",
            category: "storage",
            replicas: 1,
            maxQPS: 10000,
            latencyMs: 8,
            scalable: true,
          },
        },
        { id: "t", type: "text", position: { x: 9, y: 9 }, data: { text: "hi" } },
      ],
      edges: [
        {
          id: "e1",
          type: "animated",
          source: "cache-1",
          target: "db-1",
          sourceHandle: null,
          targetHandle: null,
          data: { label: "miss", protocol: "tcp", async: false },
        },
      ],
      strokes: [...STROKES, { id: "broken", points: "nope" }],
    };
    const result = parseEnvelope(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(1);
    const cache = result.design.nodes[0].data as { params: Record<string, unknown> };
    expect(cache.params).toMatchObject({
      [PARAM.capacityPerInstance]: 120000,
      [PARAM.serviceTimeMs]: 1,
      [PARAM.instances]: 3,
    });
    expect(cache).not.toHaveProperty("maxQPS");
    expect(result.design.nodes[2]).toEqual({
      id: "t",
      type: "text",
      position: { x: 9, y: 9 },
      data: { text: "hi", fontSize: undefined },
    });
    expect(result.design.edges[0].data).toMatchObject({
      label: "miss",
      protocol: "tcp",
      async: false,
      rule: { calls: [{ kind: "on_miss", callsPerRequest: 1 }] },
    });
    expect(result.design.strokes).toEqual(STROKES);
  });

  it("imports a v1 Load-dialog export (a full SavedDesign) and a file without schemaVersion", () => {
    const savedDesignV1 = {
      schemaVersion: 1,
      id: "design-1",
      name: "Mine",
      problemId: null,
      nodes: [
        {
          id: "a",
          type: "component",
          position: { x: 0, y: 0 },
          data: { componentId: "app-server", replicas: 2, maxQPS: 3000, latencyMs: 30 },
        },
      ],
      edges: [],
      annotations: [],
      strokes: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    for (const input of [savedDesignV1, { ...savedDesignV1, schemaVersion: undefined }]) {
      const result = parseEnvelope(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.fromVersion).toBe(1);
      expect(result.design.name).toBe("Mine");
      expect(result.design.problemId).toBeNull();
      expect(result.design).not.toHaveProperty("annotations");
      // Missing label/icon come from the catalog
      expect(result.design.nodes[0].data).toMatchObject({
        componentId: "app-server",
        label: "App Server",
        params: { [PARAM.instances]: 2, [PARAM.capacityPerInstance]: 3000 },
      });
    }
  });

  it("reports recoverable problems as warnings and unusable files as errors", () => {
    const ok = parseEnvelope({
      nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { componentId: "warp-drive" } }],
      edges: [{ id: "e", source: "a", target: "ghost" }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.design.edges).toEqual([]);
      expect(ok.design.nodes[0].data).toMatchObject({ componentId: "custom" });
      expect(ok.warnings).toHaveLength(2);
    }

    const bad = (input: unknown) => {
      const r = parseEnvelope(input);
      return r.ok ? null : r.error;
    };
    expect(parseEnvelopeJson("{not json").ok).toBe(false);
    expect(bad([])).toMatch(/not a design/);
    expect(bad({ edges: [] })).toMatch(/nodes/);
    expect(bad({ nodes: [] })).toMatch(/edges/);
    expect(bad({ nodes: [{ id: "a", position: { x: 0 }, data: {} }], edges: [] })).toMatch(
      /position/,
    );
    expect(
      bad({
        nodes: [
          { id: "a", position: { x: 0, y: 0 }, data: {} },
          { id: "a", position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [],
      }),
    ).toMatch(/Duplicate/);
    expect(bad({ schemaVersion: 5, nodes: [], edges: [] })).toMatch(/newer version/);
  });
});

// request-flow, FLW-19/20/45: schema v3 envelopes carry each edge's call list.
describe("export envelope v3", () => {
  const LOOK_ASIDE: EdgeRule = {
    calls: [
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", missOf: "cache-1", step: 3, callsPerRequest: 1 },
    ],
    networkLatencyMs: 2,
    packetLoss: 0,
  };

  function design(rule: unknown, schemaVersion: number) {
    return {
      schemaVersion,
      name: "Look-aside",
      problemId: null,
      nodes: [
        {
          id: "app-1",
          type: "component",
          position: { x: 0, y: 0 },
          data: { componentId: "app-server", label: "App" },
        },
        {
          id: "cache-1",
          type: "component",
          position: { x: 0, y: 100 },
          data: { componentId: "cache", label: "Redis" },
        },
        {
          id: "db-1",
          type: "component",
          position: { x: 0, y: 200 },
          data: { componentId: "sql-db", label: "DB" },
        },
      ],
      edges: [
        {
          id: "e-app-cache",
          source: "app-1",
          target: "cache-1",
          data: { protocol: "http", async: false },
        },
        {
          id: "e-app-db",
          source: "app-1",
          target: "db-1",
          data: { protocol: "http", async: false, rule },
        },
      ],
      strokes: [],
    };
  }

  const dbRule = (d: DesignEnvelope) => d.edges.find((e) => e.id === "e-app-db")!.data!.rule;

  it("exports schemaVersion 4 and an export → import returns the same calls", () => {
    const first = parseEnvelope(design(LOOK_ASIDE, 3));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const json = stringifyEnvelope(first.design);
    expect((JSON.parse(json) as DesignEnvelope).schemaVersion).toBe(4);
    const again = parseEnvelopeJson(json);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.fromVersion).toBe(4);
    expect(dbRule(again.design)).toEqual(LOOK_ASIDE);
    expect(again.warnings).toEqual([]);
  });

  it("imports schemaVersion 2 (flat rule) as one call with the same condition", () => {
    const result = parseEnvelope(
      design({ kind: "writes", callsPerRequest: 1, networkLatencyMs: 2, packetLoss: 0 }, 2),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fromVersion).toBe(2);
    expect(dbRule(result.design)).toEqual({
      calls: [{ kind: "writes", callsPerRequest: 1 }],
      networkLatencyMs: 2,
      packetLoss: 0,
    });
  });

  it("an imported call list beyond the limits is normalized with warnings", () => {
    const calls = [
      { kind: "sometimes", callsPerRequest: 1 },
      { kind: "reads", callsPerRequest: 1, step: MAX_CALL_STEP + 7 },
      ...Array.from({ length: MAX_EDGE_CALLS }, () => ({ kind: "writes", callsPerRequest: 1 })),
    ];
    const result = parseEnvelope(design({ calls, networkLatencyMs: 1, packetLoss: 0 }, 3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rule = dbRule(result.design)!;
    expect(rule.calls).toHaveLength(MAX_EDGE_CALLS);
    expect(rule.calls[0].kind).toBe("always");
    expect(rule.calls[1].step).toBe(MAX_CALL_STEP);
    expect(result.warnings).toHaveLength(3);
  });
});

describe("envelope v4 and responses (RET-23, RET-24, RET-32)", () => {
  const nodes = [
    {
      id: "a",
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        componentId: "client",
        label: "A",
        icon: "",
        category: "",
        scalable: false,
        params: {},
      },
    },
    {
      id: "b",
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        componentId: "app-server",
        label: "B",
        icon: "",
        category: "",
        scalable: true,
        params: {},
      },
    },
  ];
  const request = {
    id: "e-a-b",
    type: "animated",
    source: "a",
    target: "b",
    data: { label: "", protocol: "http", async: false },
  };
  const response = {
    id: "ret:e-a-b",
    type: "animated",
    source: "b",
    target: "a",
    sourceHandle: "ret-out",
    targetHandle: "ret-in",
    data: { responseTo: "e-a-b" },
  };

  it("imports schemaVersion 1, 2, 3 and 4 (missing = 1) and migrates up to v4", () => {
    for (const schemaVersion of [1, 2, 3, 4, undefined]) {
      const res = parseEnvelope({
        schemaVersion,
        name: "x",
        nodes,
        edges: schemaVersion === 4 ? [request, response] : [request],
      });
      expect(res.ok, String(schemaVersion)).toBe(true);
      if (!res.ok) continue;
      expect(res.design.schemaVersion).toBe(4);
      expect(res.design.edges.map((e) => e.id)).toEqual(["e-a-b", "ret:e-a-b"]);
    }
  });

  it("exports the responses as edges", () => {
    const json = stringifyEnvelope({
      name: "x",
      problemId: null,
      nodes: serializeNodes(nodes as never),
      edges: serializeEdges([request, response] as never),
      strokes: [],
    });
    const out = JSON.parse(json) as DesignEnvelope;
    expect(out.schemaVersion).toBe(4);
    expect(out.edges.map((e) => e.id)).toEqual(["e-a-b", "ret:e-a-b"]);
    expect(out.edges[1].data).toEqual({ responseTo: "e-a-b" });
  });

  it("drops a response whose request is not in the file, with a warning", () => {
    const res = parseEnvelope({ schemaVersion: 4, name: "x", nodes, edges: [response] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.design.edges).toEqual([]);
    expect(res.warnings.some((w) => w.includes("response"))).toBe(true);
  });

  it("a v4 file keeps an async request async (no response is invented)", () => {
    const res = parseEnvelope({
      schemaVersion: 4,
      name: "x",
      nodes,
      edges: [{ ...request, data: { ...request.data, async: true } }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.design.edges.map((e) => e.id)).toEqual(["e-a-b"]);
  });
});
