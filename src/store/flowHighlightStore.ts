import { create } from "zustand";

/**
 * The edge the Flow tab's trace points at (request-flow, FLW-39): hovering or
 * tapping a step of the sequence diagram highlights its edge on the canvas
 * and the way it goes (`req`: caller → callee, `res`: the response back).
 * A view setting, NOT persisted and never in `canvasStore`: no undo entry,
 * works on read-only tabs.
 */
export type FlowDirection = "req" | "res";

export interface FlowHighlight {
  edgeId: string;
  dir: FlowDirection;
}

interface FlowHighlightState {
  highlight: FlowHighlight | null;
}

export const useFlowHighlightStore = create<FlowHighlightState>(() => ({ highlight: null }));

/** Highlight one edge (or nothing). */
export function setFlowHighlight(highlight: FlowHighlight | null): void {
  const prev = useFlowHighlightStore.getState().highlight;
  if (prev?.edgeId === highlight?.edgeId && prev?.dir === highlight?.dir) return;
  useFlowHighlightStore.setState({ highlight });
}

/** The edge's highlight direction, or null: a string, so only edges whose value changes re-render. */
export function flowHighlightOf(state: FlowHighlightState, edgeId: string): FlowDirection | null {
  return state.highlight?.edgeId === edgeId ? state.highlight.dir : null;
}

export function useFlowHighlight(edgeId: string): FlowDirection | null {
  return useFlowHighlightStore((s) => flowHighlightOf(s, edgeId));
}

/* ---------- test hook ---------- */

// Playwright sets highlights through this handle. Installed in development,
// or in any build when the page is opened with `?e2e` (like `__runtimeStore`).
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("e2e"))
) {
  (window as unknown as { __flowHighlightStore?: unknown }).__flowHighlightStore = {
    getState: useFlowHighlightStore.getState,
    setFlowHighlight,
  };
}
