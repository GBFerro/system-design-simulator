import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM } from "@/domain/components/registry";
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
        kind: "fraction",
        fraction: 0.3,
        callsPerRequest: 2,
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
      slo: { p99Ms: 200 },
    });
    const exported = JSON.parse(json) as DesignEnvelope;
    expect(exported.schemaVersion).toBe(2);
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
    expect(result.fromVersion).toBe(2);
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
      rule: { kind: "on_miss", callsPerRequest: 1 },
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
    expect(bad({ schemaVersion: 3, nodes: [], edges: [] })).toMatch(/newer version/);
  });
});
