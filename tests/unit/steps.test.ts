import { describe, expect, it } from "vitest";
import {
  PROBLEM_SCREEN_TOOLS,
  STEPS,
  TOOLS_BY_STEP,
  canvasVisible,
  interviewCanvasVisible,
  interviewPaletteVisible,
  interviewTools,
  paletteVisible,
  sanitizeStep,
  stepForTab,
  type RightTab,
} from "@/lib/steps";

// guided-ui, WIZ-01, WIZ-07..10, WIZ-12, WIZ-21..23.

const ALL_TABS: RightTab[] = [
  "properties",
  "simulation",
  "flow",
  "chaos",
  "slo",
  "score",
  "advisor",
  "cost",
  "capacity",
  "tradeoffs",
];

describe("steps and their tools", () => {
  it("free mode walks Problem, Design, Simulate, Failures, Evaluate in that order (WIZ-01)", () => {
    expect([...STEPS]).toEqual(["problem", "design", "simulate", "failures", "evaluate"]);
  });

  it("each step shows only its tools (WIZ-08)", () => {
    expect(TOOLS_BY_STEP.design).toEqual(["properties", "flow"]);
    expect(TOOLS_BY_STEP.simulate).toEqual(["simulation", "flow", "properties"]);
    expect(TOOLS_BY_STEP.failures).toEqual(["chaos", "slo", "properties"]);
    expect(TOOLS_BY_STEP.evaluate).toEqual(["score", "advisor", "cost", "tradeoffs", "properties"]);
  });

  it("every tab is reachable in at least one step or on the Problem screen (WIZ-10)", () => {
    const reachable = new Set<RightTab>([
      ...PROBLEM_SCREEN_TOOLS,
      ...Object.values(TOOLS_BY_STEP).flat(),
    ]);
    expect([...reachable].sort()).toEqual([...ALL_TABS].sort());
    expect(PROBLEM_SCREEN_TOOLS).toEqual(["capacity"]);
  });

  it("Problem hides the canvas; the palette is the Design step's only (WIZ-07, WIZ-09)", () => {
    expect(STEPS.filter((s) => !canvasVisible(s))).toEqual(["problem"]);
    expect(STEPS.filter(paletteVisible)).toEqual(["design"]);
  });

  it("an unknown stored step falls back to Problem (WIZ-12)", () => {
    expect(sanitizeStep("evaluate")).toBe("evaluate");
    for (const bad of ["", "nope", 3, null, undefined, {}])
      expect(sanitizeStep(bad)).toBe("problem");
  });
});

describe("interview phases (WIZ-21, WIZ-22, WIZ-23)", () => {
  it("phases 1–4 have no canvas; High-Level Design and the Deep Dive do", () => {
    expect([0, 1, 2, 3, 4, 5].map(interviewCanvasVisible)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("High-Level Design has the palette and Design + Simulate's tools; the Deep Dive has neither", () => {
    expect([0, 1, 2, 3, 4, 5].map(interviewPaletteVisible)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(interviewTools(4)).toEqual(["properties", "flow", "simulation"]);
    expect(interviewTools(5)).toEqual([]);
    expect(interviewTools(0)).toEqual([]);
  });
});

describe("asking for a tool (WIZ-10)", () => {
  it("stays in the current step when it has the tool, else moves to the first step that does", () => {
    expect(stepForTab("flow", "simulate")).toBe("simulate");
    expect(stepForTab("flow", "evaluate")).toBe("design");
    expect(stepForTab("properties", "failures")).toBe("failures");
    expect(stepForTab("cost", "design")).toBe("evaluate");
    expect(stepForTab("slo", "design")).toBe("failures");
    expect(stepForTab("score", "simulate")).toBe("evaluate");
    expect(stepForTab("capacity", "evaluate")).toBe("problem");
    expect(stepForTab("capacity", "problem")).toBe("problem");
  });
});
