import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { techPreset } from "@/domain/components/technologies";
import type { Params } from "@/domain/components/types";
import { analyze } from "@/engine/analyze";
import type { NodeSteadyState, SteadyState } from "@/engine/types";
import { comp, compileV3, wire } from "./engineFixtures";

/**
 * Technology mechanics in `analyze()` (component-technologies T27): each
 * case is a client calling one node with a technology, at a read ratio that
 * makes every request a read (1) or a write (0).
 */

/** A node with a technology's preset (what the palette or the picker writes), plus overrides. */
function techNode(id: string, componentId: string, technology: string, params: Params = {}): Node {
  return comp(id, componentId, { ...techPreset(componentId, technology), ...params });
}

function direct(
  target: Node,
  rps: number,
  readRatio: number,
): { steady: SteadyState; node: NodeSteadyState } {
  const graph = compileV3([comp("client", "client"), target], [wire("client", target.id)]);
  const steady = analyze(graph, rps, { readRatio, seed: 7, samples: 500 });
  return { steady, node: steady.nodes.find((n) => n.nodeId === target.id)! };
}

const pg = techPreset("sql-db", "postgres");
const READ_CAP = pg.capacityPerInstance as number; // 40,000 (db.r6g.xlarge)
const WRITE_CAP = pg.writeCapacityRps as number; // 5,000

describe("SQL write primary (TEC-25/26)", () => {
  const postgres = (params: Params) => techNode("db", "sql-db", "postgres", params);

  it("writes are served up to shards × write capacity, whatever the instances", () => {
    const eight = direct(postgres({ instances: 8, shards: 1 }), 12_000, 0).node;
    const sixteen = direct(postgres({ instances: 16, shards: 1 }), 12_000, 0).node;
    expect(eight.servedRps).toBeCloseTo(Math.min(12_000, 1 * WRITE_CAP), 6);
    expect(sixteen.servedRps).toBeCloseTo(eight.servedRps, 9);
    expect(eight.droppedRps).toBeCloseTo(12_000 - WRITE_CAP, 6);
    expect(eight.limitKind).toBe("write-primary");
    expect(eight.limitUtilization).toBeCloseTo(12_000 / WRITE_CAP, 9);
    expect(eight.utilization).toBe(eight.limitUtilization);
    expect(eight.writeRps).toBeCloseTo(12_000, 9);
  });

  it("1 → 2 shards doubles the write throughput", () => {
    const one = direct(postgres({ instances: 8, shards: 1 }), 12_000, 0).node;
    const two = direct(postgres({ instances: 8, shards: 2 }), 12_000, 0).node;
    expect(two.servedRps).toBeCloseTo(2 * one.servedRps, 6);
    expect(two.servedRps).toBeCloseTo(2 * WRITE_CAP, 6);
  });

  it("reads scale with instances", () => {
    const two = direct(postgres({ instances: 2 }), 100_000, 1).node;
    const four = direct(postgres({ instances: 4 }), 100_000, 1).node;
    expect(two.servedRps).toBeCloseTo(2 * READ_CAP, 6);
    expect(four.servedRps).toBeCloseTo(100_000, 6);
    expect(two.limitKind).toBe("read-capacity");
    expect(two.limitUtilization).toBeCloseTo(100_000 / (2 * READ_CAP), 9);
    expect(two.writeRps).toBe(0);
  });
});

