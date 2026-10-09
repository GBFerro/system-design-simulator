import { requestEdges } from "@/domain/graph/returns";
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { analyze } from "@/engine/analyze";
import { runSimulation } from "@/engine/legacy/simulator";
import { buildReferenceGraph } from "@/lib/loadReference";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { SteadyState } from "@/engine/types";
import type { EdgeRule } from "@/domain/components/types";
import { compileV3 } from "./engineFixtures";

function assertFinite(s: SteadyState) {
  const numbers: number[] = [
    s.offeredRps,
    s.throughputRps,
    s.errorRate,
    s.availability,
    s.latency.meanMs,
    s.latency.p50Ms,
    s.latency.p95Ms,
    s.latency.p99Ms,
  ];
  for (const n of s.nodes) {
    numbers.push(
      n.offeredRps,
      n.servedRps,
      n.droppedRps,
      n.errorRate,
      n.capacityRps,
      n.utilization,
      n.meanLatencyMs,
      n.p50Ms,
      n.p95Ms,
      n.p99Ms,
      n.queueWaitMs,
      n.queueDepth,
      n.availability,
    );
  }
  for (const e of s.edges) numbers.push(e.rps, e.retryAmplification, e.failureRate);
  for (const v of numbers) expect(Number.isFinite(v)).toBe(true);
}

describe("reference solutions through analyze()", () => {
  expect(PROBLEMS).toHaveLength(35);

  it.each(PROBLEMS.map((p) => [p.id, p] as const))("%s simulates without error", (_id, problem) => {
    const { nodes, edges } = buildReferenceGraph(problem);
    const graph = compileV3(nodes, edges);
    for (const rps of [
      problem.requirements.readsPerSec + problem.requirements.writesPerSec,
      10_000,
    ]) {
      const s = analyze(graph, rps);
      assertFinite(s);
      expect(s.throughputRps).toBeLessThanOrEqual(s.offeredRps + 1e-9);
      expect(s.latency.p50Ms).toBeLessThanOrEqual(s.latency.p95Ms);
      expect(s.latency.p95Ms).toBeLessThanOrEqual(s.latency.p99Ms);
      for (const n of s.nodes) expect(n.servedRps).toBeLessThanOrEqual(n.offeredRps + 1e-9);
    }
  });

  // Legacy engine kept only as a comparison: the new routing (rules, hit
  // rates, LB split) changes HOW MUCH each node gets, never WHETHER it gets
  // traffic. A node reached by the legacy fan-out must be reached now too —
  // except through control links (`callsPerRequest: 0`, e.g. a message
  // queue's coordination service), which carry no requests by design.
  it.each(PROBLEMS.map((p) => [p.id, p] as const))(
    "%s: same nodes receive traffic as the legacy engine",
    (_id, problem) => {
      const built = buildReferenceGraph(problem);
      const nodes = built.nodes;
      // (the legacy engine predates responses: it reads the requests)
      const edges = requestEdges(built.edges);
      const legacy = runSimulation(nodes as Node<ComponentNodeData>[], edges, 10_000);
      const steady = analyze(compileV3(nodes, edges), 10_000);
      const incoming = (id: string) => edges.filter((e) => e.target === id);
      const controlOnly = (id: string) =>
        incoming(id).length > 0 &&
        incoming(id).every(
          (e) =>
            (e.data as { rule?: EdgeRule }).rule?.calls.every((c) => c.callsPerRequest === 0) ===
            true,
        );
      const legacyReached = [...legacy.nodeMetrics.values()]
        .filter((m) => m.incomingQPS > 0 && !controlOnly(m.nodeId))
        .map((m) => m.nodeId)
        .sort();
      const reached = steady.nodes
        .filter((n) => n.offeredRps > 0)
        .map((n) => n.nodeId)
        .sort();
      expect(reached).toEqual(legacyReached);
    },
  );
});
