import { describe, expect, it } from "vitest";
import { GENERIC_DRILL_QA, type DrillStep } from "@/data/interviewData";
import { compileGraph } from "@/domain/graph/compile";
import type { TickSnapshot } from "@/engine/types";
import {
  DRILL_RECOVERY_SEC,
  evaluateDrillStep,
  nextDrillAction,
  resolveDrillStep,
  type DrillSlo,
} from "@/interview/drill";
import { comp, wire } from "./engineFixtures";

const data = {
  followUpQuestions: [
    {
      id: "q1",
      question: "What happens if your cache goes down?",
      category: "failure" as const,
      hint: "",
      answer: "Reads fall through to the DB.",
    },
  ],
};

const graph = compileGraph(
  [
    comp("c", "client"),
    comp("lb", "load-balancer"),
    comp("a1", "app-server"),
    comp("a2", "app-server"),
    comp("cache", "cache"),
    comp("db", "nosql-db"),
  ],
  [
    wire("c", "lb"),
    wire("lb", "a1"),
    wire("lb", "a2"),
    wire("a1", "cache"),
    wire("a2", "db"),
    wire("cache", "db", { sourceComponent: "cache" }),
  ],
);

function snapshot(
  t: number,
  over: Partial<TickSnapshot["global"]> = {},
  rps: Record<string, number> = {},
): TickSnapshot {
  return {
    t,
    offeredRps: 1000,
    nodes: Object.fromEntries(
      Object.entries(rps).map(([id, rpsIn]) => [
        id,
        {
          rpsIn,
          rpsOut: rpsIn,
          utilization: 0,
          queueDepth: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          errorRate: 0,
          drops: 0,
          status: "ok" as const,
        },
      ]),
    ),
    edges: {},
    global: {
      throughput: 1000,
      goodput: 1000,
      errorRate: 0,
      p50: 10,
      p95: 20,
      p99: 30,
      availability: 1,
      ...over,
    },
  };
}

describe("resolveDrillStep", () => {
  const step = (fault: DrillStep["fault"], followUpId?: string): DrillStep => ({
    fault,
    window: 60,
    ...(followUpId ? { followUpId } : {}),
  });

  it("targets the busiest node of the scripted type, with the follow-up's question", () => {
    const r = resolveDrillStep(
      step(
        {
          type: "kill-instances",
          target: { kind: "node", componentIds: ["app-server"] },
          intensity: 1,
        },
        "q1",
      ),
      data,
      graph,
      snapshot(0, {}, { a1: 100, a2: 900 }),
    )!;
    expect(r.spec).toEqual({
      type: "kill-instances",
      target: { kind: "node", id: "a2" },
      intensity: 1,
      durationSec: 60,
    });
    expect(r.question).toBe(data.followUpQuestions[0].question);
    expect(r.note).toBeUndefined();
  });

  it("uses the generic question without a follow-up; busiest excludes entries and LBs", () => {
    const r = resolveDrillStep(
      step({ type: "kill-instances", target: { kind: "busiest" }, intensity: 1 }),
      data,
      graph,
      snapshot(0, {}, { c: 5000, lb: 5000, a1: 10, cache: 300 }),
    )!;
    expect(r.spec.target).toEqual({ kind: "node", id: "cache" });
    expect(r.question).toBe(GENERIC_DRILL_QA["kill-instances"].question);
  });

  it("resolves links by component types", () => {
    const r = resolveDrillStep(
      step({ type: "partition", target: { kind: "edge", from: ["app-server"], to: ["nosql-db"] } }),
      data,
      graph,
      null,
    )!;
    expect(r.spec.target).toEqual({ kind: "edge", id: "e-a2-db" });
  });

  it("falls back to killing an instance of the busiest tier when the design lacks the target", () => {
    const r = resolveDrillStep(
      step(
        { type: "db-primary-failure", target: { kind: "node", componentIds: ["sql-db"] } },
        "q1",
      ),
      data,
      graph,
      snapshot(0, {}, { a1: 900 }),
    )!;
    expect(r.spec).toMatchObject({ type: "kill-instances", target: { kind: "node", id: "a1" } });
    expect(r.note).toMatch(/SQL Database/);
    expect(r.question).toBe(GENERIC_DRILL_QA["kill-instances"].question);
  });

  it("returns null for an empty design", () => {
    const empty = compileGraph([], []);
    expect(
      resolveDrillStep(
        step({ type: "traffic-spike", target: { kind: "busiest" } }),
        data,
        empty,
        null,
      ),
    ).toBeNull();
  });
});

