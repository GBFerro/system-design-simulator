import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import {
  flowHighlightOf,
  setFlowHighlight,
  useFlowHighlightStore,
} from "@/store/flowHighlightStore";
import { comp, wire } from "./engineFixtures";

/**
 * The trace's edge highlight (request-flow, FLW-39): an unpersisted view
 * store read per edge, never `canvasStore`.
 */
describe("flowHighlightStore", () => {
  beforeEach(() => setFlowHighlight(null));

  /** What each edge's selector returns now (zustand re-renders an edge only when this changes). */
  const read = (...ids: string[]) =>
    ids.map((id) => flowHighlightOf(useFlowHighlightStore.getState(), id));

  it("highlights one edge with its direction; the others read null", () => {
    setFlowHighlight({ edgeId: "a", dir: "req" });
    expect(read("a", "b", "c")).toEqual(["req", null, null]);
    setFlowHighlight({ edgeId: "a", dir: "res" });
    expect(read("a", "b", "c")).toEqual(["res", null, null]);
    setFlowHighlight(null);
    expect(read("a", "b", "c")).toEqual([null, null, null]);
  });

  it("moving the highlight changes only the two edges involved", () => {
    setFlowHighlight({ edgeId: "a", dir: "req" });
    const before = read("a", "b", "c");
    setFlowHighlight({ edgeId: "b", dir: "res" });
    const after = read("a", "b", "c");
    const changed = ["a", "b", "c"].filter((_, i) => !Object.is(before[i], after[i]));
    expect(changed).toEqual(["a", "b"]);
  });

  it("setting the same highlight again notifies nobody", () => {
    setFlowHighlight({ edgeId: "a", dir: "req" });
    let notified = 0;
    const off = useFlowHighlightStore.subscribe(() => notified++);
    setFlowHighlight({ edgeId: "a", dir: "req" });
    off();
    expect(notified).toBe(0);
  });

  it("never writes to canvasStore and is not persisted", () => {
    useCanvasStore.setState({
      nodes: [comp("lb", "load-balancer"), comp("app", "app-server")],
      edges: [wire("lb", "app")],
    });
    const canvas = useCanvasStore.getState();
    setFlowHighlight({ edgeId: "e-lb-app", dir: "req" });
    expect(useCanvasStore.getState()).toBe(canvas);
    expect(useCanvasStore.getState().canUndo()).toBe(canvas.canUndo());
    expect("persist" in useFlowHighlightStore).toBe(false);
  });
});
