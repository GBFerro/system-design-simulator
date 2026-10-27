import { describe, expect, it } from "vitest";
import { sanitizeParams } from "@/domain/components/registry";
import {
  QUOTA_HEADROOM,
  scaledStation,
  techProfileOf,
  type TechProfile,
} from "@/domain/components/technologies/profile";
import type { Params } from "@/domain/components/types";

/** Params of a node as the compiler sees them (validated, technology preset applied). */
function params(componentId: string, raw: Params): Params {
  return sanitizeParams(componentId, raw);
}

function profileOf(componentId: string, raw: Params): TechProfile {
  const profile = techProfileOf(componentId, params(componentId, raw));
  if (!profile) throw new Error(`no profile for ${componentId}`);
  return profile;
}

describe("technology profile per node (T20)", () => {
  it("generic (and an unknown technology) has no profile", () => {
    expect(techProfileOf("nosql-db", params("nosql-db", {}))).toBeUndefined();
    expect(
      techProfileOf("nosql-db", params("nosql-db", { technology: "generic" })),
    ).toBeUndefined();
    expect(techProfileOf("nosql-db", { technology: "oracle" })).toBeUndefined();
    expect(techProfileOf("app-server", { technology: "postgres" })).toBeUndefined();
  });

  it("base = the node's own capacity and service time", () => {
    const p = profileOf("cache", {
      technology: "redis",
      capacityPerInstance: 1234,
      serviceTimeMs: 7,
    });
    expect(p.base).toEqual({ capacityPerInstance: 1234, serviceTimeMs: 7 });
    // Redis has no mechanics beyond capacity and latency: no classes, throttle or consumer cap.
    expect(p).toEqual({
      technology: "redis",
      base: { capacityPerInstance: 1234, serviceTimeMs: 7 },
    });
  });

  it("Cassandra RF 3 QUORUM: reads kth(2,3) cost 2, writes kth(2,3) cost 3 (TEC-29, D1)", () => {
    const p = profileOf("nosql-db", {
      technology: "cassandra",
      replicationFactor: 3,
      consistencyLevel: "quorum",
      instances: 6,
    });
    expect(p.classes?.read).toMatchObject({
      station: 0,
      cost: 2,
      shape: { kind: "kth", k: 2, n: 3 },
    });
    expect(p.classes?.write).toMatchObject({
      station: 0,
      cost: 3,
      shape: { kind: "kth", k: 2, n: 3 },
    });
    expect(p.classes?.stations).toHaveLength(1);
    expect(p.classes?.stations[0]).toMatchObject({ instances: 6, limit: "replica-ops" });
  });

  it("Cassandra ONE and ALL wait for 1 and RF replies", () => {
    const one = profileOf("nosql-db", { technology: "cassandra", consistencyLevel: "one" });
    const all = profileOf("nosql-db", { technology: "scylladb", consistencyLevel: "all" });
    expect(one.classes?.read).toMatchObject({ cost: 1, shape: { kind: "kth", k: 1, n: 3 } });
    expect(all.classes?.read).toMatchObject({ cost: 3, shape: { kind: "kth", k: 3, n: 3 } });
    expect(all.classes?.write).toMatchObject({ cost: 3, shape: { kind: "kth", k: 3, n: 3 } });
  });

  // An even RF tells ⌊RF/2⌋ + 1 apart from ⌈RF/2⌉ (validation round 1, mutant M3b).
  it.each([
    { rf: 2, quorum: 2 },
    { rf: 4, quorum: 3 },
    { rf: 6, quorum: 4 },
  ])(
    "even RF $rf: QUORUM waits for ⌊RF/2⌋ + 1 = $quorum replies, ONE for 1, ALL for RF (TEC-29)",
    ({ rf, quorum }) => {
      for (const technology of ["cassandra", "scylladb"]) {
        const at = (consistencyLevel: string) =>
          profileOf("nosql-db", {
            technology,
            replicationFactor: rf,
            consistencyLevel,
            instances: 8,
          });
        const q = at("quorum");
        expect(q.classes?.read).toMatchObject({
          cost: quorum,
          shape: { kind: "kth", k: quorum, n: rf },
        });
        expect(q.classes?.write).toMatchObject({
          cost: rf,
          shape: { kind: "kth", k: quorum, n: rf },
        });
        expect(q.throttle).toMatchObject({ readCost: quorum, writeCost: rf });

        const one = at("one");
        expect(one.classes?.read).toMatchObject({ cost: 1, shape: { kind: "kth", k: 1, n: rf } });
        expect(one.classes?.write).toMatchObject({ cost: rf, shape: { kind: "kth", k: 1, n: rf } });

        const all = at("all");
        expect(all.classes?.read).toMatchObject({ cost: rf, shape: { kind: "kth", k: rf, n: rf } });
        expect(all.classes?.write).toMatchObject({
          cost: rf,
          shape: { kind: "kth", k: rf, n: rf },
        });
      }
    },
  );

  it("Cassandra's hot partition lives on min(RF, n) nodes of replica ops (TEC-28)", () => {
    const p = profileOf("nosql-db", {
      technology: "cassandra",
      instances: 2,
      hotPartitionShare: 0.4,
    });
    const k0 = p.base.capacityPerInstance;
    expect(p.throttle).toEqual({
      kind: "partition",
      share: 0.4,
      readCost: 2,
      writeCost: 3,
      readUnits: 2 * k0,
      writeUnits: 2 * k0,
      nodeBound: true,
    });
  });

  it("DynamoDB: a strong read costs 1 unit, an eventual one 0.5, of 3,000 RCU / 1,000 WCU per partition (TEC-28/31)", () => {
    const eventual = profileOf("nosql-db", { technology: "dynamodb", hotPartitionShare: 0.2 });
    const strong = profileOf("nosql-db", { technology: "dynamodb", readConsistency: "strong" });
    expect(eventual.throttle).toEqual({
      kind: "partition",
      share: 0.2,
      readCost: 0.5,
      writeCost: 1,
      readUnits: 3000,
      writeUnits: 1000,
      nodeBound: false,
    });
    expect(strong.throttle).toMatchObject({ readCost: 1, writeCost: 1 });
    expect(eventual.classes?.read).toMatchObject({ station: 0, cost: 1, shape: { kind: "one" } });
  });

  it("MongoDB primary: reads and writes on the primaries (one per shard); majority adds the replication RTT (TEC-32)", () => {
    const p = profileOf("nosql-db", {
      technology: "mongodb",
      instances: 6,
      shards: 2,
      readPreference: "primary",
      writeConcern: "majority",
    });
    const stations = p.classes!.stations;
    expect(stations.map((s) => [s.instances, s.limit])).toEqual([
      [4, "read-capacity"],
      [2, "primaries"],
    ]);
    expect(p.classes?.read.station).toBe(1);
    expect(p.classes?.write).toMatchObject({ station: 1, addMs: 2 });
    const w1 = profileOf("nosql-db", { technology: "mongodb", instances: 3, writeConcern: "1" });
    expect(w1.classes?.write.addMs).toBe(0);
  });

  it("MongoDB secondaryPreferred routes reads to the secondaries station (n − s members, D4)", () => {
    const p = profileOf("nosql-db", {
      technology: "mongodb",
      instances: 6,
      shards: 2,
      readPreference: "secondaryPreferred",
    });
    const read = p.classes!.read;
    expect(p.classes!.stations[read.station]).toMatchObject({
      instances: 4,
      limit: "read-capacity",
    });
    expect(p.classes!.stations[p.classes!.write.station]).toMatchObject({
      instances: 2,
      limit: "primaries",
    });
  });

  it("MongoDB with n = s has no secondaries: reads stay on the primaries", () => {
    const p = profileOf("nosql-db", {
      technology: "mongodb",
      instances: 2,
      shards: 2,
      readPreference: "secondaryPreferred",
    });
    expect(p.classes!.stations).toHaveLength(1);
    expect(p.classes!.stations[0]).toMatchObject({ instances: 2, limit: "primaries" });
    expect(p.classes!.read.station).toBe(0);
  });

  it("SQL primary: reads on (n, k₀, S₀), writes on (shards, writeCapacityRps, writeServiceTimeMs) (TEC-25)", () => {
    const p = profileOf("sql-db", {
      technology: "postgres",
      instanceClass: "db.r6g.xlarge",
      instances: 8,
      shards: 2,
    });
    expect(p.classes!.stations).toEqual([
      {
        instances: 8,
        capacityPerInstance: 40_000,
        serviceTimeMs: 0.1,
        limit: "read-capacity",
        scalesWithInstances: true,
      },
      {
        instances: 2,
        capacityPerInstance: 5_000,
        serviceTimeMs: 1.5,
        limit: "write-primary",
        scalesWithInstances: false,
      },
    ]);
    expect(p.classes!.read.station).toBe(0);
    expect(p.classes!.write.station).toBe(1);
    // A read replica takes no writes: no primary in it.
    expect(profileOf("read-replica", { technology: "postgres" }).classes).toBeUndefined();
  });

  it("OpenSearch: a query costs `shards` shard queries, slowest of the shards; nodes beyond the copies don't serve (TEC-36)", () => {
    const p = profileOf("search", {
      technology: "opensearch",
      shards: 5,
      replicas: 1,
      instances: 20,
    });
    expect(p.classes!.read).toMatchObject({ cost: 5, shape: { kind: "max", n: 5 } });
    expect(p.classes!.stations[0]).toMatchObject({
      instances: 10,
      limit: "query-capacity",
      scalesWithInstances: false,
    });
    // Writes index every copy of one shard: (replicas + 1) × 0.1 shard queries.
    expect(p.classes!.write.cost).toBeCloseTo(0.2, 12);
    const small = profileOf("search", {
      technology: "opensearch",
      shards: 5,
      replicas: 1,
      instances: 4,
    });
    expect(small.classes!.stations[0]).toMatchObject({ instances: 4, scalesWithInstances: true });
  });

  it("S3: 5,500 GET and 3,500 PUT per prefix × prefixes, the excess a prefix-limit error (TEC-37)", () => {
    const p = profileOf("object-storage", { technology: "s3", prefixes: 3 });
    expect(p.throttle).toEqual({
      kind: "quota",
      limit: "prefix-limit",
      readRps: 16_500,
      writeRps: 10_500,
    });
    // The quota, not a queue, limits a managed service.
    expect(p.classes!.stations[0].capacityPerInstance).toBe(27_000 * QUOTA_HEADROOM);
  });

  it("AWS API Gateway: the account throttle, 10,000 req/s with a 5,000 burst (TEC-38)", () => {
    const p = profileOf("api-gateway", { technology: "aws-api-gateway" });
    expect(p.throttle).toEqual({
      kind: "quota",
      limit: "account-throttle",
      sharedRps: 10_000,
      burst: 5_000,
    });
  });

  it("SQS FIFO and SNS quotas, RabbitMQ's per-queue ceiling of its class (TEC-35)", () => {
    expect(profileOf("message-queue", { technology: "sqs-fifo" }).throttle).toEqual({
      kind: "quota",
      limit: "queue-throughput",
      sharedRps: 3_000,
    });
    expect(profileOf("pub-sub", { technology: "sns" }).throttle).toMatchObject({
      sharedRps: 30_000,
      limit: "queue-throughput",
    });
    const large = profileOf("message-queue", {
      technology: "rabbitmq",
      instanceClass: "mq.m7g.large",
    });
    expect(large.throttle).toMatchObject({ sharedRps: 15_000 });
    // A broker is a real machine: its station keeps its own capacity.
    expect(large.classes!.stations[0].capacityPerInstance).toBe(19_500);
    expect(profileOf("message-queue", { technology: "rabbitmq" }).throttle).toMatchObject({
      sharedRps: 20_000,
    });
    // SQS Standard has no quota mechanics.
    expect(profileOf("message-queue", { technology: "sqs-standard" }).throttle).toBeUndefined();
  });

  it("Kafka caps consumers at its partitions (TEC-34), on queues and pub/sub", () => {
    expect(profileOf("message-queue", { technology: "kafka", partitions: 6 }).consumerCap).toBe(6);
    expect(profileOf("pub-sub", { technology: "kafka", partitions: 12 }).consumerCap).toBe(12);
  });

  it("out-of-range params are clamped (TEC-48)", () => {
    // Raw params straight in (no sanitizeParams): the profile clamps on its own.
    const cassandra = techProfileOf("nosql-db", {
      technology: "cassandra",
      replicationFactor: 12,
      consistencyLevel: "all",
      instances: -4,
      capacityPerInstance: NaN,
      serviceTimeMs: -1,
      hotPartitionShare: 3,
    })!;
    expect(cassandra.classes!.read.shape).toEqual({ kind: "kth", k: 7, n: 7 });
    expect(cassandra.classes!.stations[0].instances).toBe(1);
    expect(cassandra.base).toEqual({ capacityPerInstance: 1, serviceTimeMs: 1 });
    expect((cassandra.throttle as { share: number }).share).toBe(1);

    const rf0 = techProfileOf("nosql-db", { technology: "scylladb", replicationFactor: 0 })!;
    expect(rf0.classes!.read.shape).toEqual({ kind: "kth", k: 1, n: 1 });

    const s3 = techProfileOf("object-storage", { technology: "s3", prefixes: 5000 })!;
    expect(s3.throttle).toMatchObject({ readRps: 5_500_000, writeRps: 3_500_000 });
    const s3low = techProfileOf("object-storage", { technology: "s3", prefixes: 0 })!;
    expect(s3low.throttle).toMatchObject({ readRps: 5_500 });

    const search = techProfileOf("search", {
      technology: "opensearch",
      shards: 99_999,
      replicas: -3,
    })!;
    expect(search.classes!.read.cost).toBe(1024);
    expect(search.classes!.read.shape).toEqual({ kind: "max", n: 1024 });

    const sql = techProfileOf("sql-db", {
      technology: "postgres",
      shards: 0,
      writeCapacityRps: Infinity,
    })!;
    expect(sql.classes!.stations[1].instances).toBe(1);
    expect(Number.isFinite(sql.classes!.stations[1].capacityPerInstance)).toBe(true);
    expect(sql.classes!.stations[1].capacityPerInstance).toBeGreaterThan(0);

    const kafka = techProfileOf("message-queue", { technology: "kafka", partitions: -2 })!;
    expect(kafka.consumerCap).toBe(1);
  });

  it("a station with the node's own numbers scales exactly with the node (faults)", () => {
    const p = profileOf("sql-db", { technology: "postgres" });
    const core = { instances: 1, capacityPerInstance: 40_000 * 0.5, serviceTimeMs: 0.1 * 2 };
    expect(scaledStation(p, p.classes!.stations[0], core)).toEqual({
      instances: 1,
      capacityPerInstance: 20_000,
      serviceTimeMs: 0.2,
    });
    const primary = scaledStation(p, p.classes!.stations[1], core);
    expect(primary.capacityPerInstance).toBeCloseTo(2_500, 9);
    expect(primary.serviceTimeMs).toBeCloseTo(3, 12);
  });

  it("the profile is plain data (survives structured clone and JSON)", () => {
    const p = profileOf("api-gateway", { technology: "aws-api-gateway" });
    expect(structuredClone(p)).toEqual(p);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});
