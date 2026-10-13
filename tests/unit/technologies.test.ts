import { describe, expect, it } from "vitest";
import { PARAM } from "@/domain/components/params";
import {
  buildTechIndex,
  classOf,
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
