import { describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { CONCEPT_LIBRARY } from "@/data/conceptLibrary";
import { LEARNING_PATH, PROBLEM_CONCEPTS } from "@/data/learningPath";
import { PROBLEMS } from "@/data/problems";
import { ICON_MAP } from "@/lib/icons";
import {
  defaultParams,
  getSchema,
  isValidParam,
  PARAM,
  resolvedParams,
  routingFor,
  sanitizeParams,
} from "@/domain/components/registry";
import { CATALOG_SCHEMAS } from "@/domain/components/schemas";
import { parseNumberText, parseParamInput } from "@/domain/components/paramInput";
import { CORE_PARAM, type ParamSpec } from "@/domain/components/types";
import { DEFAULT_PRICING, hasOwnPricing, PRICE_TABLE } from "@/domain/components/pricing";

const ids = SYSTEM_COMPONENTS.map((c) => c.id);
const NEW_IDS = ["client", "worker-pool", "waf", "read-replica", "dlq", "autoscaler"];

/** A value of the right type that breaks the spec's bounds, if it has any. */
function outOfRange(spec: ParamSpec): unknown[] {
  switch (spec.kind) {
    case "boolean":
      return ["true", 1, null];
    case "enum":
      return ["not-an-option", 3, true];
    default:
      return [
        ...(spec.min !== undefined ? [spec.min - 1] : []),
        ...(spec.max !== undefined ? [spec.max + 1] : []),
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "12",
      ];
  }
}

describe("catalog (CMP-02)", () => {
  it("has 42 unique components including the 6 new ones", () => {
    expect(ids).toHaveLength(42);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of NEW_IDS) expect(ids).toContain(id);
  });

  it("every component has a registered icon and a Concept Library entry", () => {
    for (const c of SYSTEM_COMPONENTS) {
      expect(ICON_MAP[c.icon], `${c.id} icon ${c.icon}`).toBeDefined();
      if (c.id === "custom") continue; // a blank slate: nothing to teach
      const concept = CONCEPT_LIBRARY[c.id];
      expect(concept, `${c.id} concept`).toBeDefined();
      expect(concept.componentId).toBe(c.id);
      for (const list of [
        concept.whenToUse,
        concept.whenNotToUse,
        concept.keyTradeoffs,
        concept.interviewTips,
        concept.commonPatterns,
        concept.realWorldExamples,
      ]) {
        expect(list.length, c.id).toBeGreaterThan(0);
      }
    }
  });
});

describe("schemas (CMP-01)", () => {
  it("hand-written schemas are unique and all belong to catalog ids", () => {
    const schemaIds = CATALOG_SCHEMAS.map((s) => s.id);
    expect(new Set(schemaIds).size).toBe(schemaIds.length);
    for (const id of schemaIds) expect(ids).toContain(id);
    for (const id of NEW_IDS) expect(schemaIds).toContain(id);
  });

  describe.each(ids)("%s", (id) => {
    const schema = getSchema(id);
    const component = SYSTEM_COMPONENTS.find((c) => c.id === id)!;

    it("keeps the core keys, with defaults from the catalog", () => {
      const keys = schema.params.map((p) => p.key);
      expect(new Set(keys).size, "duplicate keys").toBe(keys.length);
      for (const key of Object.values(CORE_PARAM)) expect(keys).toContain(key);
      const defaults = defaultParams(id);
      expect(defaults[PARAM.capacityPerInstance]).toBe(component.maxQPS);
      expect(defaults[PARAM.serviceTimeMs]).toBe(component.latencyMs);
      expect(defaults[PARAM.instances]).toBe(1);
    });

    it("routing matches the routing map", () => {
      expect(schema.routing).toBe(routingFor(id));
    });

    it("validates its own defaults", () => {
      const defaults = defaultParams(id);
      for (const spec of schema.params) {
        expect(isValidParam(spec, spec.default), `${spec.key} default`).toBe(true);
        expect(spec.label.length).toBeGreaterThan(0);
        if (spec.kind === "enum") expect(spec.options?.length).toBeGreaterThan(0);
        if (spec.kind === "percent") {
          expect(spec.min ?? 0).toBeGreaterThanOrEqual(0);
          expect(spec.max ?? 1).toBeLessThanOrEqual(1);
        }
        expect(() => spec.visibleIf?.(defaults)).not.toThrow();
      }
      expect(sanitizeParams(id, defaults)).toEqual(defaults);
    });

    it("falls back to the default for invalid values and drops unknown keys", () => {
      for (const spec of schema.params) {
        for (const bad of outOfRange(spec)) {
          const params = sanitizeParams(id, { [spec.key]: bad, bogus: 1 });
          expect(params[spec.key], `${spec.key}=${String(bad)}`).toBe(spec.default);
          expect(params).not.toHaveProperty("bogus");
        }
      }
    });
  });

  it("keeps the engine-facing defaults of the shared contract", () => {
    expect(defaultParams("cache")[PARAM.hitRate]).toBe(0.9);
    expect(defaultParams("app-server")[PARAM.timeoutMs]).toBe(1000);
    expect(defaultParams("app-server")[PARAM.maxRetries]).toBe(0);
    expect(defaultParams("message-queue")[PARAM.consumers]).toBe(4);
    expect(defaultParams("rate-limiter")[PARAM.limitRps]).toBe(10_000);
    expect(defaultParams("rate-limiter")[PARAM.overLimitAction]).toBe("reject");
    expect(defaultParams("load-balancer")[PARAM.lbAlgorithm]).toBe("round-robin");
    expect(defaultParams("client")[PARAM.readRatio]).toBe(0.9);
    expect(routingFor("client")).toBe("service");
    expect(routingFor("worker-pool")).toBe("service");
    expect(routingFor("dlq")).toBe("queue");
  });

  it("every schema is priced (Spec 10): each catalog type by its own entry, with assumptions", () => {
    for (const id of ids) {
      expect(hasOwnPricing(id), id).toBe(true);
      const p = getSchema(id).pricing;
      for (const v of [p.perInstanceHour, p.baseMonthly, p.perMillionRequests]) {
        expect(Number.isFinite(v) && v >= 0, id).toBe(true);
      }
      expect(p.assumptions.trim().length, id).toBeGreaterThan(20);
    }
    expect(getSchema("custom-my-thing").pricing).toBe(DEFAULT_PRICING);
    expect(PRICE_TABLE.sources.length).toBeGreaterThan(0);
    for (const s of PRICE_TABLE.sources)
      expect(s.url).toMatch(/^https:\/\/aws\.amazon\.com\/.+\/pricing\//);
  });

  it("unknown ids (user custom components) get the generic schema", () => {
    const keys = getSchema("my-custom-thing").params.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(Object.values(CORE_PARAM)));
  });

  it("resolvedParams validates params and ignores v1 top-level fields", () => {
    const params = resolvedParams({
      componentId: "app-server",
      params: { [PARAM.timeoutMs]: 250, [PARAM.instances]: -1 },
      replicas: 3,
      maxQPS: 777,
    } as { componentId: string; params: unknown });
    expect(params).toEqual({
      ...defaultParams("app-server"),
      [PARAM.timeoutMs]: 250,
    });
  });

  it("visibleIf hides dependent params", () => {
    const retries = getSchema("app-server").params.find((p) => p.key === PARAM.retryBackoffMs)!;
    expect(retries.visibleIf?.(defaultParams("app-server"))).toBe(false);
    expect(retries.visibleIf?.({ ...defaultParams("app-server"), [PARAM.maxRetries]: 2 })).toBe(
      true,
    );
  });
});

