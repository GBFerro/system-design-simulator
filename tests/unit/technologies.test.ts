import { describe, expect, it } from "vitest";
import { buildTechIndex, classOf } from "@/domain/components/technologies";
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
