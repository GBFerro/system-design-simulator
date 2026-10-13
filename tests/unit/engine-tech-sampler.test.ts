import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { sanitizeParams } from "@/domain/components/registry";
import { techProfileOf } from "@/domain/components/technologies/profile";
import type { Params } from "@/domain/components/types";
import { compileGraph } from "@/domain/graph/compile";
import { analyzeWithModel } from "@/engine/analyze";
import { mulberry32, type Rng } from "@/engine/core/rng";
import { sampleLatency, type SampleModel, type SampleNode } from "@/engine/core/sampler";
import { techSteadyFlow } from "@/engine/core/tech";
import { buildReferenceGraph } from "@/lib/loadReference";

/** A seeded PRNG that counts its draws. */
function countingRng(seed: number): Rng & { draws: number } {
  const inner = mulberry32(seed);
  const rng = (() => {
    rng.draws++;
    return inner();
  }) as Rng & { draws: number };
  rng.draws = 0;
  return rng;
}

/**
 * Draws the sampler took over the first 8 reference designs (all generic) at
 * their peak, 2,000 requests each, seed 11 — counted on the sampler BEFORE
 * the technology branch existed (commit 3859f0c).
 */
const DRAWS_BEFORE_TECH = 480_702;

/** A one-node design: an entry with a technology, sampled by class. */
function techModel(componentId: string, raw: Params, offered: number, readRatio: number) {
  const params = sanitizeParams(componentId, raw);
  const profile = techProfileOf(componentId, params)!;
  const core = {
    instances: params.instances as number,
    capacityPerInstance: params.capacityPerInstance as number,
    serviceTimeMs: params.serviceTimeMs as number,
  };
  const steady = techSteadyFlow({
    profile,
    core,
    offered,
    writeShare: 1 - readRatio,
    maxQueue: Infinity,
    horizonSec: 10,
  });
  const node: SampleNode = {
    station: steady.stations[0],
    dropProbability: 0,
    latencyShare: 1,
    kind: "rules",
    maxRetries: 0,
    missProbability: 1,
    edges: [],
    steps: [],
    absorbed: [],
    tech: { read: steady.view.read, write: steady.view.write },
  };
  const model: SampleModel = { nodes: new Map([["db", node]]), entries: ["db"], readRatio };
  return { model, steady };
}

describe("sampler by request class (T24)", () => {
  it("a generic design takes exactly the draws it took before the technology branch", () => {
    let draws = 0;
    for (const problem of PROBLEMS.slice(0, 8)) {
      const { nodes, edges } = buildReferenceGraph(problem);
      const graph = compileGraph(nodes, edges);
      expect(graph.nodes.every((n) => !("tech" in n))).toBe(true);
      const rps = problem.requirements.readsPerSec + problem.requirements.writesPerSec;
      const { model } = analyzeWithModel(graph, rps);
      expect([...model.nodes.values()].every((n) => !("tech" in n))).toBe(true);
      const rng = countingRng(11);
      sampleLatency(model, 2000, rng);
      draws += rng.draws;
    }
    expect(draws).toBe(DRAWS_BEFORE_TECH);
  });

  it("a request drops by its own class's drop probability (the isRead it drew)", () => {
    const { model } = techModel("object-storage", { technology: "s3" }, 100, 1);
    const db = model.nodes.get("db")!;
    db.tech = {
      read: { ...db.tech!.read, dropProbability: 0 },
      write: { ...db.tech!.write, dropProbability: 1 },
    };
    expect(sampleLatency({ ...model, readRatio: 1 }, 2000, mulberry32(1)).successRate).toBe(1);
    expect(sampleLatency({ ...model, readRatio: 0 }, 2000, mulberry32(1)).successRate).toBe(0);
    // The node's own drop probability is not read for a node with classes.
    db.dropProbability = 1;
    expect(sampleLatency({ ...model, readRatio: 1 }, 2000, mulberry32(1)).successRate).toBe(1);
  });

  it("Cassandra RF 3: sampled p99 doesn't decrease from ONE to QUORUM to ALL (TEC-30)", () => {
    const p99 = (consistencyLevel: string) =>
      sampleLatency(
        techModel(
          "nosql-db",
          { technology: "cassandra", instances: 3, replicationFactor: 3, consistencyLevel },
          5_000,
          0.9,
        ).model,
        20_000,
        mulberry32(4),
      ).latency.p99Ms;
    const one = p99("one");
    const quorum = p99("quorum");
    const all = p99("all");
    expect(quorum).toBeGreaterThanOrEqual(one);
    expect(all).toBeGreaterThanOrEqual(quorum);
    expect(all).toBeGreaterThan(one);
  });

  it("OpenSearch: sampled p99 doesn't decrease from 1 to 8 shards (TEC-36)", () => {
    const p99 = (shards: number) =>
      sampleLatency(
        techModel("search", { technology: "opensearch", shards, replicas: 1, instances: 16 }, 50, 1)
          .model,
        20_000,
        mulberry32(4),
      ).latency.p99Ms;
    const values = [1, 2, 4, 8].map(p99);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(values[3]).toBeGreaterThan(values[0]);
  });
});
