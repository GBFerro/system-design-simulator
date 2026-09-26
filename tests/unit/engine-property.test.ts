import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import type { EdgeRuleKind } from "@/domain/components/types";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { mulberry32, type Rng } from "@/engine/core/rng";
import { comp, text } from "./engineFixtures";

const GARBAGE: unknown[] = [NaN, -1, 0, Infinity, -Infinity, "abc", null, undefined, 1e12, 0.5];
const RULE_KINDS: EdgeRuleKind[] = ["always", "on_miss", "reads", "writes", "fraction"];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function randomNumber(rng: Rng, max: number): unknown {
  return rng() < 0.15 ? pick(rng, GARBAGE) : Math.floor(rng() * max) + 1;
}

/** Random canvas: cycles, text nodes, dangling edges, duplicates, garbage params and rules. */
function randomCanvas(seed: number): { nodes: Node[]; edges: Edge[]; rps: number } {
  const rng = mulberry32(seed);
  const count = 1 + Math.floor(rng() * 25);
  const ids = [...SYSTEM_COMPONENTS.map((c) => c.id), "client", "not-a-component"];
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    if (rng() < 0.1) {
      nodes.push(text(`n${i}`));
      continue;
    }
    const node = comp(`n${i}`, pick(rng, ids));
    const params = (node.data as { params: Record<string, unknown> }).params;
    params.instances = randomNumber(rng, 20);
    params.capacityPerInstance = randomNumber(rng, 20_000);
    params.serviceTimeMs = randomNumber(rng, 200);
    if (rng() < 0.3) params.maxRetries = randomNumber(rng, 5);
    if (rng() < 0.3) params.timeoutMs = randomNumber(rng, 2000);
    if (rng() < 0.3) params.maxQueue = rng() < 0.3 ? 0 : randomNumber(rng, 10_000);
    if (rng() < 0.3) params.hitRate = rng() < 0.2 ? pick(rng, GARBAGE) : rng();
    if (rng() < 0.2) params.lbAlgorithm = pick(rng, ["least-connections", "weighted", "hash", 42]);
    if (rng() < 0.2) params.consumers = randomNumber(rng, 8);
    if (rng() < 0.2) params.limitRps = randomNumber(rng, 50_000);
    nodes.push(node);
  }
  const edges: Edge[] = [];
  const edgeCount = Math.floor(rng() * count * 2.5);
  for (let i = 0; i < edgeCount; i++) {
    const source = rng() < 0.05 ? "ghost" : `n${Math.floor(rng() * count)}`;
    const target = rng() < 0.05 ? "ghost" : `n${Math.floor(rng() * count)}`;
    edges.push({
      id: `e${i}`,
      source,
      target,
      data: {
        async: rng() < 0.2,
        protocol: pick(rng, ["http", "grpc", "pubsub", "bogus"]),
        rule:
          rng() < 0.3
            ? undefined
            : {
                kind: rng() < 0.1 ? "bogus" : pick(rng, RULE_KINDS),
                fraction: rng() < 0.1 ? NaN : rng(),
                callsPerRequest: rng() < 0.1 ? pick(rng, GARBAGE) : rng() * 3,
                networkLatencyMs: rng() < 0.1 ? -5 : rng() * 5,
                packetLoss: rng() < 0.1 ? 2 : rng() * 0.05,
              },
      },
    });
  }
  const rps = rng() < 0.1 ? (pick(rng, GARBAGE) as number) : Math.floor(rng() * 500_000);
  return { nodes, edges, rps };
}

describe("analyze(): invariants over random graphs", () => {
  it("throughput ≤ offered load everywhere; every metric finite and in range", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { nodes, edges, rps } = randomCanvas(seed);
      const graph = compileGraph(nodes, edges);
      const s = analyze(graph, rps, { seed, samples: 200 });

      expect(s.throughputRps).toBeGreaterThanOrEqual(0);
      expect(s.throughputRps).toBeLessThanOrEqual(s.offeredRps + 1e-9);
      expect(s.offeredRps).toBeLessThanOrEqual(s.requestedRps);
      for (const v of [s.errorRate, s.availability]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const v of Object.values(s.latency)) {
        expect(Number.isFinite(v) && v >= 0).toBe(true);
      }

      const componentIds = new Set(graph.nodes.map((n) => n.id));
      expect(s.nodes.map((n) => n.nodeId).sort()).toEqual([...componentIds].sort());
      for (const n of s.nodes) {
        const values = [
          n.offeredRps,
          n.servedRps,
          n.droppedRps,
          n.capacityRps,
          n.utilization,
          n.meanLatencyMs,
          n.p50Ms,
          n.p95Ms,
          n.p99Ms,
          n.queueWaitMs,
          n.queueDepth,
        ];
        for (const v of values) expect(Number.isFinite(v) && v >= 0).toBe(true);
        expect(n.servedRps).toBeLessThanOrEqual(n.offeredRps + 1e-9);
        expect(n.errorRate).toBeGreaterThanOrEqual(0);
        expect(n.errorRate).toBeLessThanOrEqual(1);
        expect(n.p50Ms).toBeLessThanOrEqual(n.p95Ms + 1e-9);
        expect(n.p95Ms).toBeLessThanOrEqual(n.p99Ms + 1e-9);
      }
      for (const e of s.edges) {
        expect(componentIds.has(e.source) && componentIds.has(e.target)).toBe(true);
        expect(Number.isFinite(e.rps) && e.rps >= 0).toBe(true);
        if (e.back) expect(e.rps).toBe(0);
      }

      // Disconnected nodes never receive traffic.
      const touched = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
      for (const n of s.nodes) {
        if (!touched.has(n.nodeId) && n.componentId !== "client") expect(n.offeredRps).toBe(0);
      }
    }
  });
});