describe("evaluateDrillStep", () => {
  const slo: DrillSlo = { p99Ms: 100, errorRate: 0.01 };
  /** 10 Hz from `from` to `to`, with `bad(t)` deciding the breach. */
  const run = (from: number, to: number, bad: (t: number) => Partial<TickSnapshot["global"]>) => {
    const out: TickSnapshot[] = [];
    for (let t = from; t <= to + 1e-9; t = Math.round((t + 0.1) * 10) / 10)
      out.push(snapshot(t, bad(t)));
    return out;
  };

  it("measures breach, candidate action, recovery and budget", () => {
    // Fault 10 → 70; errors 5% from 12 to 40, then OK.
    const history = run(0, 70 + DRILL_RECOVERY_SEC, (t) =>
      t >= 12 && t < 40 ? { errorRate: 0.05 } : {},
    );
    const r = evaluateDrillStep(history, { startT: 10, endT: 70 }, slo, 25);
    expect(r.brokenBefore).toBe(false);
    expect(r.firstBreachT).toBeCloseTo(12, 6);
    expect(r.firstActionT).toBe(25);
    expect(r.recoveredT).toBeCloseTo(40, 6);
    expect(r.badSec).toBeCloseTo(28, 0);
    // 28 s at 5% errors over 80 s at a 1% budget: 1.4/0.8 ≈ 1.75× the budget
    expect(r.budgetUsed).toBeCloseTo((28 * 0.05) / (80 * 0.01), 1);
    expect(r.mitigated).toBe(true);
    expect(r.worstErrorRate).toBe(0.05);
  });

  it("not mitigated while broken at the end of the fault; broken before when the design never held", () => {
    const always = run(0, 100, () => ({ p99: 500 }));
    const r = evaluateDrillStep(always, { startT: 10, endT: 70 }, slo);
    expect(r.brokenBefore).toBe(true);
    expect(r.mitigated).toBe(false);
    expect(r.recoveredT).toBeUndefined();
  });

  it("a fault that never breaks the SLO is mitigated with no breach", () => {
    const r = evaluateDrillStep(
      run(0, 100, () => ({})),
      { startT: 10, endT: 70 },
      slo,
    );
    expect(r.firstBreachT).toBeUndefined();
    expect(r.badSec).toBe(0);
    expect(r.budgetUsed).toBe(0);
    expect(r.mitigated).toBe(true);
  });
});

describe("nextDrillAction (step state machine)", () => {
  it("pending: waits for its time, then injects", () => {
    expect(nextDrillAction({ phase: "pending", at: 15 }, 14.9, undefined)).toEqual({
      kind: "wait",
    });
    expect(nextDrillAction({ phase: "pending", at: 15 }, 15, undefined)).toEqual({
      kind: "inject",
    });
    // The next step's time is unknown until the previous one ends.
    expect(nextDrillAction({ phase: "pending", at: Infinity }, 1e9, undefined).kind).toBe("wait");
  });

  it("active: waits while the fault is on, moves to recovery when it heals", () => {
    const step = { phase: "active" as const, at: 15, endT: 75 };
    expect(nextDrillAction(step, 40, { active: true, endT: 75 })).toEqual({ kind: "wait" });
    expect(nextDrillAction(step, 75.05, { active: false, endT: 75 })).toEqual({
      kind: "healed",
      endT: 75,
    });
    // Healed by hand without a recorded end: now.
    expect(nextDrillAction(step, 50, { active: false })).toEqual({ kind: "healed", endT: 50 });
  });

  it("active: aborts when the run lost the fault (reset)", () => {
    expect(nextDrillAction({ phase: "active", at: 15 }, 20, undefined)).toMatchObject({
      kind: "abort",
    });
  });

  it("recovering: evaluates after the recovery window", () => {
    const step = { phase: "recovering" as const, at: 15, endT: 75 };
    expect(nextDrillAction(step, 75 + DRILL_RECOVERY_SEC - 0.1, undefined).kind).toBe("wait");
    expect(nextDrillAction(step, 75 + DRILL_RECOVERY_SEC, undefined).kind).toBe("evaluate");
  });

  it("injecting, done and skipped steps wait (the driver moves on by itself)", () => {
    for (const phase of ["injecting", "done", "skipped"] as const)
      expect(nextDrillAction({ phase, at: 0, endT: 0 }, 1e6, undefined).kind).toBe("wait");
  });
});
