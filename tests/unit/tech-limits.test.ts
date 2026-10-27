import { describe, expect, it } from "vitest";
import { sanitizeParams } from "@/domain/components/registry";
import { LIMIT_LABELS, techLimitOf } from "@/domain/components/technologies/limits";
import {
  techProfileOf,
  type TechCore,
  type TechLimitKind,
  type TechProfile,
} from "@/domain/components/technologies/profile";
import type { Params } from "@/domain/components/types";

/** A node's profile and its numbers without faults (what compileGraph gives the engine). */
function nodeOf(componentId: string, raw: Params): { profile: TechProfile; core: TechCore } {
  const params = sanitizeParams(componentId, raw);
  const profile = techProfileOf(componentId, params);
  if (!profile) throw new Error(`no profile for ${componentId}`);
  return {
    profile,
    core: {
      instances: params.instances as number,
      capacityPerInstance: params.capacityPerInstance as number,
      serviceTimeMs: params.serviceTimeMs as number,
    },
  };
}

describe("limiting resource and its utilization (T21)", () => {
  it("PostgreSQL with writes above the primary: write-primary, which more instances don't fix (TEC-26/40/42)", () => {
    const { profile, core } = nodeOf("sql-db", {
      technology: "postgres",
      instanceClass: "db.r6g.xlarge",
      instances: 8,
    });
    // 5,000 writes/s per primary (xlarge), 7,000 offered.
    const limit = techLimitOf(profile, core, { read: 20_000, write: 7_000 });
    expect(limit.kind).toBe("write-primary");
    expect(limit.utilization).toBeCloseTo(7_000 / 5_000, 12);
    expect(limit.scalesWithInstances).toBe(false);
    expect(limit.capacityRps).toBeCloseTo(27_000 / 1.4, 6);

    const more = nodeOf("sql-db", { technology: "postgres", instances: 16 });
    expect(techLimitOf(more.profile, more.core, { read: 20_000, write: 7_000 }).utilization).toBe(
      limit.utilization,
    );
  });

  it("PostgreSQL with reads above its instances: read-capacity, which scales with instances", () => {
    const { profile, core } = nodeOf("sql-db", { technology: "postgres", instances: 2 });
    const limit = techLimitOf(profile, core, { read: 100_000, write: 100 });
    expect(limit).toMatchObject({ kind: "read-capacity", scalesWithInstances: true });
    expect(limit.utilization).toBeCloseTo(100_000 / 80_000, 12);
  });

  it("S3 with 10,000 GET/s on 1 prefix: prefix-limit at 10,000 / 5,500 (TEC-37)", () => {
    const { profile, core } = nodeOf("object-storage", { technology: "s3", prefixes: 1 });
    const limit = techLimitOf(profile, core, { read: 10_000, write: 0 });
    expect(limit.kind).toBe("prefix-limit");
    expect(limit.utilization).toBeCloseTo(10_000 / 5_500, 12);
    expect(limit.scalesWithInstances).toBe(false);
  });

  it("API Gateway at 15,000 req/s: account-throttle at 1.5 (TEC-38)", () => {
    const { profile, core } = nodeOf("api-gateway", { technology: "aws-api-gateway" });
    const limit = techLimitOf(profile, core, { read: 9_000, write: 6_000 });
    expect(limit.kind).toBe("account-throttle");
    expect(limit.utilization).toBeCloseTo(1.5, 12);
    expect(limit.capacityRps).toBeCloseTo(10_000, 6);
  });

  it("DynamoDB with a hot share of 0.9: hot-partition binds before the table (TEC-28)", () => {
    const { profile, core } = nodeOf("nosql-db", {
      technology: "dynamodb",
      hotPartitionShare: 0.9,
    });
    // 0.9 × 10,000 reads × 0.5 RRU ÷ 3,000 RCU = 1.5; the table runs at 10,000 / 40,000.
    const limit = techLimitOf(profile, core, { read: 10_000, write: 0 });
    expect(limit.kind).toBe("hot-partition");
    expect(limit.utilization).toBeCloseTo(1.5, 12);
    expect(limit.scalesWithInstances).toBe(false);
    // A strong read costs twice the units (TEC-31).
    const strong = nodeOf("nosql-db", {
      technology: "dynamodb",
      hotPartitionShare: 0.9,
      readConsistency: "strong",
    });
    expect(
      techLimitOf(strong.profile, strong.core, { read: 10_000, write: 0 }).utilization,
    ).toBeCloseTo(3, 12);
  });

  it("demand 0: utilization 0 and a finite nominal capacity (at an even mix)", () => {
    const { profile, core } = nodeOf("sql-db", { technology: "postgres", instances: 1 });
    const limit = techLimitOf(profile, core, { read: 0, write: 0 });
    expect(limit.utilization).toBe(0);
    // 0.5 write per request on a 5,000 writes/s primary.
    expect(limit.kind).toBe("write-primary");
    expect(limit.capacityRps).toBeCloseTo(10_000, 6);
    for (const [id, raw] of [
      ["cache", { technology: "redis" }],
      ["object-storage", { technology: "s3" }],
      ["message-queue", { technology: "kafka" }],
      ["nosql-db", { technology: "cassandra" }],
      ["search", { technology: "opensearch" }],
    ] as const) {
      const n = nodeOf(id, raw);
      const zero = techLimitOf(n.profile, n.core, { read: 0, write: 0 });
      expect(zero.utilization).toBe(0);
      expect(Number.isFinite(zero.capacityRps) && zero.capacityRps > 0).toBe(true);
    }
  });

  it("a technology without mechanics reports plain capacity; managed ones don't scale with instances", () => {
    const redis = nodeOf("cache", { technology: "redis", instances: 2 });
    const limit = techLimitOf(redis.profile, redis.core, { read: 284_000, write: 0 });
    expect(limit).toMatchObject({ kind: "capacity", utilization: 1, scalesWithInstances: true });
    const alb = nodeOf("load-balancer", { technology: "aws-alb" });
    expect(techLimitOf(alb.profile, alb.core, { read: 1, write: 0 }).scalesWithInstances).toBe(
      false,
    );
  });

  it("a fault that halves the node's capacity doubles a machine-bound utilization, not a managed quota's", () => {
    const sql = nodeOf("sql-db", { technology: "postgres" });
    const half = { ...sql.core, capacityPerInstance: sql.core.capacityPerInstance / 2 };
    const demand = { read: 0, write: 4_000 };
    expect(techLimitOf(sql.profile, half, demand).utilization).toBeCloseTo(
      2 * techLimitOf(sql.profile, sql.core, demand).utilization,
      12,
    );
    const s3 = nodeOf("object-storage", { technology: "s3" });
    const s3half = { ...s3.core, capacityPerInstance: s3.core.capacityPerInstance / 2 };
    expect(techLimitOf(s3.profile, s3half, { read: 5_000, write: 0 }).utilization).toBeCloseTo(
      5_000 / 5_500,
      12,
    );
  });

  it("every limit kind has a label", () => {
    const kinds: TechLimitKind[] = [
      "capacity",
      "read-capacity",
      "write-primary",
      "replica-ops",
      "primaries",
      "hot-partition",
      "query-capacity",
      "prefix-limit",
      "account-throttle",
      "queue-throughput",
      "consumers",
      "consumers-partitions",
    ];
    expect(Object.keys(LIMIT_LABELS).sort()).toEqual([...kinds].sort());
    expect(LIMIT_LABELS["write-primary"]).toBe("Write primary");
    expect(LIMIT_LABELS["consumers-partitions"]).toBe("Consumers capped by partitions");
    expect(LIMIT_LABELS["prefix-limit"]).toBe("S3 prefix limit");
  });
});
