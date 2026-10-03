import { describe, expect, it } from "vitest";
import { INTERVIEW_DATA } from "@/data/interviewData";
import { LEARNING_PATH, PROBLEM_CONCEPTS } from "@/data/learningPath";
import { PROBLEMS } from "@/data/problems";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { compileGraph } from "@/domain/graph/compile";
import { getFaultType } from "@/engine/faults/catalog";
import { compileFault } from "@/engine/faults/compile";
import { resolveDrillStep } from "@/interview/drill";
import { buildReferenceGraph } from "@/lib/loadReference";
import { analyze } from "@/engine/analyze";
import { estimateCost } from "@/cost/estimate";
import { budgetFraction, latencySloOf, problemSlo } from "@/slo/slo";
import { AVAILABILITY_RANGE } from "@/slo/types";
import type { CustomEdgeData } from "@/store/canvasStore";
import type { Problem } from "@/types/problem";

// Ids, duplicates and learning-path coverage are in catalog.test.ts; this file
// checks the "Data conventions" of CLAUDE.md that are about order and wiring.

/** Problem ids in learning-path order (tiers in order, problems in tier order). */
const pathOrder = LEARNING_PATH.flatMap((tier) => tier.problemIds);

describe("learning path", () => {
  it("prerequisites are concepts taught by a strictly earlier problem", () => {
    const concepts = new Map(PROBLEM_CONCEPTS.map((c) => [c.problemId, c]));
    const taught = new Set<string>();
    for (const problemId of pathOrder) {
      const entry = concepts.get(problemId);
      expect(entry, `${problemId} has no PROBLEM_CONCEPTS entry`).toBeDefined();
      for (const prereq of entry!.prerequisites)
        expect(taught.has(prereq), `${problemId} requires "${prereq}" before it is taught`).toBe(
          true,
        );
      for (const concept of entry!.concepts) taught.add(concept);
    }
  });

  it("every problem has a tier and interview data", () => {
    const withInterviewData = INTERVIEW_DATA.map((d) => d.problemId);
    expect(new Set(withInterviewData).size).toBe(withInterviewData.length);
    for (const { id } of PROBLEMS) {
      expect(pathOrder, `${id} has no learning-path tier`).toContain(id);
      expect(withInterviewData, `${id} has no interviewData entry`).toContain(id);
    }
  });
});

describe("reference solutions", () => {
  it("each has an entry node (in-degree 0 with an outgoing edge)", () => {
    for (const { id, referenceSolution } of PROBLEMS) {
      const { nodes, edges } = referenceSolution;
      const hasEntry = nodes.some(
        (n) =>
          edges.some((e) => e.source === n.componentId && e.target !== n.componentId) &&
          !edges.some((e) => e.target === n.componentId && e.source !== n.componentId),
      );
      expect(hasEntry, `${id}: no entry node, nothing on the request path is reachable`).toBe(true);
    }
  });
});

describe("reference call lists (request-flow)", () => {
  /** A synthetic problem whose reference is App → Redis (reads) and App → SQL DB (look-aside). */
  function lookAsideProblem(missOf: string): Problem {
    return {
      ...PROBLEMS[0],
      referenceSolution: {
        nodes: [
          { componentId: "client", x: 0, y: 0 },
          { componentId: "app-server", x: 200, y: 0 },
          { componentId: "cache", x: 400, y: -100 },
          { componentId: "sql-db", x: 400, y: 100 },
        ],
        edges: [
          { source: "client", target: "app-server" },
          { source: "app-server", target: "cache", rule: { calls: [{ kind: "reads" }] } },
          {
            source: "app-server",
            target: "sql-db",
            rule: { calls: [{ kind: "writes" }, { kind: "after_miss", missOf }] },
          },
        ],
      },
    };
  }

  const dbCalls = (g: ReturnType<typeof buildReferenceGraph>) => {
    const db = g.nodes.find((n) => n.data.componentId === "sql-db")!;
    return (g.edges.find((e) => e.target === db.id)!.data as CustomEdgeData).rule!.calls;
  };

  it("a reference's missOf names a component; the loader points it at that node", () => {
    const g = buildReferenceGraph(lookAsideProblem("cache"));
    const cache = g.nodes.find((n) => n.data.componentId === "cache")!;
    expect(dbCalls(g)).toEqual([
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", missOf: cache.id, callsPerRequest: 1 },
    ]);
    expect(
      (g.edges.find((e) => e.target === cache.id)!.data as CustomEdgeData).rule!.calls,
    ).toEqual([{ kind: "reads", callsPerRequest: 1 }]);
    expect(compileGraph(g.nodes, g.edges).warnings).toEqual([]);
  });

  it("a missOf naming no component of the reference is dropped, and the compiler warns", () => {
    const g = buildReferenceGraph(lookAsideProblem("memcached"));
    expect(dbCalls(g)).toEqual([
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", callsPerRequest: 1 },
    ]);
    expect(compileGraph(g.nodes, g.edges).warnings.join(" ")).toMatch(/names no cache call/);
  });
});