describe("hot partition and consistency (TEC-28…TEC-32)", () => {
  it("DynamoDB: a hot partition fails h·λ·(1 − 1/U); a strong read doubles U (TEC-28/31)", () => {
    const h = 0.5;
    const lambda = 20_000;
    const eventual = direct(
      techNode("db", "nosql-db", "dynamodb", { hotPartitionShare: h, readConsistency: "eventual" }),
      lambda,
      1,
    );
    // U = h × λ × 0.5 RRU / 3,000 RCU per partition
    const u = (h * lambda * 0.5) / 3_000;
    expect(eventual.node.droppedRps).toBeCloseTo(h * lambda * (1 - 1 / u), 6);
    expect(eventual.node.limitKind).toBe("hot-partition");
    expect(eventual.node.limitUtilization).toBeCloseTo(u, 9);
    expect(eventual.node.status).toBe("critical");
    expect(eventual.node.isBottleneck).toBe(true);
    // The throttled calls fail the client's requests.
    expect(eventual.steady.throughputRps).toBeCloseTo(lambda - h * lambda * (1 - 1 / u), 3);

    const strong = direct(
      techNode("db", "nosql-db", "dynamodb", { hotPartitionShare: h, readConsistency: "strong" }),
      lambda,
      1,
    ).node;
    expect(strong.limitUtilization).toBeCloseTo(2 * u, 9);
    expect(strong.droppedRps).toBeCloseTo(h * lambda * (1 - 1 / (2 * u)), 6);
  });

  it("Cassandra RF 3: read capacity C, C/2, C/3 from ONE to ALL and the p99 never drops (TEC-29/30)", () => {
    const k0 = techPreset("nosql-db", "cassandra").capacityPerInstance as number;
    const at = (consistencyLevel: string) =>
      direct(
        techNode("db", "nosql-db", "cassandra", {
          instances: 3,
          replicationFactor: 3,
          consistencyLevel,
          hotPartitionShare: 0,
        }),
        1_000,
        1,
      ).node;
    const one = at("one");
    const quorum = at("quorum");
    const all = at("all");
    const c = 3 * k0;
    expect(one.capacityRps).toBeCloseTo(c, 6);
    expect(quorum.capacityRps).toBeCloseTo(c / 2, 6);
    expect(all.capacityRps).toBeCloseTo(c / 3, 6);
    expect(one.limitKind).toBe("replica-ops");
    expect(quorum.p99Ms).toBeGreaterThanOrEqual(one.p99Ms);
    expect(all.p99Ms).toBeGreaterThanOrEqual(quorum.p99Ms);
  });

  describe("MongoDB (TEC-32)", () => {
    const k0 = techPreset("nosql-db", "mongodb").capacityPerInstance as number;
    const mongo = (params: Params) =>
      techNode("db", "nosql-db", "mongodb", {
        instances: 3,
        shards: 1,
        hotPartitionShare: 0,
        ...params,
      });

    it("`primary` reads go to the primaries only, `secondaryPreferred` to the secondaries", () => {
      const primary = direct(mongo({ readPreference: "primary" }), 20_000, 1).node;
      expect(primary.servedRps).toBeCloseTo(1 * k0, 6);
      expect(primary.limitKind).toBe("primaries");
      const secondary = direct(mongo({ readPreference: "secondaryPreferred" }), 20_000, 1).node;
      // (D4: the n − s = 2 secondaries)
      expect(secondary.servedRps).toBeCloseTo(20_000, 6);
      expect(secondary.limitKind).toBe("read-capacity");
      expect(secondary.limitUtilization).toBeCloseTo(20_000 / (2 * k0), 9);
    });

    it("`majority` adds the replication round trip to a write", () => {
      const majority = direct(mongo({ writeConcern: "majority" }), 1_000, 0).node;
      const w1 = direct(mongo({ writeConcern: "1" }), 1_000, 0).node;
      expect(majority.meanLatencyMs - w1.meanLatencyMs).toBeCloseTo(2, 9);
      expect(majority.p99Ms).toBeGreaterThan(w1.p99Ms);
    });
  });
});

describe("managed limits (TEC-35…TEC-38)", () => {
  it.each([
    ["message-queue", "sqs-fifo", 5_000, 3_000],
    ["pub-sub", "sns", 40_000, 30_000],
  ])("%s %s above its quota: errors = λ − L (TEC-35)", (componentId, technology, lambda, quota) => {
    const { node } = direct(techNode("q", componentId, technology), lambda, 0.5);
    expect(node.droppedRps).toBeCloseTo(lambda - quota, 6);
    expect(node.servedRps).toBeCloseTo(quota, 6);
    expect(node.limitKind).toBe("queue-throughput");
    expect(node.limitUtilization).toBeCloseTo(lambda / quota, 9);
    expect(node.status).toBe("critical");
  });

  it("OpenSearch: query capacity = min(n, shards·(replicas+1))·k₀ ÷ shards (TEC-36)", () => {
    const k0 = techPreset("search", "opensearch").capacityPerInstance as number;
    const capacity = (instances: number) =>
      direct(techNode("s", "search", "opensearch", { instances, shards: 5, replicas: 1 }), 100, 1)
        .node;
    expect(capacity(4).capacityRps).toBeCloseTo((4 * k0) / 5, 6);
    expect(capacity(10).capacityRps).toBeCloseTo((10 * k0) / 5, 6);
    // Nodes beyond the shard copies get nothing to serve.
    expect(capacity(20).capacityRps).toBeCloseTo((10 * k0) / 5, 6);
    expect(capacity(4).limitKind).toBe("query-capacity");
  });

  it("S3: 5,500 GET and 3,500 PUT per prefix; the excess fails (TEC-37)", () => {
    const s3 = (prefixes: number) => techNode("s3", "object-storage", "s3", { prefixes });
    const get = direct(s3(1), 10_000, 1);
    expect(get.node.droppedRps).toBeCloseTo(4_500, 6);
    expect(get.node.limitKind).toBe("prefix-limit");
    expect(get.node.status).toBe("critical");
    expect(get.steady.throughputRps).toBeCloseTo(5_500, 3);
    const put = direct(s3(1), 4_000, 0).node;
    expect(put.droppedRps).toBeCloseTo(500, 6);
    expect(put.writeRps).toBeCloseTo(4_000, 9);
    const two = direct(s3(2), 10_000, 1).node;
    expect(two.droppedRps).toBeCloseTo(0, 6);
  });

  it("AWS API Gateway: 15,000 req/s against 10,000 → 5,000 errors (TEC-38)", () => {
    const { node } = direct(techNode("gw", "api-gateway", "aws-api-gateway"), 15_000, 0.9);
    expect(node.droppedRps).toBeCloseTo(5_000, 6);
    expect(node.limitKind).toBe("account-throttle");
    expect(node.limitUtilization).toBeCloseTo(1.5, 9);
    expect(node.utilization).toBe(node.limitUtilization);
  });
});

describe("generic nodes (TEC-46)", () => {
  it("get no limit fields", () => {
    const { steady } = direct(comp("db", "sql-db"), 1_000, 0.9);
    for (const n of steady.nodes) {
      expect(Object.keys(n)).not.toContain("limitKind");
      expect(Object.keys(n)).not.toContain("limitUtilization");
      expect(Object.keys(n)).not.toContain("writeRps");
    }
  });
});
