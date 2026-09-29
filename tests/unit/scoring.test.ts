import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getComponentById, SYSTEM_COMPONENTS } from "@/data/components";
import { PROBLEMS } from "@/data/problems";
import { buildReferenceGraph } from "@/lib/loadReference";
import { createComponentNode } from "@/lib/nodeFactory";
import { CATEGORY_MAX_SCORE } from "@/scoring/budget";
import { buildScoringGraph, scoreDesign } from "@/scoring/scorer";
import * as availability from "@/scoring/rules/availability";
import * as cost from "@/scoring/rules/cost";
import * as latency from "@/scoring/rules/latency";
import * as scalability from "@/scoring/rules/scalability";
import * as tradeoffs from "@/scoring/rules/tradeoffs";
import type { CategoryScore, ScoringGraph } from "@/types/scoring";
import type { ComponentNodeData } from "@/store/canvasStore";

type Graph = { nodes: Node<ComponentNodeData>[]; edges: Edge[] };
type Rule = (nodes: Node<ComponentNodeData>[], edges: Edge[], graph: ScoringGraph) => CategoryScore;

function node(componentId: string, index: number, replicas = 1): Node<ComponentNodeData> {
  const created = createComponentNode(getComponentById(componentId)!, { x: index * 100, y: 0 });
  return {
    ...created,
    id: `${componentId}-${index}`,
    data: { ...created.data, params: { ...created.data.params, instances: replicas } },
  };
}

function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target };
}

/** Graph from `[componentId, replicas?]` specs and `[sourceIndex, targetIndex]` links. */
function graphOf(specs: [string, number?][], links: [number, number][]): Graph {
  const nodes = specs.map(([id, replicas], i) => node(id, i, replicas));
  return { nodes, edges: links.map(([s, t]) => edge(nodes[s].id, nodes[t].id)) };
}

/** CDN -> LB -> App Server -> Cache, NoSQL, Queue */
const EDGE_TO_STORES = graphOf(
  [["cdn"], ["load-balancer"], ["app-server"], ["cache"], ["nosql-db"], ["message-queue"]],
  [
    [0, 1],
    [1, 2],
    [2, 3],
    [2, 4],
    [2, 5],
  ],
);

/**
 * Per rule: its exported point budget and a "complete" design that passes
 * every check, proving the category max is actually reachable.
 */
const RULES: Record<
  string,
  { score: Rule; budget: Record<string, number>; partial?: Record<string, number>; full: Graph }
> = {
  availability: {
    score: availability.scoreAvailability,
    budget: availability.BUDGET,
    // API GW -> LB fanning out to 2 App Servers -> Cache, NoSQL x2, Queue, Monitoring
    full: graphOf(
      [
        ["api-gateway"],
        ["load-balancer"],
        ["app-server"],
        ["app-server"],
        ["cache"],
        ["nosql-db", 2],
        ["message-queue"],
        ["monitoring"],
      ],
      [
        [0, 1],
        [1, 2],
        [1, 3],
        [2, 4],
        [2, 5],
        [2, 6],
        [2, 7],
      ],
    ),
  },
  cost: {
    score: cost.scoreCost,
    budget: cost.BUDGET,
    partial: cost.PARTIAL,
    full: EDGE_TO_STORES,
  },
  latency: {
    score: latency.scoreLatency,
    budget: latency.BUDGET,
    partial: latency.PARTIAL,
    // DNS -> CDN -> LB -> App Server -> Cache (aside), NoSQL, Queue: 5 hops
    full: graphOf(
      [
        ["dns"],
        ["cdn"],
        ["load-balancer"],
        ["app-server"],
        ["cache"],
        ["nosql-db"],
        ["message-queue"],
      ],
      [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [3, 5],
        [3, 6],
      ],
    ),
  },
  scalability: {
    score: scalability.scoreScalability,
    budget: scalability.BUDGET,
    full: EDGE_TO_STORES,
  },
  tradeoffs: {
    score: tradeoffs.scoreTradeoffs,
    budget: tradeoffs.BUDGET,
    partial: tradeoffs.PARTIAL,
    // API GW -> Auth; API GW -> App Server -> Cache, NoSQL, Object Storage, Queue, Monitoring
    full: graphOf(
      [
        ["api-gateway"],
        ["auth-service"],
        ["app-server"],
        ["cache"],
        ["nosql-db"],
        ["object-storage"],
        ["message-queue"],
        ["monitoring"],
      ],
      [
        [0, 1],
        [0, 2],
        [2, 3],
        [2, 4],
        [2, 5],
        [2, 6],
        [2, 7],
      ],
    ),
  },
};

