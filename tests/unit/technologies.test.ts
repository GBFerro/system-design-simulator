import { describe, expect, it } from "vitest";
import { PARAM } from "@/domain/components/params";
import {
  buildTechIndex,
  classOf,
  getTechnology,
  techPreset,
  TECHNOLOGIES,
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
