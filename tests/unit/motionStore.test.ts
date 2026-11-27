import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDGE_MARK_TTL_MS,
  NODE_MARK_TTL_MS,
  clearEdgeConnected,
  clearNodeAdded,
  markEdgeConnected,
  markNodeAdded,
  prefersReducedMotion,
  useMotionStore,
} from "@/store/motionStore";

// Papel quente slice 4 (criteria 32, 34, 35): the marks "this node was just added" and "this edge
// was just connected". Unpersisted view state: an id and a start time, cleared by the animation end
// or by a safety timeout.

beforeEach(() => {
  vi.useFakeTimers();
  clearNodeAdded();
  clearEdgeConnected();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const state = () => useMotionStore.getState();

describe("the node mark", () => {
  it("holds the id and the start time of the node just added", () => {
    vi.setSystemTime(5000);
    markNodeAdded("n1");
    expect(state().node).toEqual({ id: "n1", at: 5000 });
  });

  it("a newer add replaces it", () => {
    markNodeAdded("n1");
    markNodeAdded("n2");
    expect(state().node?.id).toBe("n2");
  });

  it("clears for its own id, not for another one", () => {
    markNodeAdded("n1");
    clearNodeAdded("other");
    expect(state().node?.id).toBe("n1");
    clearNodeAdded("n1");
    expect(state().node).toBeNull();
  });

  it("clears itself within a second, whatever the animation does", () => {
    markNodeAdded("n1");
    expect(NODE_MARK_TTL_MS).toBeLessThan(1000);
    vi.advanceTimersByTime(NODE_MARK_TTL_MS - 1);
    expect(state().node?.id).toBe("n1");
    vi.advanceTimersByTime(1);
    expect(state().node).toBeNull();
  });

  it("the first add's timer does not clear the second add's mark", () => {
    markNodeAdded("n1");
    vi.advanceTimersByTime(NODE_MARK_TTL_MS - 100);
    markNodeAdded("n2");
    vi.advanceTimersByTime(200);
    expect(state().node?.id).toBe("n2");
  });
});

describe("the edge mark", () => {
  it("holds the edge just connected and clears itself inside its window", () => {
    markEdgeConnected("e1");
    expect(state().edge?.id).toBe("e1");
    expect(state().node).toBeNull();
    vi.advanceTimersByTime(EDGE_MARK_TTL_MS);
    expect(state().edge).toBeNull();
  });

  it("clears for its own id only", () => {
    markEdgeConnected("e1");
    clearEdgeConnected("e2");
    expect(state().edge?.id).toBe("e1");
    clearEdgeConnected("e1");
    expect(state().edge).toBeNull();
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query, and is false without one", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
  });
});
