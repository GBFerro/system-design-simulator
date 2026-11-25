import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import {
  ISO_ORIGIN,
  ISO_TINT_VAR,
  boxFaces,
  diamond,
  formatHeadline,
  headlineMetricOf,
  isoArchetypeOf,
  isoTintOf,
  lq,
  pt,
  quad,
  rq,
  tq,
  type IsoArchetype,
  type IsoTint,
} from "@/lib/iso";

// Papel quente slice 2 (specs/2026-11-24-redesign-papel-quente.md, criterion 9): the archetype
// and tint of every catalog id, the headline metric of each archetype, and the pure geometry.

// "archetype: kinds, tint" of the spec's mapping list.
const TINTS: IsoTint[] = ["client", "network", "compute", "cache", "data", "messaging", "infra"];

const MAPPING: Record<IsoArchetype, { ids: string[]; tint: IsoTint }> = {
  client: { ids: ["client"], tint: "client" },
  dns: { ids: ["dns"], tint: "network" },
  cdn: { ids: ["cdn", "origin-shield"], tint: "network" },
  lb: { ids: ["load-balancer", "reverse-proxy"], tint: "network" },
  gateway: { ids: ["api-gateway", "waf", "rate-limiter"], tint: "network" },
  api: {
    ids: ["app-server", "auth-service", "websocket-server", "notification-service", "custom"],
    tint: "compute",
  },
  worker: {
    ids: ["worker-pool", "task-scheduler", "stream-processor"],
    tint: "compute",
  },
  cache: { ids: ["cache"], tint: "cache" },
  db: {
    ids: ["sql-db", "nosql-db", "graph-db", "timeseries-db", "data-warehouse"],
    tint: "data",
  },
  replica: { ids: ["read-replica"], tint: "data" },
  bucket: { ids: ["object-storage", "file-store"], tint: "data" },
  search: { ids: ["search", "vector-db", "geospatial-index"], tint: "data" },
  queue: { ids: ["message-queue", "dlq", "pub-sub"], tint: "messaging" },
  monitor: { ids: ["monitoring"], tint: "infra" },
  control: {
    ids: [
      "service-mesh",
      "autoscaler",
      "service-discovery",
      "distributed-lock",
      "circuit-breaker",
      "coordination-service",
      "id-generator",
      "sharded-counter",
      "config-service",
    ],
    tint: "infra",
  },
};

const ARCHETYPES = Object.keys(MAPPING) as IsoArchetype[];
const ROWS = ARCHETYPES.flatMap((a) =>
  MAPPING[a].ids.map((id) => ({ id, archetype: a, tint: MAPPING[a].tint })),
);

describe("isoArchetypeOf / isoTintOf (criterion 9)", () => {
  it("the table covers exactly the 42 catalog ids", () => {
    expect(SYSTEM_COMPONENTS).toHaveLength(42);
    expect(ROWS.map((r) => r.id).sort()).toEqual(SYSTEM_COMPONENTS.map((c) => c.id).sort());
    expect(ARCHETYPES).toHaveLength(15);
  });

  it.each(ROWS)("$id is a $archetype in the $tint tint", ({ id, archetype, tint }) => {
    const category = SYSTEM_COMPONENTS.find((c) => c.id === id)!.category;
    expect(isoArchetypeOf(id)).toBe(archetype);
    expect(isoTintOf(id, category)).toBe(tint);
  });

  it("the tint of a catalog id does not depend on the category given", () => {
    expect(isoTintOf("client", "storage")).toBe("client");
    expect(isoTintOf("cache", "networking")).toBe("cache");
  });

  it("sends an unknown id to api", () => {
    expect(isoArchetypeOf("custom-1699999999")).toBe("api");
    expect(isoArchetypeOf("nope")).toBe("api");
    expect(isoArchetypeOf("")).toBe("api");
  });

  it("an unknown id takes the tint of its category, compute when that is unknown too", () => {
    expect(isoTintOf("x", "networking")).toBe("network");
    expect(isoTintOf("x", "compute")).toBe("compute");
    expect(isoTintOf("x", "storage")).toBe("data");
    expect(isoTintOf("x", "messaging")).toBe("messaging");
    expect(isoTintOf("x", "infrastructure")).toBe("infra");
    expect(isoTintOf("x", "whatever")).toBe("compute");
    expect(isoTintOf("x", undefined)).toBe("compute");
  });
});