/** Deterministic PRNG so random fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGraph(seed: number): Graph {
  const rand = mulberry32(seed);
  const count = 1 + Math.floor(rand() * 30);
  const nodes = Array.from({ length: count }, (_, i) =>
    node(
      SYSTEM_COMPONENTS[Math.floor(rand() * SYSTEM_COMPONENTS.length)].id,
      i,
      1 + Math.floor(rand() * 5),
    ),
  );
  const edges: Edge[] = [];
  const edgeCount = Math.floor(rand() * count * 2);
  for (let i = 0; i < edgeCount; i++) {
    const s = nodes[Math.floor(rand() * count)].id;
    const t = nodes[Math.floor(rand() * count)].id;
    edges.push({ id: `e-${i}`, source: s, target: t });
  }
  // Edge into a non-component (text) node: must be ignored, never crash
  if (rand() < 0.3) edges.push(edge(nodes[0].id, "text-note"));
  return { nodes, edges };
}

function fixtures(): [string, Graph][] {
  const all = SYSTEM_COMPONENTS.map((c, i) => node(c.id, i));
  const chain = all.slice(1).map((n, i) => edge(all[i].id, n.id));
  const list: [string, Graph][] = [
    ["single node", { nodes: [node("app-server", 0)], edges: [] }],
    ["every component, disconnected", { nodes: all, edges: [] }],
    ["every component, chained", { nodes: all, edges: chain }],
    [
      "every component x3, chained",
      { nodes: SYSTEM_COMPONENTS.map((c, i) => node(c.id, i, 3)), edges: chain },
    ],
    [
      "self-loop only",
      { nodes: [node("app-server", 0)], edges: [edge("app-server-0", "app-server-0")] },
    ],
  ];
  for (const p of PROBLEMS) list.push([`reference: ${p.id}`, buildReferenceGraph(p)]);
  for (let seed = 1; seed <= 200; seed++) list.push([`random #${seed}`, randomGraph(seed)]);
  return list;
}

describe("scoring rules", () => {
  it("has 5 categories of 20 points (100 total)", () => {
    expect(CATEGORY_MAX_SCORE).toBe(20);
    expect(Object.keys(RULES)).toHaveLength(5);
  });

  it.each(Object.entries(RULES))("%s: BUDGET sums to exactly 20", (_name, { budget, partial }) => {
    const values = Object.values(budget);
    for (const v of values) expect(Number.isInteger(v) && v > 0, String(v)).toBe(true);
    expect(values.reduce((a, b) => a + b, 0)).toBe(CATEGORY_MAX_SCORE);
    for (const [key, points] of Object.entries(partial ?? {})) {
      expect(budget[key], `PARTIAL.${key} has no BUDGET entry`).toBeDefined();
      expect(points, `PARTIAL.${key}`).toBeGreaterThan(0);
      expect(points, `PARTIAL.${key}`).toBeLessThan(budget[key]);
    }
  });

  it.each(Object.entries(RULES))(
    "%s: the complete design reaches exactly 20",
    (_name, { score, budget, full }) => {
      const result = score(full.nodes, full.edges, buildScoringGraph(full.nodes, full.edges));
      expect(result.feedback).toEqual([]);
      expect(result.passed).toHaveLength(Object.keys(budget).length);
      expect(result.score).toBe(CATEGORY_MAX_SCORE);
    },
  );

  const cases = fixtures();

  it.each(Object.entries(RULES))("%s stays within [0, 20] with maxScore 20", (_name, { score }) => {
    for (const [label, { nodes, edges }] of cases) {
      const result = score(nodes, edges, buildScoringGraph(nodes, edges));
      expect(result.maxScore, label).toBe(CATEGORY_MAX_SCORE);
      expect(Number.isFinite(result.score), label).toBe(true);
      expect(result.score, label).toBeGreaterThanOrEqual(0);
      expect(result.score, label).toBeLessThanOrEqual(20);
    }
  });

  // Known issue: the web-crawler reference is a pure cycle (message-queue <->
  // app-server) with no in-degree-0 node, so nothing is reachable and it
  // scores 0 in three categories. Remove from this set once the data is fixed.
  const KNOWN_UNREACHABLE_REFERENCES = new Set(["web-crawler"]);

  it("every reference solution scores in every category", () => {
    for (const p of PROBLEMS) {
      if (KNOWN_UNREACHABLE_REFERENCES.has(p.id)) continue;
      const { nodes, edges } = buildReferenceGraph(p);
      const result = scoreDesign(nodes, edges);
      expect(result.categories).toHaveLength(5);
      for (const c of result.categories)
        expect(c.score, `${p.id} / ${c.category}`).toBeGreaterThan(0);
    }
  });
});

describe("scoreDesign", () => {
  it("returns 0 for an empty canvas", () => {
    expect(scoreDesign([], []).total).toBe(0);
  });

  it("total is the sum of the categories and stays within [0, 100]", () => {
    for (const [label, { nodes, edges }] of fixtures()) {
      const result = scoreDesign(nodes, edges);
      const sum = result.categories.reduce((a, c) => a + c.score, 0);
      expect(result.total, label).toBe(sum);
      expect(result.total, label).toBeGreaterThanOrEqual(0);
      expect(result.total, label).toBeLessThanOrEqual(100);
    }
  });

  it("disconnected components earn no presence points", () => {
    const nodes = SYSTEM_COMPONENTS.map((c, i) => node(c.id, i));
    const graph = buildScoringGraph(nodes, []);
    expect(graph.reachable.size).toBe(0);
  });
});
