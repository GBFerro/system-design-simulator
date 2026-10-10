import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { analyze } from "@/engine/analyze";
import { TickSimulator } from "@/engine/core/tick";
import type { GlobalRuntimeMetrics, TickSnapshot } from "@/engine/types";
import { buildReferenceGraph } from "@/lib/loadReference";
import { comp, compileV3 } from "./engineFixtures";

/**
 * Golden of the engine before the call model (request-flow, FLW-32): a
 * design without explicit steps or "after miss" calls must keep producing
 * bit-identical `analyze()` results and tick snapshots.
 *
 * The fixture freezes the INPUT graphs too (v2 edge rules, deterministic
 * ids), so this test never reads `problems.ts` while comparing: the
 * references are allowed to change, the frozen designs are not.
 *
 * Record with `UPDATE_GOLDEN=1 npx vitest run tests/unit/engine-golden.test.ts`.
 */

const FIXTURE = fileURLToPath(new URL("./fixtures/engine-golden.json", import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === "1";
const TICKS = 50;
const MAX_FIXTURE_BYTES = 1_000_000;

/** Global tick metrics as they were when the golden was recorded (new keys don't count). */
const GLOBAL_KEYS = [
  "throughput",
  "goodput",
  "errorRate",
  "p50",
  "p95",
  "p99",
  "availability",
] as const satisfies readonly (keyof GlobalRuntimeMetrics)[];

/** A v2 edge rule (flat), as saved before the call model. */
interface V2Rule {
  kind: "always" | "on_miss" | "reads" | "writes" | "fraction";
  fraction?: number;
  callsPerRequest: number;
  networkLatencyMs: number;
  packetLoss: number;
}

interface FrozenNode {
  id: string;
  type: "component";
  data: { componentId: string; label: string; params: Record<string, unknown> };
}

interface FrozenEdge {
  id: string;
  source: string;
  target: string;
  data: { async: boolean; protocol: unknown; rule: unknown };
}

interface FrozenGraph {
  nodes: FrozenNode[];
  edges: FrozenEdge[];
}

interface Results {
  analyze: unknown[];
  ticks: unknown[];
}

interface GoldenCase {
  id: string;
  rps: number;
  graph: FrozenGraph;
  /** sha256 of the canonical results (every case). */
  hash: string;
  /**
   * Full results (synthetic designs only, to read a diff). Each tick is one
   * compact JSON string so the formatter keeps the fixture small.
   */
  results?: StoredResults;
}

interface StoredResults {
  analyze: unknown[];
  ticks: string[];
}

interface Golden {
  ticks: number;
  cases: GoldenCase[];
}

/* ---------- canonical form ---------- */

/** JSON-safe value with object keys sorted, so creation order never changes the hash. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === "object" && v !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      const value = (v as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = canonical(value);
    }
    return out;
  }
  return v;
}

function hashOf(results: Results): string {
  return createHash("sha256").update(JSON.stringify(results)).digest("hex");
}

function stored(results: Results): StoredResults {
  return { analyze: results.analyze, ticks: results.ticks.map((t) => JSON.stringify(t)) };
}

function projectTick(s: TickSnapshot): unknown {
  const global: Record<string, number> = {};
  for (const key of GLOBAL_KEYS) global[key] = s.global[key];
  return { t: s.t, offeredRps: s.offeredRps, nodes: s.nodes, edges: s.edges, global };
}

/** analyze() at the design's peak and 2×, then 50 ticks at the peak (default seed). */
function run(graph: FrozenGraph, rps: number): Results {
  const sim = compileV3(graph.nodes, graph.edges);
  const tick = new TickSimulator(sim);
  const ticks: unknown[] = [];
  for (let i = 0; i < TICKS; i++) ticks.push(projectTick(tick.step(rps)));
  // Through JSON, as the fixture stores it (-0 → 0, no undefined).
  return JSON.parse(
    JSON.stringify(canonical({ analyze: [analyze(sim, rps), analyze(sim, rps * 2)], ticks })),
  ) as Results;
}

/* ---------- recording (UPDATE_GOLDEN=1 only) ---------- */

function freeze(nodes: readonly Node[], edges: readonly Edge[]): FrozenGraph {
  const ids = new Map<string, string>();
  const frozenNodes = nodes.map((n, i): FrozenNode => {
    const data = n.data as { componentId: string; label: string; params: Record<string, unknown> };
    const id = `${data.componentId}-${i}`;
    ids.set(n.id, id);
    return {
      id,
      type: "component",
      data: { componentId: data.componentId, label: data.label, params: { ...data.params } },
    };
  });
  const frozenEdges = edges.map((e): FrozenEdge => {
    const source = ids.get(e.source) ?? e.source;
    const target = ids.get(e.target) ?? e.target;
    const data = (e.data ?? {}) as { async?: unknown; protocol?: unknown; rule?: unknown };
    return {
      id: `e-${source}-${target}`,
      source,
      target,
      data: { async: data.async === true, protocol: data.protocol, rule: data.rule },
    };
  });
  return canonical({ nodes: frozenNodes, edges: frozenEdges }) as FrozenGraph;
}

function rule(kind: V2Rule["kind"], extra: Partial<V2Rule> = {}): V2Rule {
  return { kind, callsPerRequest: 1, networkLatencyMs: 1, packetLoss: 0, ...extra };
}

function link(source: string, target: string, r: V2Rule, async = false): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    data: { async, protocol: "http", rule: r },
  };
}