describe("budgets (Spec 10)", () => {
  // Calibrated as the reference's cost at its peak × 1.3, rounded up to two
  // significant figures: the reference fits, and the budget isn't a blank check.
  it.each(PROBLEMS.map((p) => [p.id, p] as const))(
    "%s: the reference costs between 1/1.5 and 1/1.3 of the budget at its peak",
    (_id, p) => {
      const budget = p.requirements.budgetMonthlyUsd;
      expect(budget).toBeGreaterThan(0);
      const { readsPerSec, writesPerSec } = p.requirements;
      const peak = readsPerSec + writesPerSec;
      const { nodes, edges } = buildReferenceGraph(p);
      const steady = analyze(compileGraph(nodes, edges), peak, {
        readRatio: readsPerSec / peak,
        samples: 100,
      });
      const offered = new Map(steady.nodes.map((n) => [n.nodeId, n.offeredRps]));
      const cost = estimateCost(nodes, (id) => offered.get(id) ?? 0).monthly;
      expect(cost * 1.3).toBeLessThanOrEqual(budget!);
      expect(cost * 1.5).toBeGreaterThanOrEqual(budget!);
    },
  );
});

describe("SLOs (Spec 11)", () => {
  it.each(PROBLEMS.map((p) => [p.id, p] as const))(
    "%s: declares its SLO, and its reference holds it at the peak",
    (_id, p) => {
      const { availability, latencyMs } = p.requirements;
      expect(availability).toBeGreaterThanOrEqual(AVAILABILITY_RANGE.min);
      expect(availability).toBeLessThanOrEqual(AVAILABILITY_RANGE.max);
      const slo = problemSlo(p.requirements);
      // Declared values are used as written (no fallback).
      expect(slo.availability).toBe(availability);
      expect(slo.latency.thresholdMs).toBe(latencyMs);

      const { readsPerSec, writesPerSec } = p.requirements;
      const peak = readsPerSec + writesPerSec;
      const { nodes, edges } = buildReferenceGraph(p);
      const steady = analyze(compileGraph(nodes, edges), peak, {
        readRatio: readsPerSec / peak,
        latencySlo: latencySloOf(slo),
      });
      expect(steady.errorRate).toBeLessThanOrEqual(budgetFraction(slo, "availability"));
      const slow = 1 - steady.goodputRps / steady.throughputRps;
      expect(slow).toBeLessThanOrEqual(budgetFraction(slo, "latency"));
    },
  );
});

describe("failure drill scripts (Spec 09)", () => {
  const catalogIds = new Set(SYSTEM_COMPONENTS.map((c) => c.id));

  it("every problem has 2–3 valid faults in the catalog", () => {
    for (const d of INTERVIEW_DATA) {
      expect(d.drill.length, `${d.problemId}: drill length`).toBeGreaterThanOrEqual(2);
      expect(d.drill.length, `${d.problemId}: drill length`).toBeLessThanOrEqual(3);
      for (const step of d.drill) {
        const type = getFaultType(step.fault.type);
        expect(type, `${d.problemId}: unknown fault ${step.fault.type}`).toBeDefined();
        expect(step.window, `${d.problemId}: window`).toBeGreaterThan(0);
        if (step.fault.intensity !== undefined) {
          expect(
            type!.intensity,
            `${d.problemId}: ${step.fault.type} takes no intensity`,
          ).toBeDefined();
          expect(step.fault.intensity).toBeGreaterThanOrEqual(type!.intensity!.min);
          expect(step.fault.intensity).toBeLessThanOrEqual(type!.intensity!.max);
        }
        if (step.followUpId)
          expect(
            d.followUpQuestions.some((q) => q.id === step.followUpId),
            `${d.problemId}: follow-up ${step.followUpId}`,
          ).toBe(true);
        const t = step.fault.target;
        const ids =
          t.kind === "node" ? t.componentIds : t.kind === "edge" ? [...t.from, ...t.to] : [];
        for (const id of ids) expect(catalogIds.has(id), `${d.problemId}: ${id}`).toBe(true);
      }
    }
  });

  it("every scripted fault applies to the problem's reference solution as written", () => {
    for (const p of PROBLEMS) {
      const d = INTERVIEW_DATA.find((x) => x.problemId === p.id)!;
      const { nodes, edges } = buildReferenceGraph(p);
      const graph = compileGraph(nodes, edges);
      d.drill.forEach((step, i) => {
        const r = resolveDrillStep(step, d, graph, null);
        expect(r, `${p.id} step ${i + 1}`).not.toBeNull();
        expect(r!.note, `${p.id} step ${i + 1} fell back`).toBeUndefined();
        const compiled = compileFault(r!.spec, 0, { graph, readRatio: 0.9 });
        expect(compiled.ok, `${p.id} step ${i + 1}: ${compiled.ok ? "" : compiled.error}`).toBe(
          true,
        );
      });
    }
  });
});
