import { create } from "zustand";

/**
 * The marks that drive the "just added" motion (slice 4): the node a dock, palette, drop or command
 * add just put on the canvas, and the edge the user just connected. A mark holds an id and the time
 * it was set; the node (`[data-landing]` + ground ripple), the edge (`data-drawing`) and the cost chip
 * (`data-flash`) read it, and it is cleared when their animation ends (and by a safety timeout).
 *
 * A view effect, NOT persisted and never in `node.data` or `canvasStore`: no undo entry, nothing in
 * localStorage. Set only where the add or the connect happens, never by a load, a reference or a quick
 * fix, and not at all when the user prefers reduced motion.
 */
export interface MotionMark {
  id: string;
  at: number;
}

interface MotionState {
  node: MotionMark | null;
  edge: MotionMark | null;
}

export const useMotionStore = create<MotionState>(() => ({
  node: null,
  edge: null,
}));

/** The longest a mark lives if no animation ends to clear it (both under a second). */
export const NODE_MARK_TTL_MS = 900;
export const EDGE_MARK_TTL_MS = 600;

type Kind = keyof MotionState;
const timers: Record<Kind, ReturnType<typeof setTimeout> | null> = {
  node: null,
  edge: null,
};

function clear(kind: Kind, id?: string): void {
  const current = useMotionStore.getState()[kind];
  if (!current || (id !== undefined && current.id !== id)) return;
  if (timers[kind]) clearTimeout(timers[kind]);
  timers[kind] = null;
  useMotionStore.setState({ [kind]: null } as Pick<MotionState, Kind>);
}

function mark(kind: Kind, id: string, ttl: number): void {
  if (timers[kind]) clearTimeout(timers[kind]);
  useMotionStore.setState({ [kind]: { id, at: Date.now() } } as Pick<MotionState, Kind>);
  timers[kind] = setTimeout(() => clear(kind, id), ttl);
}

/** A node was just added. */
export const markNodeAdded = (id: string): void => mark("node", id, NODE_MARK_TTL_MS);
/** Its landing is over (only if it is still the marked one; no id clears whatever is marked). */
export const clearNodeAdded = (id?: string): void => clear("node", id);
/** An edge was just connected by the user. */
export const markEdgeConnected = (id: string): void => mark("edge", id, EDGE_MARK_TTL_MS);
export const clearEdgeConnected = (id?: string): void => clear("edge", id);

/** Whether this node is the marked one: a boolean, so only the marked node re-renders. */
export const useNodeLanding = (id: string): boolean => useMotionStore((s) => s.node?.id === id);
export const useEdgeDrawing = (id: string): boolean => useMotionStore((s) => s.edge?.id === id);

/** `prefers-reduced-motion: reduce`, for code outside a component (the hook is `usePrefersReducedMotion`). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
}

/* ---------- test hook ---------- */

// Playwright reads the marks through this handle (development, or any build opened with `?e2e`).
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("e2e"))
) {
  (window as unknown as { __motionStore?: unknown }).__motionStore = {
    getState: useMotionStore.getState,
  };
}