/** Synthetic designs covering what the reference set exercises least. */
function syntheticDesigns(): { id: string; rps: number; nodes: Node[]; edges: Edge[] }[] {
  return [
    {
      // Overloaded database behind a caller that retries and times out.
      id: "synthetic:retries-timeout",
      rps: 1500,
      nodes: [
        comp("client", "client"),
        comp("lb", "load-balancer"),
        comp("api", "app-server", {
          instances: 2,
          capacityPerInstance: 1000,
          maxRetries: 2,
          timeoutMs: 40,
        }),
        comp("db", "sql-db", { instances: 1, capacityPerInstance: 1200, serviceTimeMs: 15 }),
      ],
      edges: [
        link("client", "lb", rule("always")),
        link("lb", "api", rule("always")),
        link("api", "db", rule("always", { packetLoss: 0.01 })),
      ],
    },
    {
      // A share of requests goes to search; the rest of the path is unconditional.
      id: "synthetic:fraction",
      rps: 4000,
      nodes: [
        comp("client", "client"),
        comp("api", "app-server", { instances: 4 }),
        comp("search", "search", { instances: 1 }),
        comp("db", "nosql-db"),
      ],
      edges: [
        link("client", "api", rule("always")),
        link("api", "search", rule("fraction", { fraction: 0.1 })),
        link("api", "db", rule("always", { callsPerRequest: 2 })),
      ],
    },
    {
      // Reads to the replica, writes to the primary, async replication stream.
      id: "synthetic:read-replica",
      rps: 6000,
      nodes: [
        comp("client", "client"),
        comp("api", "app-server", { instances: 6 }),
        comp("db", "sql-db", { instances: 1 }),
        comp("replica", "read-replica", { instances: 2 }),
      ],
      edges: [
        link("client", "api", rule("always")),
        link("api", "db", rule("writes")),
        link("api", "replica", rule("reads")),
        link("db", "replica", rule("writes"), true),
      ],
    },
    {
      // Cache in front of the database: misses go on to it (read-through).
      id: "synthetic:cache-read-through",
      rps: 8000,
      nodes: [
        comp("client", "client"),
        comp("api", "app-server", { instances: 8 }),
        comp("cache", "cache", { hitRate: 0.85 }),
        comp("db", "sql-db", { instances: 2 }),
      ],
      edges: [
        link("client", "api", rule("always")),
        link("api", "cache", rule("reads")),
        link("cache", "db", rule("on_miss")),
        link("api", "db", rule("writes")),
      ],
    },
  ];
}

function record(): Golden {
  const cases: GoldenCase[] = [];
  for (const problem of PROBLEMS) {
    const { nodes, edges } = buildReferenceGraph(problem);
    const graph = freeze(nodes, edges);
    const rps = problem.requirements.readsPerSec + problem.requirements.writesPerSec;
    cases.push({ id: `reference:${problem.id}`, rps, graph, hash: hashOf(run(graph, rps)) });
  }
  for (const design of syntheticDesigns()) {
    const graph = freeze(design.nodes, design.edges);
    const results = run(graph, design.rps);
    cases.push({
      id: design.id,
      rps: design.rps,
      graph,
      hash: hashOf(results),
      results: stored(results),
    });
  }
  return { ticks: TICKS, cases };
}

/* ---------- the test ---------- */

if (UPDATE) writeFileSync(FIXTURE, JSON.stringify(record()) + "\n");

function loadGolden(): Golden {
  if (!existsSync(FIXTURE)) {
    throw new Error("Missing engine golden: record it with UPDATE_GOLDEN=1 (see the file header).");
  }
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Golden;
}

describe("engine golden (FLW-32: bit-identical without steps or after-miss calls)", () => {
  const golden = loadGolden();

  it("freezes the 35 references and 4 synthetic designs, under 1 MB", () => {
    expect(golden.ticks).toBe(TICKS);
    expect(golden.cases.filter((c) => c.id.startsWith("reference:"))).toHaveLength(35);
    expect(golden.cases.filter((c) => c.results !== undefined)).toHaveLength(4);
    expect(statSync(FIXTURE).size).toBeLessThan(MAX_FIXTURE_BYTES);
  });

  it.each(golden.cases.filter((c) => c.results).map((c) => [c.id, c] as const))(
    "%s: same analyze() and ticks as recorded",
    (_id, golden) => {
      expect(stored(run(golden.graph, golden.rps))).toEqual(golden.results);
    },
  );

  it.each(golden.cases.map((c) => [c.id, c] as const))(
    "%s: same result hash as recorded",
    (_id, golden) => {
      expect(hashOf(run(golden.graph, golden.rps))).toBe(golden.hash);
    },
  );
});
