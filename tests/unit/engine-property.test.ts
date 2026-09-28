import { describe, expect, it } from "vitest";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { randomCanvas } from "./engineFixtures";

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
