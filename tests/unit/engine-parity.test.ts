import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { analyze } from "@/engine/analyze";
import { TickSimulator } from "@/engine/core/tick";
import type { SimGraph } from "@/domain/graph/compile";
import type { TickSnapshot } from "@/engine/types";
import { buildReferenceGraph } from "@/lib/loadReference";
import { comp, wire, compileV3 } from "./engineFixtures";

// analyze() and the tick loop share core/settle.ts and the routing. At a steady
// load below capacity they must show the same picture, or the Simulate button
// and Play would disagree about the same design.
const RPS = 1_000;
const WARMUP_TICKS = 100;
const MEASURE_TICKS = 200;
const REL_TOL = 0.05;

function tickAverage(graphNodes: SimGraph, ticks: TickSnapshot[]) {
  const rpsIn = new Map<string, number>();
  for (const n of graphNodes.nodes) {
    rpsIn.set(n.id, ticks.reduce((a, s) => a + s.nodes[n.id].rpsIn, 0) / ticks.length);
  }
  const throughput = ticks.reduce((a, s) => a + s.global.throughput, 0) / ticks.length;
  return { rpsIn, throughput };
}

describe("tick loop vs analyze() at steady state", () => {
  const healthy = PROBLEMS.flatMap((p) => {
    const { nodes, edges } = buildReferenceGraph(p);
    const graph = compileV3(nodes, edges);
    const steady = analyze(graph, RPS);
    const ok = steady.offeredRps > 0 && steady.nodes.every((n) => n.utilization < 0.7);
    return ok ? [{ id: p.id, graph, steady }] : [];
  });

  it("has reference solutions to compare", () => {
    expect(healthy.length).toBeGreaterThanOrEqual(20);
  });

  // Look-aside cache (request-flow): the database gets writes + reads after a miss.
  const lookAsideEdge = (source: string, target: string, rule: unknown): Edge => ({
    id: `e-${source}-${target}`,
    source,
    target,
    data: { protocol: "http", async: false, rule },
  });
  const lookAsideGraph = compileV3(
    [
      comp("client", "client"),
      comp("svc", "app-server", { instances: 10 }),
      comp("redis", "cache", { hitRate: 0.9, instances: 2, capacityPerInstance: 50_000 }),
      comp("db", "sql-db", { instances: 4, capacityPerInstance: 5000 }),
    ],
    [
      wire("client", "svc"),
      lookAsideEdge("svc", "redis", {
        calls: [{ kind: "reads", callsPerRequest: 1 }],
        networkLatencyMs: 1,
        packetLoss: 0,
      }),
      lookAsideEdge("svc", "db", {
        calls: [
          { kind: "writes", callsPerRequest: 1 },
          { kind: "after_miss", missOf: "redis", callsPerRequest: 1 },
        ],
        networkLatencyMs: 1,
        packetLoss: 0,
      }),
    ],
  );
  const lookAside = {
    id: "synthetic:look-aside",
    graph: lookAsideGraph,
    steady: analyze(lookAsideGraph, RPS),
  };

  it.each([...healthy.filter((_, i) => i % 4 === 0), lookAside].map((h) => [h.id, h] as const))(
    "%s: per-node load and throughput agree",
    (_id, h) => {
      const sim = new TickSimulator(h.graph, { seed: 1 });
      for (let i = 0; i < WARMUP_TICKS; i++) sim.step(RPS);
      const ticks: TickSnapshot[] = [];
      for (let i = 0; i < MEASURE_TICKS; i++) ticks.push(sim.step(RPS));
      const avg = tickAverage(h.graph, ticks);

      expect(avg.throughput).toBeCloseTo(h.steady.throughputRps, -Math.log10(RPS * REL_TOL));
      for (const n of h.steady.nodes) {
        const measured = avg.rpsIn.get(n.nodeId)!;
        const tolerance = Math.max(REL_TOL * n.offeredRps, 0.02 * RPS);
        expect(
          Math.abs(measured - n.offeredRps),
          `${n.nodeId}: tick ${measured} vs analyze ${n.offeredRps}`,
        ).toBeLessThanOrEqual(tolerance);
      }
    },
  );
});