describe("param input parsing", () => {
  const percent = getSchema("cache").params.find((p) => p.key === PARAM.hitRate)!;
  const instances = getSchema("app-server").params.find((p) => p.key === PARAM.instances)!;

  it("parses percent, integers and separators", () => {
    expect(parseParamInput(percent, "95")).toEqual({ value: 0.95, rejected: false });
    expect(parseParamInput(percent, "99.9")).toEqual({ value: 0.999, rejected: false });
    expect(parseParamInput(instances, "2.6")).toEqual({ value: 3, rejected: false });
    expect(parseNumberText("1,000")).toBe(1000);
    expect(parseNumberText("0,5")).toBe(0.5);
    expect(parseNumberText("10 000")).toBe(10000);
  });

  it("rejects to the default", () => {
    expect(parseParamInput(percent, "120")).toEqual({ value: 0.9, rejected: true });
    expect(parseParamInput(instances, "0")).toEqual({ value: 1, rejected: true });
    expect(parseParamInput(instances, "")).toEqual({ value: 1, rejected: true });
    expect(parseParamInput(instances, "abc")).toEqual({ value: 1, rejected: true });
  });
});

describe("data cross-references", () => {
  const known = new Set(ids);

  it("reference solutions only use catalog ids, each once, with wired edges", () => {
    for (const problem of PROBLEMS) {
      const used = problem.referenceSolution.nodes.map((n) => n.componentId);
      for (const id of used) {
        expect(known.has(id), `${problem.id}: ${id}`).toBe(true);
        expect(getSchema(id).id).toBe(id);
      }
      expect(new Set(used).size, `${problem.id} reuses a componentId`).toBe(used.length);
      for (const e of problem.referenceSolution.edges) {
        expect(used, `${problem.id} edge ${e.source}`).toContain(e.source);
        expect(used, `${problem.id} edge ${e.target}`).toContain(e.target);
      }
    }
  });

  it("Concept Library keys are catalog ids", () => {
    for (const [key, concept] of Object.entries(CONCEPT_LIBRARY)) {
      expect(known.has(key), key).toBe(true);
      expect(concept.componentId).toBe(key);
    }
  });

  it("learning path covers every problem once, with known ids", () => {
    const problemIds = new Set(PROBLEMS.map((p) => p.id));
    const inPath = LEARNING_PATH.flatMap((t) => t.problemIds);
    expect(new Set(inPath).size).toBe(inPath.length);
    for (const id of inPath) expect(problemIds.has(id), id).toBe(true);
    for (const id of problemIds) expect(inPath, id).toContain(id);
    for (const entry of PROBLEM_CONCEPTS) expect(problemIds.has(entry.problemId)).toBe(true);
  });
});
