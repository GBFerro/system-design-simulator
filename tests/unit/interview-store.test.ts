import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ANSWERS, useInterviewStore } from "@/store/interviewStore";
import { useAppStore } from "@/store/appStore";

const st = () => useInterviewStore.getState();

describe("interviewStore (Spec 09)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    st().startInterview();
  });
  afterEach(() => {
    st().endInterview();
    vi.useRealTimers();
  });

  it("records the seconds spent in each phase, from timestamps", () => {
    vi.advanceTimersByTime(90_000);
    st().nextPhase();
    vi.advanceTimersByTime(30_000);
    st().prevPhase(); // back to phase 1: its time accumulates
    vi.advanceTimersByTime(10_000);
    expect(st().phaseSeconds).toEqual([90, 30]);
    expect(st().phaseSecondsNow()).toEqual([100, 30]);
  });

  it("keeps the answers of the checkable phases and resets them on a new interview", () => {
    st().toggleRequirement("r1");
    st().toggleRequirement("r2");
    st().toggleRequirement("r1");
    st().setEstimate("readsPerSec", 1000);
    st().setEstimate("writesPerSec", Number.NaN); // invalid: not stored
    st().addApi();
    st().updateApi(0, { method: "POST", path: "/urls" });
    st().addEntity();
    st().updateEntity(0, { name: "Url", store: "nosql", partitionKey: "shortCode" });
    expect(st().answers).toEqual({
      requirements: ["r2"],
      requirementNotes: "",
      estimates: { readsPerSec: 1000 },
      apis: [{ method: "POST", path: "/urls" }],
      entities: [{ name: "Url", store: "nosql", partitionKey: "shortCode" }],
    });
    st().removeApi(0);
    expect(st().answers.apis).toEqual([]);
    st().startInterview();
    expect(st().answers).toEqual(EMPTY_ANSWERS);
    expect(st().phaseSeconds).toEqual([]);
  });

  it("keeps time through a background tab and a refresh (timestamps, no tick counting)", () => {
    st().nextPhase(); // phase 2 starts at 0 s
    // A throttled background tab: the clock moves, no timer fires.
    vi.setSystemTime(new Date("2026-09-30T10:01:00Z"));
    expect(st().elapsedSeconds()).toBe(60);
    // Refresh: a fresh store rebuilt from what was persisted.
    const partialize = useInterviewStore.persist.getOptions().partialize!;
    const saved = JSON.parse(JSON.stringify(partialize(st())));
    st().endInterview();
    useInterviewStore.setState(saved);
    vi.setSystemTime(new Date("2026-09-30T10:01:30Z"));
    expect(st().elapsedSeconds()).toBe(90);
    expect(st().phaseSecondsNow()).toEqual([0, 90]);
  });

  it("persists the answers and phase times", () => {
    const partialize = useInterviewStore.persist.getOptions().partialize!;
    const saved = partialize(st()) as Record<string, unknown>;
    expect(saved).toHaveProperty("answers");
    expect(saved).toHaveProperty("phaseSeconds");
  });

  // guided-ui, WIZ-24, WIZ-25, WIZ-27
  it("the bar only goes back: a later phase is ignored, an earlier one accumulates the time of the one it leaves (WIZ-24, WIZ-25)", () => {
    vi.advanceTimersByTime(60_000);
    st().nextPhase();
    st().nextPhase();
    expect(st().currentPhase).toBe(2);
    st().setPhase(5);
    expect(st().currentPhase).toBe(2);
    st().setPhase(2);
    expect(st().currentPhase).toBe(2);
    vi.advanceTimersByTime(20_000);
    st().setPhase(0);
    expect(st().currentPhase).toBe(0);
    expect(st().phaseSeconds).toEqual([60, 0, 20]);
  });

  it("an interview leaves the free-mode step alone, so abandoning returns to where the user was (WIZ-27)", () => {
    useAppStore.setState({ step: "simulate" });
    st().startInterview();
    st().nextPhase();
    st().endInterview();
    expect(st().mode).toBe("free");
    expect(useAppStore.getState().step).toBe("simulate");
  });
});
