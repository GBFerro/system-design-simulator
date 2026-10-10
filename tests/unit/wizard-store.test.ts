import { beforeEach, describe, expect, it } from "vitest";
import { STEPS } from "@/lib/steps";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useRuntimeStore } from "@/store/runtimeStore";

// guided-ui, WIZ-02..06, WIZ-11, WIZ-12: the step is a view setting.

const app = () => useAppStore.getState();

describe("the step of free mode", () => {
  beforeEach(() => useAppStore.setState({ step: "problem" }));

  it("Next goes to the following step and stops at the last (WIZ-02, WIZ-15)", () => {
    const seen = [app().step];
    for (let i = 0; i < STEPS.length + 2; i++) {
      app().nextStep();
      seen.push(app().step);
    }
    expect(seen.slice(0, 5)).toEqual([...STEPS]);
    expect(seen.at(-1)).toBe("evaluate");
  });

  it("each step opens with its first tool (WIZ-08)", () => {
    const opened: string[] = [];
    for (let i = 0; i < 4; i++) {
      app().nextStep();
      opened.push(app().activeRightTab);
    }
    expect(opened).toEqual(["properties", "simulation", "chaos", "score"]);
    app().backStep();
    expect(app().activeRightTab).toBe("chaos");
  });

  it("Back goes to the previous step and stops at the first (WIZ-03, WIZ-04)", () => {
    useAppStore.setState({ step: "failures" });
    app().backStep();
    expect(app().step).toBe("simulate");
    for (let i = 0; i < 6; i++) app().backStep();
    expect(app().step).toBe("problem");
  });

  it("a step before the current one can be jumped to, one after it cannot (WIZ-05, WIZ-06)", () => {
    useAppStore.setState({ step: "simulate" });
    app().goToStep("design");
    expect(app().step).toBe("design");
    app().goToStep("evaluate");
    expect(app().step).toBe("design");
    app().goToStep("design");
    expect(app().step).toBe("design");
  });

  it("changing step touches neither the graph, nor the undo history, nor the live metrics (WIZ-11)", () => {
    const canvas = useCanvasStore.getState();
    const runtime = useRuntimeStore.getState();
    for (let i = 0; i < 6; i++) app().nextStep();
    for (let i = 0; i < 6; i++) app().backStep();
    expect(useCanvasStore.getState().nodes).toBe(canvas.nodes);
    expect(useCanvasStore.getState().edges).toBe(canvas.edges);
    expect(useCanvasStore.getState().history).toBe(canvas.history);
    expect(useRuntimeStore.getState().latest).toBe(runtime.latest);
    expect(useRuntimeStore.getState().playback).toBe(runtime.playback);
  });

  it("is persisted and an unknown stored value falls back to Problem (WIZ-12)", async () => {
    const options = useAppStore.persist.getOptions();
    expect(options.partialize!(app() as never)).toMatchObject({ step: "problem" });
    useAppStore.setState({ step: "failures" });
    expect(options.partialize!(app() as never)).toMatchObject({ step: "failures" });
    const merge = options.merge!;
    expect(merge({ step: "evaluate" }, app() as never)).toMatchObject({ step: "evaluate" });
    expect(merge({ step: "nope" }, app() as never)).toMatchObject({ step: "problem" });
    expect(merge(undefined, app() as never)).toMatchObject({ step: "problem" });
  });
});
