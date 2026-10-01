import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getComponentById, SYSTEM_COMPONENTS } from "@/data/components";
import { PROBLEMS } from "@/data/problems";
import { buildReferenceGraph } from "@/lib/loadReference";
import { createComponentNode } from "@/lib/nodeFactory";
import { CATEGORY_MAX_SCORE } from "@/scoring/budget";
import { buildScoringGraph, scoreDesign } from "@/scoring/scorer";
import { measureDesign, type MeasureApi } from "@/scoring/measure";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { analyzeUnderFault } from "@/engine/faults/steady";
import * as availability from "@/scoring/rules/availability";
import * as cost from "@/scoring/rules/cost";
import * as latency from "@/scoring/rules/latency";
import * as scalability from "@/scoring/rules/scalability";
import * as tradeoffs from "@/scoring/rules/tradeoffs";
import type { CategoryScore, Measurements, ScoringGraph } from "@/types/scoring";
import type { ComponentNodeData } from "@/store/canvasStore";

type Graph = { nodes: Node<ComponentNodeData>[]; edges: Edge[] };
type Rule = (
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  graph: ScoringGraph,
  m?: Measurements,
) => CategoryScore;

/** In-thread engine for `measureDesign`, as the worker would run it. */
const inThread: MeasureApi = {
  analyze: (g, rps, config) => analyze(g, rps, config),
  analyzeUnderFault: (g, rps, fault, config) => analyzeUnderFault(g, rps, fault, config),
};

/**
 * Measurements of a fixture at a light load with a loose SLA and one fault
 * it survives: what a healthy design would get.
 */
function measured({ nodes, edges }: Graph, rps = 100, samples = 500): Measurements {
  const g = compileGraph(nodes, edges);
  return {
    peakRps: rps,
    sla: { p99Ms: 1000 },
    atPeak: analyze(g, rps, { samples }),
    atDoublePeak: analyze(g, 2 * rps, { samples }),
    underFaults: [{ label: "Kill instances · App Server", errorRate: 0 }],
    budgetMonthlyUsd: 1_000_000,
  };
}

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

/** CDN -> LB x2 -> App Server x2 -> Cache, NoSQL, Queue (stateless tiers scaled out) */
const EDGE_TO_STORES = graphOf(
  [["cdn"], ["load-balancer", 2], ["app-server", 2], ["cache"], ["nosql-db"], ["message-queue"]],
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
    // API GW -> LB fanning out to 2 App Servers -> Cache, NoSQL x2, Queue, Circuit Breaker
    full: graphOf(
      [
        ["api-gateway"],
        ["load-balancer"],
        ["app-server"],
        ["app-server"],
        ["cache"],
        ["nosql-db", 2],
        ["message-queue"],
        ["circuit-breaker"],
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
        ["load-balancer", 2],
        ["app-server", 2],
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
      const graph = buildScoringGraph(full.nodes, full.edges);
      const result = score(full.nodes, full.edges, graph, measured(full));
      expect(result.feedback).toEqual([]);
      expect(result.passed).toHaveLength(Object.keys(budget).length);
      expect(result.score).toBe(CATEGORY_MAX_SCORE);
    },
  );

  const cases = fixtures();

  it.each(Object.entries(RULES))(
    "%s stays within [0, 20] with maxScore 20, measured or not",
    (_name, { score }) => {
      for (const [label, g] of cases) {
        const graph = buildScoringGraph(g.nodes, g.edges);
        for (const m of [undefined, measured(g, 1000, 100)]) {
          const result = score(g.nodes, g.edges, graph, m);
          expect(result.maxScore, label).toBe(CATEGORY_MAX_SCORE);
          expect(Number.isFinite(result.score), label).toBe(true);
          expect(result.score, label).toBeGreaterThanOrEqual(0);
          expect(result.score, label).toBeLessThanOrEqual(CATEGORY_MAX_SCORE);
        }
      }
    },
  );

  it("an empty design scores 0 in scalability, availability and latency", () => {
    const empty = { nodes: [], edges: [] };
    const graph = buildScoringGraph([], []);
    const rules = [
      scalability.scoreScalability,
      availability.scoreAvailability,
      latency.scoreLatency,
    ];
    for (const rule of rules) expect(rule([], [], graph, measured(empty)).score).toBe(0);
  });
});

describe("measured checks without traffic", () => {
  it("a design no request reaches scores 0 in scalability, availability and latency", () => {
    // A lone node is "reachable" for presence checks, but the engine sends it nothing.
    const lone = graphOf([["app-server", 2]], []);
    const graph = buildScoringGraph(lone.nodes, lone.edges);
    const m = measured(lone);
    expect(m.atPeak.offeredRps).toBe(0);
    const rules = [
      scalability.scoreScalability,
      availability.scoreAvailability,
      latency.scoreLatency,
    ];
    for (const rule of rules) {
      const r = rule(lone.nodes, lone.edges, graph, m);
      expect(r.score, r.category).toBe(0);
      expect(r.feedback.join(" "), r.category).toMatch(/entry point/);
    }
  });
});

describe("measured rubric vs the reference solutions (Spec 09)", () => {
  // Each reference, simulated at its own peak, must be a design that holds it.
  it.each(PROBLEMS.map((p) => [p.id, p] as const))(
    "%s: at least 16/20 in scalability and latency at the reference peak",
    async (_id, p) => {
      const { nodes, edges } = buildReferenceGraph(p);
      const m = (await measureDesign(nodes, edges, p.id, inThread))!;
      const result = scoreDesign(nodes, edges, m);
      const by = Object.fromEntries(result.categories.map((c) => [c.category, c]));
      expect(by.Scalability.score, by.Scalability.feedback.join(" | ")).toBeGreaterThanOrEqual(16);
      expect(by.Latency.score, by.Latency.feedback.join(" | ")).toBeGreaterThanOrEqual(16);
      for (const c of result.categories) expect(c.score, c.category).toBeGreaterThan(0);
    },
  );

  it("measures at the problem's peak and read mix, under each drill fault", async () => {
    const p = PROBLEMS.find((x) => x.id === "url-shortener")!;
    const { nodes, edges } = buildReferenceGraph(p);
    const m = (await measureDesign(nodes, edges, p.id, inThread))!;
    expect(m.peakRps).toBe(p.requirements.readsPerSec + p.requirements.writesPerSec);
    expect(m.atPeak.offeredRps).toBe(m.peakRps);
    expect(m.atDoublePeak.offeredRps).toBe(2 * m.peakRps);
    expect(m.sla).toEqual({ p99Ms: p.requirements.latencyMs });
    expect(m.underFaults).toHaveLength(3);
    expect(m.referenceSyncDepth).toBeGreaterThan(0);
  });

  it("uses the SLA scope when the problem has one", async () => {
    const p = PROBLEMS.find((x) => x.id === "distributed-cache")!;
    const { nodes, edges } = buildReferenceGraph(p);
    const m = (await measureDesign(nodes, edges, p.id, inThread))!;
    expect(m.sla).toEqual({ p99Ms: 2, scope: "cache" });
  });

  it("is null for an unknown problem or a canvas without components", async () => {
    const { nodes, edges } = EDGE_TO_STORES;
    expect(await measureDesign(nodes, edges, "no-such-problem", inThread)).toBeNull();
    expect(await measureDesign([], [], "url-shortener", inThread)).toBeNull();
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
