import { describe, expect, it } from "vitest";
import { INTERVIEW_DATA } from "@/data/interviewData";
import { PROBLEMS } from "@/data/problems";
import {
  checkApis,
  checkDataModel,
  checkEstimates,
  checkRequirements,
  effectivePeak,
  normalizeEntity,
  normalizePath,
  parseDau,
  processScore,
} from "@/interview/checks";

const url = PROBLEMS.find((p) => p.id === "url-shortener")!;
const urlData = INTERVIEW_DATA.find((d) => d.problemId === "url-shortener")!;

describe("requirements", () => {
  it("counts critical and important ones; nice-to-have don't matter", () => {
    const key = urlData.requirements.filter((r) => r.importance !== "nice-to-have");
    const none = checkRequirements([], urlData);
    expect(none.coverage).toBe(0);
    expect(none.missed).toHaveLength(key.length);
    const all = checkRequirements(
      key.map((r) => r.id),
      urlData,
    );
    expect(all.coverage).toBe(1);
    expect(all.missed).toEqual([]);
    const nice = urlData.requirements
      .filter((r) => r.importance === "nice-to-have")
      .map((r) => r.id);
    expect(checkRequirements(nice, urlData).coverage).toBe(0);
  });
});

describe("estimation", () => {
  it("reads DAU only when the brief states DAU", () => {
    expect(parseDau("100M DAU")).toBe(100e6);
    expect(parseDau("200M+ active users, ~5M DAU")).toBe(5e6);
    expect(parseDau("500M+ DAU, ~8.5B searches/day")).toBe(500e6);
    expect(parseDau("3B MAU")).toBeUndefined();
    expect(parseDau("N/A (infrastructure)")).toBeUndefined();
  });

  it("accepts estimates within 2× either way", () => {
    const r = url.requirements;
    const rows = checkEstimates(
      { dau: 100e6, readsPerSec: r.readsPerSec * 1.9, writesPerSec: r.writesPerSec / 2.5 },
      url,
    );
    const by = Object.fromEntries(rows.map((x) => [x.field, x]));
    expect(by.dau.ok).toBe(true);
    expect(by.readsPerSec.ok).toBe(true);
    expect(by.writesPerSec.ok).toBe(false);
    expect(by.storageGB.ok).toBe(false);
    expect(by.storageGB.yours).toBeUndefined();
  });

  it("the effective peak is the estimate, clamped to ±2× the reference", () => {
    const ref = url.requirements.readsPerSec + url.requirements.writesPerSec;
    expect(effectivePeak({}, url)).toBe(ref);
    expect(effectivePeak({ readsPerSec: ref * 1.5 }, url)).toBe(ref * 1.5);
    expect(effectivePeak({ readsPerSec: 1 }, url)).toBe(ref / 2);
    expect(effectivePeak({ readsPerSec: ref * 10 }, url)).toBe(ref * 2);
  });
});

describe("API design", () => {
  it("normalizes versions, parameters, query strings and case", () => {
    expect(normalizePath("/api/v1/urls/{shortCode}")).toBe("/urls/*");
    expect(normalizePath("/URLS/:code/")).toBe("/urls/*");
    expect(normalizePath("/v2/search?q={query}")).toBe("/search");
  });

  it("matches endpoints and flags the wrong verb", () => {
    const refs = urlData.referenceAPIs;
    const post = refs.find((r) => r.method === "POST")!;
    const get = refs.find((r) => r.method === "GET")!;
    const r = checkApis(
      [
        { method: "POST", path: post.path.replace("/api/v1", "") },
        { method: "PUT", path: get.path },
      ],
      refs,
    );
    expect(r.matched).toContain(post);
    expect(r.wrongVerb.map((w) => w.reference)).toContain(get);
    expect(r.coverage).toBeGreaterThan(0);
    expect(checkApis([], refs).coverage).toBe(0);
  });

  it("counts one endpoint of yours as the wrong verb for at most one reference", () => {
    // GET and DELETE share /api/v1/urls/{shortCode}; a single PUT explains one of them.
    const r = checkApis([{ method: "PUT", path: "/urls/{id}" }], urlData.referenceAPIs);
    expect(r.wrongVerb).toHaveLength(1);
    expect(r.missed).toHaveLength(urlData.referenceAPIs.length - 1);
    // An exact match on that path isn't reused as a wrong verb for the other one.
    const exact = checkApis([{ method: "DELETE", path: "/urls/{id}" }], urlData.referenceAPIs);
    expect(exact.matched.map((m) => m.method)).toEqual(["DELETE"]);
    expect(exact.wrongVerb).toEqual([]);
  });
});

describe("data model", () => {
  it("matches entities by name, then checks the store and the partition key", () => {
    expect(normalizeEntity("Short URLs")).toBe(normalizeEntity("short_url"));
    expect(normalizeEntity("Categories")).toBe("category");
    const ref = urlData.dataModel;
    const first = ref[0];
    const r = checkDataModel(
      [
        {
          name: first.name.toUpperCase(),
          store: first.type,
          partitionKey: first.partitionKey ?? "",
        },
      ],
      ref,
    );
    expect(r.entities[0]).toMatchObject({ storeOk: true, partitionOk: true });
    expect(r.score).toBeGreaterThan(0);
    expect(checkDataModel([], ref).score).toBe(0);
  });
});

describe("process score", () => {
  const requirements = checkRequirements([], urlData);
  const estimates = checkEstimates({}, url);

  it("time: full within target, zero at twice the target", () => {
    const onTime = processScore({
      phaseSeconds: [60, 60],
      targetMinutes: [2, 2],
      estimates,
      requirements,
    });
    expect(onTime.items[0].score).toBe(1);
    const late = processScore({
      phaseSeconds: [240, 240],
      targetMinutes: [2, 2],
      estimates,
      requirements,
    });
    expect(late.items[0].score).toBe(0);
  });

  it("drill reaction: fast is full marks, never acting is zero, no drill is not counted", () => {
    const base = { phaseSeconds: [], targetMinutes: [], estimates, requirements };
    const fast = processScore({ ...base, drillReactions: [10, 20] });
    expect(fast.items.find((i) => i.label === "Drill reaction time")!.score).toBe(1);
    const never = processScore({ ...base, drillReactions: [undefined] });
    expect(never.items.find((i) => i.label === "Drill reaction time")!.score).toBe(0);
    const none = processScore(base);
    expect(none.items.find((i) => i.label === "Drill reaction time")!.score).toBeUndefined();
  });

  it("total is the mean of the applicable items, 0–100", () => {
    const r = processScore({ phaseSeconds: [60], targetMinutes: [2], estimates, requirements });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});

describe("reference data supports the checks", () => {
  it("every problem has key requirements, reference APIs and entities", () => {
    for (const d of INTERVIEW_DATA) {
      expect(
        d.requirements.some((r) => r.importance !== "nice-to-have"),
        d.problemId,
      ).toBe(true);
      expect(d.referenceAPIs.length, d.problemId).toBeGreaterThan(0);
      expect(d.dataModel.length, d.problemId).toBeGreaterThan(0);
    }
  });
});
