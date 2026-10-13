import { describe, expect, it } from "vitest";
import { instanceClassSpec, PARAM, technologySpec } from "@/domain/components/params";
import { SYSTEM_COMPONENTS } from "@/data/components";
import {
  defaultParams,
  getSchema,
  isValidParam,
  normalizeTechParams,
  sanitizeParams,
} from "@/domain/components/registry";
import type { ParamSpec, Params } from "@/domain/components/types";
import {
  buildTechIndex,
  CENTRAL_TYPES,
  classOf,
  defaultTechnologyOf,
  getTechnology,
  techPreset,
  TECHNOLOGIES,
  technologiesOf,
} from "@/domain/components/technologies";
import type { Technology } from "@/domain/components/technologies";

/* ---------- T1: lookups over a fixture list (TEC-10, TEC-12) ---------- */

const source = [{ title: "Fixture", url: "https://example.com/bench", year: 2026 }];

const ALPHA: Technology = {
  id: "alpha",
  componentIds: ["sql-db", "read-replica"],
  label: "Alpha (RDS)",
  short: "Alpha",
  description: "Fixture SQL technology.",
  consistency: "Single primary.",
  billing: "instance",
  classes: [
    {
      id: "a.large",
      vCpu: 2,
      capacityPerInstance: 100,
      serviceTimeMs: 1,
      perInstanceHour: 0.1,
      params: { writeCapacityRps: 10 },
      evidence: "derived",
    },
    {
      id: "a.xlarge",
      vCpu: 4,
      capacityPerInstance: 200,
      serviceTimeMs: 0.5,
      perInstanceHour: 0.2,
      params: { writeCapacityRps: 20, failoverSec: 45 },
      evidence: "derived",
    },
  ],
  defaultClass: "a.xlarge",
  params: { failoverSec: 90, shards: 1 },
  sources: source,
  assumptions: "Fixture.",
};

const BETA: Technology = {
  id: "beta",
  componentIds: ["sql-db"],
  defaultFor: ["sql-db"],
  label: "Beta",
  short: "Beta",
  description: "Fixture managed technology.",
  consistency: "Fixture.",
  billing: "managed",
  managed: {
    capacityPerInstance: 5000,
    serviceTimeMs: 3,
    evidence: "estimate",
    perMillionReads: 0.1,
    perMillionWrites: 0.5,
  },
  params: { timeoutMs: 30_000 },
  sources: source,
  assumptions: "Fixture.",
};

const index = buildTechIndex([ALPHA, BETA]);

describe("technology catalog lookups (T1)", () => {
  it("lists a type's technologies in the list's order, generic never among them", () => {
    expect(index.technologiesOf("sql-db").map((t) => t.id)).toEqual(["alpha", "beta"]);
    expect(index.technologiesOf("read-replica").map((t) => t.id)).toEqual(["alpha"]);
    expect(index.technologiesOf("cache")).toEqual([]);
    expect(index.technologiesOf("sql-db").some((t) => t.id === "generic")).toBe(false);
    expect(index.getTechnology("sql-db", "generic")).toBeUndefined();
  });

  it("finds a technology only under the types that offer it", () => {
    expect(index.getTechnology("sql-db", "beta")).toBe(BETA);
    expect(index.getTechnology("read-replica", "beta")).toBeUndefined();
  });

  it("classOf without an id (or with one the technology lacks) gives the default class", () => {
    expect(classOf(ALPHA)?.id).toBe("a.xlarge");
    expect(classOf(ALPHA, "a.large")?.id).toBe("a.large");
    expect(classOf(ALPHA, "cache.r6g.large")?.id).toBe("a.xlarge");
    expect(classOf(BETA)).toBeUndefined();
  });

  it("techPreset = technology + class + capacity and service time + the technology's params + the class's", () => {
    expect(index.techPreset("sql-db", "alpha")).toEqual({
      technology: "alpha",
      instanceClass: "a.xlarge",
      capacityPerInstance: 200,
      serviceTimeMs: 0.5,
      shards: 1,
      writeCapacityRps: 20,
      failoverSec: 45,
    });
    expect(index.techPreset("sql-db", "alpha", "a.large")).toEqual({
      technology: "alpha",
      instanceClass: "a.large",
      capacityPerInstance: 100,
      serviceTimeMs: 1,
      failoverSec: 90,
      shards: 1,
      writeCapacityRps: 10,
    });
  });

  it("a managed technology's preset carries its capacity and service time and no class", () => {
    expect(index.techPreset("sql-db", "beta")).toEqual({
      technology: "beta",
      capacityPerInstance: 5000,
      serviceTimeMs: 3,
      timeoutMs: 30_000,
    });
  });

  it("techPreset of generic or of a technology the type doesn't offer is empty", () => {
    expect(index.techPreset("sql-db", "generic")).toEqual({});
    expect(index.techPreset("read-replica", "beta")).toEqual({});
  });

  it("defaultTechnologyOf: the technology declared default for the type, undefined without one", () => {
    expect(index.defaultTechnologyOf("sql-db")).toBe("beta");
    expect(index.defaultTechnologyOf("read-replica")).toBeUndefined();
    expect(index.defaultTechnologyOf("cdn")).toBeUndefined();
  });
});