describe("headlineMetricOf", () => {
  const P99: IsoArchetype[] = ["api", "worker", "gateway"];
  const UTIL: IsoArchetype[] = ["cache", "db", "replica", "search", "queue"];
  const RPS: IsoArchetype[] = ["client", "dns", "cdn", "lb", "bucket", "monitor", "control"];

  it("covers all 15 archetypes", () => {
    expect([...P99, ...UTIL, ...RPS].sort()).toEqual([...ARCHETYPES].sort());
  });
  it.each(P99)("%s shows p99", (a) => expect(headlineMetricOf(a)).toBe("p99"));
  it.each(UTIL)("%s shows utilization", (a) => expect(headlineMetricOf(a)).toBe("utilization"));
  it.each(RPS)("%s shows rpsIn", (a) => expect(headlineMetricOf(a)).toBe("rpsIn"));
});

describe("ISO_TINT_VAR: the one tint table (nodes and palette chips)", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)),
    "utf8",
  );

  it.each(TINTS)("%s is its --sf-cat pastel, defined by the stylesheet", (tint) => {
    expect(ISO_TINT_VAR[tint]).toBe(`var(--sf-cat-${tint})`);
    expect(css).toContain(`--sf-cat-${tint}:`);
  });

  it("covers exactly the seven tints", () => {
    expect(Object.keys(ISO_TINT_VAR).sort()).toEqual([...TINTS].sort());
  });
});

describe("formatHeadline", () => {
  const m = { rpsIn: 1234, p99: 12.4, utilization: 0.634 };

  it("rpsIn is the abbreviated rate", () => expect(formatHeadline("rpsIn", m)).toBe("1.2K/s"));
  it("p99 is the latency with its label", () => expect(formatHeadline("p99", m)).toBe("p99 12 ms"));
  it("utilization is a whole percent", () =>
    expect(formatHeadline("utilization", m)).toBe("util 63%"));
});

describe("iso geometry (the mockup's pt)", () => {
  it("the origin is (80, 104)", () => {
    expect(ISO_ORIGIN).toEqual([80, 104]);
  });

  it("pt projects (u, v, z) around an origin", () => {
    expect(pt(ISO_ORIGIN, 0, 0, 0)).toEqual([80, 104]);
    const [x1, y1] = pt(ISO_ORIGIN, 10, 0, 0);
    expect(x1).toBeCloseTo(88.66, 6);
    expect(y1).toBeCloseTo(109, 6);
    const [x2, y2] = pt(ISO_ORIGIN, 0, 10, 5);
    expect(x2).toBeCloseTo(71.34, 6);
    expect(y2).toBeCloseTo(104, 6);
    const [x3, y3] = pt([10, 20], 4, 2, 3);
    expect(x3).toBeCloseTo(10 + 0.866 * 2, 6);
    expect(y3).toBeCloseTo(20 + 3 - 3, 6);
  });

  it("quad formats points with one decimal", () => {
    expect(
      quad([
        [1, 2],
        [3.14159, 4.26],
      ]),
    ).toBe("1.0,2.0 3.1,4.3");
  });

  it("boxFaces builds the slab's three faces", () => {
    expect(boxFaces(ISO_ORIGIN, 37, 37, 8, -8)).toEqual({
      top: "15.9,104.0 80.0,141.0 144.1,104.0 80.0,67.0",
      left: "15.9,112.0 80.0,149.0 80.0,141.0 15.9,104.0",
      right: "80.0,149.0 144.1,112.0 144.1,104.0 80.0,141.0",
    });
  });

  it("diamond is the ground ring around the origin", () => {
    expect(diamond(46, 0)).toBe("0.3,104.0 80.0,150.0 159.7,104.0 80.0,58.0");
  });

  it("lq, rq and tq build the left, right and top quads", () => {
    const o: [number, number] = [80, 104];
    expect(lq(o, 2, 0, 10, 0, 5)).toBe(
      quad([pt(o, 0, 2, 0), pt(o, 10, 2, 0), pt(o, 10, 2, 5), pt(o, 0, 2, 5)]),
    );
    expect(rq(o, 2, 0, 10, 0, 5)).toBe(
      quad([pt(o, 2, 0, 0), pt(o, 2, 10, 0), pt(o, 2, 10, 5), pt(o, 2, 0, 5)]),
    );
    expect(tq(o, 0, 10, 0, 6, 3)).toBe(
      quad([pt(o, 0, 0, 3), pt(o, 10, 0, 3), pt(o, 10, 6, 3), pt(o, 0, 6, 3)]),
    );
    expect(lq(o, 2, 0, 10, 0, 5)).toBe("78.3,105.0 86.9,110.0 86.9,105.0 78.3,100.0");
  });
});