/* ---------- TEC-11: every registered technology is sourced and finite ---------- */

/** Param keys a technology may set: `PARAM` plus the keys T8 adds to it. */
const TECH_PARAM_KEYS = new Set<string>([
  ...Object.values(PARAM),
  "technology",
  "instanceClass",
  "prefixes",
  "readPreference",
  "writeConcern",
  "readConsistency",
]);
const EVIDENCE = ["measured", "derived", "estimate"];
const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;

describe("every technology has sources, assumptions, evidence and finite positive numbers (TEC-11)", () => {
  it("the catalog isn't empty and ids are unique", () => {
    expect(TECHNOLOGIES.length).toBeGreaterThan(0);
    expect(new Set(TECHNOLOGIES.map((t) => t.id)).size).toBe(TECHNOLOGIES.length);
  });

  for (const tech of TECHNOLOGIES) {
    describe(tech.id, () => {
      it("cites https sources with a year", () => {
        expect(tech.sources.length).toBeGreaterThan(0);
        for (const s of tech.sources) {
          expect(s.title.trim(), tech.id).not.toBe("");
          expect(s.url, s.title).toMatch(/^https:\/\/\S+$/);
          expect(Number.isInteger(s.year) && s.year >= 2000 && s.year <= 2026, s.title).toBe(true);
        }
      });

      it("states its assumptions, purpose and consistency, one line each", () => {
        expect(tech.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(tech.id).not.toBe("generic");
        for (const text of [
          tech.assumptions,
          tech.description,
          tech.consistency,
          tech.label,
          tech.short,
        ]) {
          expect(text.trim()).not.toBe("");
          expect(text).not.toContain("\n");
        }
      });

      it("sizes every class (or its managed spec) with evidence, finite positive numbers and a price", () => {
        if (tech.billing === "instance") {
          expect(tech.managed).toBeUndefined();
          expect(tech.classes?.length).toBeGreaterThan(0);
          expect(tech.classes?.map((c) => c.id)).toContain(tech.defaultClass);
          for (const c of tech.classes ?? []) {
            expect(EVIDENCE, c.id).toContain(c.evidence);
            for (const n of [c.vCpu, c.capacityPerInstance, c.serviceTimeMs, c.perInstanceHour]) {
              expect(positive(n), `${c.id}: ${n}`).toBe(true);
            }
          }
        } else {
          expect(tech.classes).toBeUndefined();
          const m = tech.managed;
          expect(m).toBeDefined();
          expect(EVIDENCE).toContain(m?.evidence);
          for (const n of [
            m?.capacityPerInstance,
            m?.serviceTimeMs,
            m?.perMillionReads,
            m?.perMillionWrites,
          ]) {
            expect(positive(n), `${tech.id}: ${n}`).toBe(true);
          }
        }
      });

      it("sets only real param keys, numbers finite and positive", () => {
        const params = [tech.params, ...(tech.classes ?? []).map((c) => c.params ?? {})];
        for (const p of params) {
          for (const [key, value] of Object.entries(p)) {
            expect(TECH_PARAM_KEYS.has(key), key).toBe(true);
            if (typeof value === "number") expect(positive(value), `${key}: ${value}`).toBe(true);
          }
        }
      });
    });
  }
});

/* ---------- T2: SQL technologies (design table) ---------- */

describe("SQL technologies (T2)", () => {
  it("PostgreSQL db.r6g.xlarge: 40,000 reads at 0.10 ms, 5,000 writes at 1.5 ms, $0.45/h", () => {
    const pg = getTechnology("sql-db", "postgres");
    const xl = pg && classOf(pg, "db.r6g.xlarge");
    expect(xl?.perInstanceHour).toBe(0.45);
    expect(techPreset("sql-db", "postgres", "db.r6g.xlarge")).toMatchObject({
      technology: "postgres",
      instanceClass: "db.r6g.xlarge",
      capacityPerInstance: 40_000,
      serviceTimeMs: 0.1,
      writeCapacityRps: 5_000,
      writeServiceTimeMs: 1.5,
      failoverSec: 90,
    });
  });

  it("the three engines on both SQL types, db.r6g.large…4xlarge, default class xlarge", () => {
    for (const type of ["sql-db", "read-replica"]) {
      for (const id of ["postgres", "mysql", "aurora-postgres"]) {
        const tech = getTechnology(type, id);
        expect(tech?.classes?.map((c) => c.id)).toEqual([
          "db.r6g.large",
          "db.r6g.xlarge",
          "db.r6g.2xlarge",
          "db.r6g.4xlarge",
        ]);
        expect(tech?.defaultClass).toBe("db.r6g.xlarge");
        expect(tech?.mechanics?.kind).toBe("sql-primary");
      }
    }
  });

  it("failover 90/90/30 s and replica lag 100/100/20 ms", () => {
    const of = (id: string) => getTechnology("sql-db", id)?.params;
    expect(of("postgres")).toMatchObject({ failoverSec: 90, replicationLagMs: 100 });
    expect(of("mysql")).toMatchObject({ failoverSec: 90, replicationLagMs: 100 });
    expect(of("aurora-postgres")).toMatchObject({ failoverSec: 30, replicationLagMs: 20 });
  });

  it("MySQL and Aurora anchors: 4xlarge 190k/8k at $1.718 and 145k/20k at $2.699", () => {
    expect(techPreset("sql-db", "mysql", "db.r6g.4xlarge")).toMatchObject({
      capacityPerInstance: 190_000,
      serviceTimeMs: 0.08,
      writeCapacityRps: 8_000,
      writeServiceTimeMs: 2,
    });
    expect(techPreset("sql-db", "aurora-postgres", "db.r6g.4xlarge")).toMatchObject({
      capacityPerInstance: 145_000,
      serviceTimeMs: 0.11,
      writeCapacityRps: 20_000,
      writeServiceTimeMs: 3,
    });
    const price = (id: string) =>
      classOf(getTechnology("sql-db", id)!, "db.r6g.4xlarge")?.perInstanceHour;
    expect(price("mysql")).toBe(1.718);
    expect(price("aurora-postgres")).toBe(2.699);
  });
});

/* ---------- T3: NoSQL technologies (design table) ---------- */

describe("NoSQL technologies (T3)", () => {
  it("offers DynamoDB, Cassandra, ScyllaDB and MongoDB, in that order", () => {
    expect(technologiesOf("nosql-db").map((t) => t.id)).toEqual([
      "dynamodb",
      "cassandra",
      "scylladb",
      "mongodb",
    ]);
  });

  it("Cassandra i4i.xlarge: 16,000 replica ops/s at 1.5 ms, $0.343/h, RF 3 QUORUM", () => {
    const cassandra = getTechnology("nosql-db", "cassandra")!;
    expect(classOf(cassandra, "i4i.xlarge")?.perInstanceHour).toBe(0.343);
    expect(techPreset("nosql-db", "cassandra")).toEqual({
      technology: "cassandra",
      instanceClass: "i4i.xlarge",
      capacityPerInstance: 16_000,
      serviceTimeMs: 1.5,
      replicationFactor: 3,
      consistencyLevel: "quorum",
    });
    expect(cassandra.mechanics?.kind).toBe("replica-quorum");
  });

  it("ScyllaDB i4i.4xlarge: 232,000 replica ops/s at 0.7 ms on the same i4i prices", () => {
    const scylla = getTechnology("nosql-db", "scylladb")!;
    const xl4 = classOf(scylla, "i4i.4xlarge");
    expect(xl4?.capacityPerInstance).toBe(232_000);
    expect(xl4?.serviceTimeMs).toBe(0.7);
    expect(xl4?.perInstanceHour).toBe(1.373);
  });

  it("DynamoDB: managed, partition 3,000 RCU / 1,000 WCU, 0.5/1 RRU per read, table quota 40,000", () => {
    const ddb = getTechnology("nosql-db", "dynamodb")!;
    expect(ddb.billing).toBe("managed");
    expect(ddb.classes).toBeUndefined();
    expect(ddb.mechanics?.perPartition).toEqual({ readUnits: 3_000, writeUnits: 1_000 });
    expect(ddb.mechanics?.readUnitCost).toEqual({ eventual: 0.5, strong: 1 });
    expect(ddb.mechanics?.quota).toEqual({ readRps: 40_000, writeRps: 40_000 });
    expect(ddb.managed).toMatchObject({ perMillionReads: 0.125, perMillionWrites: 0.625 });
    expect(techPreset("nosql-db", "dynamodb")).toMatchObject({
      capacityPerInstance: 40_000,
      serviceTimeMs: 3,
    });
  });

  it("MongoDB: r6g classes (xlarge 14,000 ops/s, $0.2016/h), 1 shard, primary reads, majority writes +2 ms", () => {
    const mongo = getTechnology("nosql-db", "mongodb")!;
    expect(techPreset("nosql-db", "mongodb")).toEqual({
      technology: "mongodb",
      instanceClass: "r6g.xlarge",
      capacityPerInstance: 14_000,
      serviceTimeMs: 0.7,
      shards: 1,
      readPreference: "primary",
      writeConcern: "majority",
    });
    expect(classOf(mongo)?.perInstanceHour).toBe(0.2016);
    expect(mongo.mechanics).toEqual({ kind: "mongo", replicationRttMs: 2 });
  });
});

/* ---------- T4: load balancer and API gateway technologies (design table) ---------- */

describe("load balancer and API gateway technologies (T4)", () => {
  it("LB: NLB (L4), ALB, HAProxy, Envoy (L7), in that order", () => {
    const lbs = technologiesOf("load-balancer");
    expect(lbs.map((t) => t.id)).toEqual(["aws-nlb", "aws-alb", "haproxy", "envoy"]);
    expect(lbs.map((t) => t.layer)).toEqual(["L4", "L7", "L7", "L7"]);
    expect(technologiesOf("api-gateway").map((t) => t.id)).toEqual(["aws-api-gateway", "kong"]);
  });

  it("NLB only flow-hashes: options.lbAlgorithm = ['hash'] and its preset sets hash", () => {
    const nlb = getTechnology("load-balancer", "aws-nlb")!;
    expect(nlb.options?.lbAlgorithm).toEqual(["hash"]);
    expect(techPreset("load-balancer", "aws-nlb")).toEqual({
      technology: "aws-nlb",
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 0.1,
      lbAlgorithm: "hash",
    });
  });

  it("ALB: round robin, least connections or weighted; 1,000,000 req/s at 2 ms, $0.0225/h + $0.033/M", () => {
    const alb = getTechnology("load-balancer", "aws-alb")!;
    expect(alb.options?.lbAlgorithm).toEqual(["round-robin", "least-connections", "weighted"]);
    expect(alb.managed).toMatchObject({
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 2,
      perHour: 0.0225,
      perMillionReads: 0.033,
    });
  });

  it("AWS API Gateway: account quota 10,000 req/s with a 5,000 burst, 30 s timeout, $1.00/M", () => {
    const apigw = getTechnology("api-gateway", "aws-api-gateway")!;
    expect(apigw.mechanics).toEqual({ kind: "quota", quota: { sharedRps: 10_000, burst: 5_000 } });
    expect(apigw.managed).toMatchObject({ perMillionReads: 1, perMillionWrites: 1 });
    expect(techPreset("api-gateway", "aws-api-gateway")).toMatchObject({
      capacityPerInstance: 10_000,
      serviceTimeMs: 8,
      timeoutMs: 30_000,
    });
  });

  it("HAProxy, Envoy and Kong on c6g: 4xlarge 140k/140k/144k req/s at $0.544/h", () => {
    for (const [type, id, rps] of [
      ["load-balancer", "haproxy", 140_000],
      ["load-balancer", "envoy", 140_000],
      ["api-gateway", "kong", 144_000],
    ] as const) {
      const cls = classOf(getTechnology(type, id)!, "c6g.4xlarge");
      expect(cls?.capacityPerInstance, id).toBe(rps);
      expect(cls?.perInstanceHour, id).toBe(0.544);
    }
    expect(
      classOf(getTechnology("load-balancer", "haproxy")!, "c6g.large")?.capacityPerInstance,
    ).toBe(20_000);
  });
});

/* ---------- T5: cache technologies (design table) ---------- */

describe("cache technologies (T5)", () => {
  it("offers Redis then Memcached, on cache.r6g.large…4xlarge, default xlarge", () => {
    expect(technologiesOf("cache").map((t) => t.id)).toEqual(["redis", "memcached"]);
    for (const tech of technologiesOf("cache")) {
      expect(tech.classes?.map((c) => c.id)).toEqual([
        "cache.r6g.large",
        "cache.r6g.xlarge",
        "cache.r6g.2xlarge",
        "cache.r6g.4xlarge",
      ]);
      expect(tech.defaultClass).toBe("cache.r6g.xlarge");
    }
  });

  it("85k/142k/284k/568k ops/s at 0.4 ms, $0.206…$1.642/h, the same for both engines", () => {
    for (const id of ["redis", "memcached"]) {
      const classes = getTechnology("cache", id)?.classes ?? [];
      expect(classes.map((c) => c.capacityPerInstance)).toEqual([
        85_000, 142_000, 284_000, 568_000,
      ]);
      expect(classes.map((c) => c.perInstanceHour)).toEqual([0.206, 0.411, 0.821, 1.642]);
      expect(classes.every((c) => c.serviceTimeMs === 0.4)).toBe(true);
    }
    expect(techPreset("cache", "redis")).toEqual({
      technology: "redis",
      instanceClass: "cache.r6g.xlarge",
      capacityPerInstance: 142_000,
      serviceTimeMs: 0.4,
    });
  });
});

/* ---------- T6: message queue and pub/sub technologies (design table) ---------- */

describe("message queue and pub/sub technologies (T6)", () => {
  it("Message Queue: Kafka, RabbitMQ, SQS Standard, SQS FIFO; Pub/Sub: SNS, Kafka", () => {
    expect(technologiesOf("message-queue").map((t) => t.id)).toEqual([
      "kafka",
      "rabbitmq",
      "sqs-standard",
      "sqs-fifo",
    ]);
    expect(technologiesOf("pub-sub").map((t) => t.id)).toEqual(["sns", "kafka"]);
  });

  it("SQS FIFO quota 3,000 msgs/s at $1.50/M; SNS quota 30,000 publishes/s at $0.50/M", () => {
    const fifo = getTechnology("message-queue", "sqs-fifo")!;
    expect(fifo.mechanics).toEqual({ kind: "quota", quota: { sharedRps: 3_000 } });
    expect(fifo.managed).toMatchObject({ capacityPerInstance: 3_000, perMillionWrites: 1.5 });
    const sns = getTechnology("pub-sub", "sns")!;
    expect(sns.mechanics).toEqual({ kind: "quota", quota: { sharedRps: 30_000 } });
    expect(sns.managed).toMatchObject({ capacityPerInstance: 30_000, perMillionWrites: 0.5 });
  });

  it("SQS Standard: no quota mechanic, 1,000,000 msgs/s at 20 ms, $1.20 per million messages", () => {
    const sqs = getTechnology("message-queue", "sqs-standard")!;
    expect(sqs.mechanics).toBeUndefined();
    expect(sqs.managed).toMatchObject({
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 20,
      perMillionReads: 1.2,
      perMillionWrites: 1.2,
    });
  });

  it("Kafka (MSK) on both types: kafka.m7g.xlarge 41,700 msgs/s per broker at 5 ms, 6 partitions", () => {
    for (const type of ["message-queue", "pub-sub"]) {
      expect(techPreset(type, "kafka")).toEqual({
        technology: "kafka",
        instanceClass: "kafka.m7g.xlarge",
        capacityPerInstance: 41_700,
        serviceTimeMs: 5,
        partitions: 6,
      });
    }
    const kafka = getTechnology("message-queue", "kafka")!;
    expect(kafka.mechanics?.kind).toBe("kafka");
    expect(kafka.classes?.map((c) => c.perInstanceHour)).toEqual([0.204, 0.408, 0.816, 1.632]);
  });

  it("RabbitMQ (Amazon MQ): per-broker 19.5k…185k msgs/s, per-queue ceiling 15k then 20k", () => {
    const rabbit = getTechnology("message-queue", "rabbitmq")!;
    expect(rabbit.mechanics?.kind).toBe("quota");
    expect(rabbit.classes?.map((c) => c.capacityPerInstance)).toEqual([
      19_500, 39_000, 78_000, 185_000,
    ]);
    expect(rabbit.classes?.map((c) => c.quota?.sharedRps)).toEqual([
      15_000, 20_000, 20_000, 20_000,
    ]);
    expect(classOf(rabbit)?.id).toBe("mq.m7g.xlarge");
  });
});

/* ---------- T7: search and object storage, and the whole catalog ---------- */

describe("search and object storage technologies (T7)", () => {
  it("OpenSearch: r6g.xlarge.search 1,000 shard queries/s at 3 ms, $0.335/h, 5 shards + 1 replica, fan-out", () => {
    const os = getTechnology("search", "opensearch")!;
    expect(techPreset("search", "opensearch")).toEqual({
      technology: "opensearch",
      instanceClass: "r6g.xlarge.search",
      capacityPerInstance: 1_000,
      serviceTimeMs: 3,
      shards: 5,
      replicas: 1,
    });
    expect(classOf(os)?.perInstanceHour).toBe(0.335);
    expect(os.classes?.map((c) => c.capacityPerInstance)).toEqual([500, 1_000, 2_000, 4_000]);
    expect(os.mechanics?.kind).toBe("search-fanout");
    expect(os.mechanics?.indexCostPerDoc).toBeGreaterThan(0);
  });

  it("S3 Standard: 5,500 GET and 3,500 PUT per prefix, 30 ms, $0.40/M GET and $5.00/M PUT", () => {
    const s3 = getTechnology("object-storage", "s3")!;
    expect(s3.mechanics).toEqual({
      kind: "quota",
      quota: { readRps: 5_500, writeRps: 3_500, perPrefix: true },
    });
    expect(s3.managed).toMatchObject({
      capacityPerInstance: 5_500,
      serviceTimeMs: 30,
      perMillionReads: 0.4,
      perMillionWrites: 5,
    });
  });
});

/** The technologies of each central type, as the spec's premises list them. */
const SPEC_OPTIONS: Record<(typeof CENTRAL_TYPES)[number], string[]> = {
  "load-balancer": ["aws-nlb", "aws-alb", "haproxy", "envoy"],
  "api-gateway": ["aws-api-gateway", "kong"],
  "sql-db": ["postgres", "mysql", "aurora-postgres"],
  "read-replica": ["postgres", "mysql", "aurora-postgres"],
  "nosql-db": ["dynamodb", "cassandra", "scylladb", "mongodb"],
  cache: ["redis", "memcached"],
  "message-queue": ["kafka", "rabbitmq", "sqs-standard", "sqs-fifo"],
  "pub-sub": ["sns", "kafka"],
  search: ["opensearch"],
  "object-storage": ["s3"],
};

/** The technology a new node of each type starts with (spec premises). */
const SPEC_DEFAULTS: Record<(typeof CENTRAL_TYPES)[number], string> = {
  "load-balancer": "aws-alb",
  "api-gateway": "aws-api-gateway",
  "sql-db": "postgres",
  "read-replica": "postgres",
  "nosql-db": "dynamodb",
  cache: "redis",
  "message-queue": "kafka",
  "pub-sub": "sns",
  search: "opensearch",
  "object-storage": "s3",
};

describe("the whole catalog (T7)", () => {
  it("the 10 central types offer the spec's 26 options (Read Replica counted apart)", () => {
    expect([...CENTRAL_TYPES].sort()).toEqual(Object.keys(SPEC_OPTIONS).sort());
    for (const type of CENTRAL_TYPES) {
      expect(
        technologiesOf(type).map((t) => t.id),
        type,
      ).toEqual(SPEC_OPTIONS[type]);
    }
    expect(CENTRAL_TYPES.reduce((n, type) => n + technologiesOf(type).length, 0)).toBe(26);
  });

  it("every central type has its default technology; no technology outside them", () => {
    for (const type of CENTRAL_TYPES) {
      expect(defaultTechnologyOf(type), type).toBe(SPEC_DEFAULTS[type]);
    }
    for (const tech of TECHNOLOGIES) {
      for (const type of tech.componentIds) {
        expect(CENTRAL_TYPES as readonly string[], tech.id).toContain(type);
      }
    }
  });
});

/* ---------- T8: PARAM keys and the technology / instance class specs (TEC-01, TEC-14) ---------- */

describe("technology and instance class param specs (T8)", () => {
  const values = (spec: ParamSpec) => (spec.options ?? []).map((o) => o.value);
  const labels = (spec: ParamSpec) => (spec.options ?? []).map((o) => o.label);

  it("PARAM keeps every key it had and adds the six technology keys, each equal to its name", () => {
    const before = [
      "capacityPerInstance",
      "serviceTimeMs",
      "instances",
      "hitRate",
      "timeoutMs",
      "maxRetries",
      "maxQueue",
      "consumers",
      "limitRps",
      "overLimitAction",
      "lbAlgorithm",
      "availability",
      "readRatio",
      "baseRps",
      "loadPattern",
      "serviceTimeP99Ms",
      "retryBackoffMs",
      "retryJitter",
      "autoscale",
      "autoscaleMin",
      "autoscaleMax",
      "targetUtilization",
      "scaleCooldownSec",
      "provisioningDelaySec",
      "lookupShare",
      "ttlSec",
      "healthCheckIntervalSec",
      "unhealthyThreshold",
      "healthyThreshold",
      "rateLimitEnabled",
      "rateLimitAlgorithm",
      "burst",
      "memoryGb",
      "evictionPolicy",
      "writeStrategy",
      "stampedeProtection",
      "writeCapacityRps",
      "writeServiceTimeMs",
      "connectionPool",
      "shards",
      "failoverSec",
      "replicationLagMs",
      "partitions",
      "replicationFactor",
      "consistencyLevel",
      "hotPartitionShare",
      "replicas",
      "retentionHours",
      "deliverySemantics",
      "maxDeliveryAttempts",
      "errorThreshold",
      "openDurationSec",
      "halfOpenProbes",
      "minimumCalls",
      "blockRate",
    ];
    const added = [
      "technology",
      "instanceClass",
      "prefixes",
      "readPreference",
      "writeConcern",
      "readConsistency",
    ];
    const keys = PARAM as Record<string, string>;
    for (const key of [...before, ...added]) expect(keys[key], key).toBe(key);
    expect(Object.keys(PARAM).sort()).toEqual([...before, ...added].sort());
  });

  it("technologySpec('nosql-db'): enum of generic + the 4 technologies, default generic", () => {
    const spec = technologySpec("nosql-db");
    expect(spec.key).toBe("technology");
    expect(spec.kind).toBe("enum");
    expect(spec.default).toBe("generic");
    expect(values(spec)).toEqual(["generic", "dynamodb", "cassandra", "scylladb", "mongodb"]);
    expect(labels(spec)[0]).toBe("Generic — custom numbers");
  });

  it("option labels carry the layer or mode in parentheses (TEC-06)", () => {
    expect(labels(technologySpec("load-balancer"))).toEqual([
      "Generic — custom numbers",
      "AWS NLB (L4)",
      "AWS ALB (L7)",
      "HAProxy (L7)",
      "Envoy (L7)",
    ]);
    expect(labels(technologySpec("nosql-db"))).toContain("DynamoDB (on-demand)");
  });

  it("every central type's spec offers generic plus exactly its technologies", () => {
    for (const id of CENTRAL_TYPES) {
      expect(values(technologySpec(id)), id).toEqual([
        "generic",
        ...technologiesOf(id).map((t) => t.id),
      ]);
    }
  });

  it("instanceClassSpec('sql-db') offers the db.r6g classes once each, default db.r6g.xlarge", () => {
    const spec = instanceClassSpec("sql-db");
    expect(spec.key).toBe("instanceClass");
    expect(spec.kind).toBe("enum");
    expect(values(spec)).toEqual([
      "db.r6g.large",
      "db.r6g.xlarge",
      "db.r6g.2xlarge",
      "db.r6g.4xlarge",
    ]);
    expect(spec.default).toBe("db.r6g.xlarge");
  });

  it("optionsFor gives only the classes of the node's technology (Aurora on sql-db, Cassandra vs MongoDB on nosql-db)", () => {
    const aurora = getTechnology("sql-db", "aurora-postgres")!;
    expect(instanceClassSpec("sql-db").optionsFor!({ technology: "aurora-postgres" })).toEqual(
      aurora.classes!.map((c) => c.id),
    );
    const nosql = instanceClassSpec("nosql-db");
    expect(nosql.optionsFor!({ technology: "cassandra" })).toEqual([
      "i4i.large",
      "i4i.xlarge",
      "i4i.2xlarge",
      "i4i.4xlarge",
    ]);
    expect(nosql.optionsFor!({ technology: "mongodb" })).toEqual([
      "r6g.large",
      "r6g.xlarge",
      "r6g.2xlarge",
      "r6g.4xlarge",
    ]);
    expect(nosql.optionsFor!({ technology: "dynamodb" })).toEqual([]);
  });

  it("the class select is visible only for a technology billed per instance (TEC-14)", () => {
    const sql = instanceClassSpec("sql-db");
    expect(sql.visibleIf!({ technology: "postgres" })).toBe(true);
    expect(sql.visibleIf!({ technology: "generic" })).toBe(false);
    const nosql = instanceClassSpec("nosql-db");
    expect(nosql.visibleIf!({ technology: "cassandra" })).toBe(true);
    expect(nosql.visibleIf!({ technology: "dynamodb" })).toBe(false);
    expect(nosql.visibleIf!({ technology: "generic" })).toBe(false);
    const lb = instanceClassSpec("load-balancer");
    expect(lb.visibleIf!({ technology: "aws-alb" })).toBe(false);
    expect(lb.visibleIf!({ technology: "haproxy" })).toBe(true);
  });
});

/* ---------- T10: technology params in the 10 central schemas (TEC-01, TEC-33, TEC-51) ---------- */

describe("technology-dependent visibility in the central schemas (T10)", () => {
  /** Is `key` shown on a node of `id` with these params? */
  function shown(id: string, key: string, params: Params): boolean {
    const spec = getSchema(id).params.find((p) => p.key === key);
    expect(spec, `${id}.${key}`).toBeDefined();
    return spec!.visibleIf ? spec!.visibleIf({ ...defaultParams(id), ...params }) : true;
  }
  const on = (technology: string) => ({ technology });

  it("consistencyLevel and replicationFactor: Cassandra and ScyllaDB only (generic keeps them)", () => {
    for (const key of ["consistencyLevel", "replicationFactor"]) {
      expect(shown("nosql-db", key, on("cassandra")), key).toBe(true);
      expect(shown("nosql-db", key, on("scylladb")), key).toBe(true);
      expect(shown("nosql-db", key, on("dynamodb")), key).toBe(false);
      expect(shown("nosql-db", key, on("mongodb")), key).toBe(false);
      expect(shown("nosql-db", key, on("generic")), key).toBe(true);
    }
  });

  it("readConsistency: DynamoDB only", () => {
    expect(shown("nosql-db", "readConsistency", on("dynamodb"))).toBe(true);
    for (const t of ["cassandra", "scylladb", "mongodb", "generic"]) {
      expect(shown("nosql-db", "readConsistency", on(t)), t).toBe(false);
    }
  });

  it("shards, readPreference and writeConcern on nosql-db: MongoDB only", () => {
    for (const key of ["shards", "readPreference", "writeConcern"]) {
      expect(shown("nosql-db", key, on("mongodb")), key).toBe(true);
      for (const t of ["dynamodb", "cassandra", "scylladb", "generic"]) {
        expect(shown("nosql-db", key, on(t)), `${key} ${t}`).toBe(false);
      }
    }
  });

  it("prefixes: S3 only", () => {
    expect(shown("object-storage", "prefixes", on("s3"))).toBe(true);
    expect(shown("object-storage", "prefixes", on("generic"))).toBe(false);
  });

  it("instances and capacity per instance hidden for the managed services, shown for generic and instance-billed ones (TEC-51)", () => {
    const managed: [string, string][] = [
      ["nosql-db", "dynamodb"],
      ["object-storage", "s3"],
      ["message-queue", "sqs-standard"],
      ["message-queue", "sqs-fifo"],
      ["pub-sub", "sns"],
      ["api-gateway", "aws-api-gateway"],
      ["load-balancer", "aws-nlb"],
      ["load-balancer", "aws-alb"],
    ];
    for (const [id, tech] of managed) {
      expect(shown(id, "instances", on(tech)), `${id} ${tech}`).toBe(false);
      expect(shown(id, "capacityPerInstance", on(tech)), `${id} ${tech}`).toBe(false);
    }
    for (const id of CENTRAL_TYPES) {
      expect(shown(id, "instances", on("generic")), id).toBe(true);
      expect(shown(id, "capacityPerInstance", on("generic")), id).toBe(true);
    }
    expect(shown("sql-db", "instances", on("postgres"))).toBe(true);
    expect(shown("nosql-db", "instances", on("cassandra"))).toBe(true);
  });

  it("instanceClass is in every central schema with classes, not in object storage (S3 only)", () => {
    for (const id of CENTRAL_TYPES) {
      const has = getSchema(id).params.some((p) => p.key === "instanceClass");
      expect(has, id).toBe(id !== "object-storage");
    }
  });

  it("the LB algorithm enum offers only what the technology supports (NLB: hash)", () => {
    const algo = getSchema("load-balancer").params.find((p) => p.key === "lbAlgorithm")!;
    expect(algo.optionsFor!(on("aws-nlb"))).toEqual(["hash"]);
    expect(algo.optionsFor!(on("aws-alb"))).toEqual([
      "round-robin",
      "least-connections",
      "weighted",
    ]);
    expect(algo.optionsFor!(on("haproxy"))).toEqual([
      "round-robin",
      "least-connections",
      "weighted",
      "hash",
    ]);
    expect(algo.optionsFor!(on("generic"))).toEqual([
      "round-robin",
      "least-connections",
      "weighted",
      "hash",
    ]);
  });
});

/* ---------- T9: sanitizing params by technology (TEC-08, TEC-16, TEC-39, TEC-48) ---------- */

describe("sanitizeParams and normalizeTechParams by technology (T9)", () => {
  /** The per-key validation sanitizeParams did before technologies: valid value, else the schema default. */
  function perKey(id: string, raw: Record<string, unknown>): Params {
    const out: Params = {};
    for (const spec of getSchema(id).params) {
      out[spec.key] = isValidParam(spec, raw[spec.key]) ? (raw[spec.key] as never) : spec.default;
    }
    return out;
  }

  it("an unknown technology becomes generic (TEC-08), with the generic defaults", () => {
    const params = sanitizeParams("nosql-db", { technology: "oracle", shards: 5000 });
    expect(params.technology).toBe("generic");
    expect(params).toEqual(defaultParams("nosql-db"));
  });

  it("a class of another technology becomes the technology's default class (TEC-16)", () => {
    const pg = sanitizeParams("sql-db", {
      technology: "postgres",
      instanceClass: "cache.r6g.large",
    });
    expect(pg.instanceClass).toBe("db.r6g.xlarge");
    // A class valid for the type but not for the technology (MongoDB's on Cassandra).
    const cass = sanitizeParams("nosql-db", {
      technology: "cassandra",
      instanceClass: "r6g.2xlarge",
    });
    expect(cass.instanceClass).toBe("i4i.xlarge");
    // A class of the technology itself is kept.
    const aurora = sanitizeParams("sql-db", {
      technology: "aurora-postgres",
      instanceClass: "db.r6g.4xlarge",
    });
    expect(aurora.instanceClass).toBe("db.r6g.4xlarge");
  });

  it("an NLB with round robin resolves to hash (TEC-39); an ALB with hash to its round robin", () => {
    expect(
      sanitizeParams("load-balancer", { technology: "aws-nlb", lbAlgorithm: "round-robin" })
        .lbAlgorithm,
    ).toBe("hash");
    expect(
      sanitizeParams("load-balancer", { technology: "aws-alb", lbAlgorithm: "hash" }).lbAlgorithm,
    ).toBe("round-robin");
    expect(
      sanitizeParams("load-balancer", { technology: "aws-alb", lbAlgorithm: "weighted" })
        .lbAlgorithm,
    ).toBe("weighted");
    expect(
      sanitizeParams("load-balancer", { technology: "haproxy", lbAlgorithm: "hash" }).lbAlgorithm,
    ).toBe("hash");
  });

  it("a mechanic param out of range takes the technology's value, not the schema default (TEC-48)", () => {
    // MongoDB: shards 5000 > 1024 → MongoDB's 1.
    expect(sanitizeParams("nosql-db", { technology: "mongodb", shards: 5000 }).shards).toBe(1);
    // OpenSearch sets 5 shards; the schema default is 1.
    expect(sanitizeParams("search", { technology: "opensearch", shards: 5000 }).shards).toBe(5);
    expect(sanitizeParams("search", { technology: "generic", shards: 5000 }).shards).toBe(1);
    // Cassandra RF 9 > 7 → its 3; S3 prefixes 0 → its 1.
    expect(
      sanitizeParams("nosql-db", { technology: "cassandra", replicationFactor: 9 })
        .replicationFactor,
    ).toBe(3);
    expect(sanitizeParams("object-storage", { technology: "s3", prefixes: 0 }).prefixes).toBe(1);
    // A class-level value too: a missing write capacity is the class's.
    expect(
      sanitizeParams("sql-db", { technology: "postgres", instanceClass: "db.r6g.2xlarge" })
        .writeCapacityRps,
    ).toBe(8_000);
  });

  it("valid technology values are kept as given (a user's edit survives)", () => {
    const params = sanitizeParams("nosql-db", {
      ...techPreset("nosql-db", "cassandra"),
      capacityPerInstance: 1234,
      consistencyLevel: "all",
    });
    expect(params.capacityPerInstance).toBe(1234);
    expect(params.consistencyLevel).toBe("all");
    expect(params.technology).toBe("cassandra");
  });

  it("a read replica keeps only its own keys from a SQL preset (no writeCapacityRps)", () => {
    const params = sanitizeParams("read-replica", techPreset("read-replica", "postgres"));
    expect(params).not.toHaveProperty("writeCapacityRps");
    expect(params).not.toHaveProperty("failoverSec");
    expect(params.replicationLagMs).toBe(100);
    expect(params.capacityPerInstance).toBe(40_000);
  });

  it("a generic node sanitizes exactly as the per-key validation did, for every schema", () => {
    const raws: Record<string, unknown>[] = [
      {},
      { instances: 3, shards: 5000, lbAlgorithm: "hash", instanceClass: "nope", bogus: 1 },
      {
        technology: "generic",
        replicationFactor: 9,
        consistencyLevel: "all",
        capacityPerInstance: -1,
      },
    ];
    for (const id of SYSTEM_COMPONENTS.map((c) => c.id)) {
      for (const raw of raws) expect(sanitizeParams(id, raw), id).toEqual(perKey(id, raw));
    }
  });

  it("normalizeTechParams leaves generic and unknown technologies untouched", () => {
    const params = { technology: "generic", lbAlgorithm: "nope" };
    expect(normalizeTechParams("load-balancer", params)).toEqual(params);
    expect(normalizeTechParams("cdn", { hitRate: 2 })).toEqual({ hitRate: 2 });
  });
});
