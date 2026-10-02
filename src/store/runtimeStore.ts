import { useMemo } from "react";
import { create } from "zustand";
import type {
  EdgeRuntimeMetrics,
  GlobalRuntimeMetrics,
  NodeRuntimeMetrics,
  TickSnapshot,
} from "@/engine/types";
import { HISTORY_TICKS, type SimSpeed, type TrafficPattern } from "@/engine/traffic/types";
import { RingBuffer } from "@/lib/ringBuffer";
import { recentWindow, shareUnchanged } from "@/lib/runtimeMetrics";

/**
 * Live simulation state (Spec 07, `runtimeStore`). NOT persisted.
 *
 * Producers: the tick loop (Spec 04 Phase 2 / Spec 06) and the "Simulate"
 * button (an `analyze()` steady state mapped by `steadyStateToSnapshot`).
 * Consumers subscribe per node/edge with the selector hooks below, so a tick
 * never re-renders the whole graph nor touches `canvasStore`.
 */

export type PlaybackStatus = "idle" | "running" | "paused";

export const DEFAULT_PATTERN: TrafficPattern = { kind: "constant", rps: 10_000 };

interface RuntimeState {
  playback: PlaybackStatus;
  speed: SimSpeed;
  /** Current load pattern; the RPS slider sets a `constant` one while dragging. */
  pattern: TrafficPattern;
  /** Latest snapshot (null before the first run or after `clear`). */
  latest: TickSnapshot | null;
  /** Snapshots received by the UI, oldest → newest. Mutable: read via `historyVersion`. */
  history: RingBuffer<TickSnapshot>;
  /** Bumped on every push/clear so selectors over `history` can re-run. */
  historyVersion: number;
  /**
   * Live run clock (Spec 06), set by the sim controller with each tick frame:
   * simulated seconds since reset, and since the current pattern was applied
   * (the pattern preview's playhead). 0 after `clear`. The "Analyze" button
   * does not move it.
   */
  simTimeSec: number;
  patternTimeSec: number;

  pushSnapshot: (s: TickSnapshot) => void;
  setPlayback: (p: PlaybackStatus) => void;
  setSpeed: (x: SimSpeed) => void;
  setPattern: (p: TrafficPattern) => void;
  setClock: (simTimeSec: number, patternTimeSec: number) => void;
  /** Drop all metrics (graph changed, reset, new tab). Keeps speed and pattern. */
  clear: () => void;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  playback: "idle",
  speed: 1,
  pattern: DEFAULT_PATTERN,
  latest: null,
  history: new RingBuffer<TickSnapshot>(HISTORY_TICKS),
  historyVersion: 0,
  simTimeSec: 0,
  patternTimeSec: 0,

  pushSnapshot: (incoming) => {
    // Structural sharing: unchanged node/edge/global metrics keep the previous
    // object, so per-entity selectors don't re-render what didn't change.
    const s = shareUnchanged(get().latest, incoming);
    get().history.push(s);
    set((state) => ({ latest: s, historyVersion: state.historyVersion + 1 }));
  },
  setPlayback: (playback) => set({ playback }),
  setSpeed: (speed) => set({ speed }),
  setPattern: (pattern) => set({ pattern }),
  setClock: (simTimeSec, patternTimeSec) => set({ simTimeSec, patternTimeSec }),
  clear: () => {
    get().history.clear();
    set((state) => ({
      latest: null,
      playback: "idle",
      simTimeSec: 0,
      patternTimeSec: 0,
      historyVersion: state.historyVersion + 1,
    }));
  },
}));

/* ---------- per-entity selector hooks ---------- */

export function useNodeRuntime(nodeId: string): NodeRuntimeMetrics | undefined {
  return useRuntimeStore((s) => s.latest?.nodes[nodeId]);
}

export function useEdgeRuntime(edgeId: string): EdgeRuntimeMetrics | undefined {
  return useRuntimeStore((s) => s.latest?.edges[edgeId]);
}

export function useGlobalRuntime(): GlobalRuntimeMetrics | undefined {
  return useRuntimeStore((s) => s.latest?.global);
}

/** Blast radius role of a node (Spec 08), a string: re-renders only when it changes. */
export function useNodeBlast(nodeId: string): NodeRuntimeMetrics["blast"] {
  return useRuntimeStore((s) => s.latest?.nodes[nodeId]?.blast);
}

/** Just the node's status (a string, so re-renders only when the status changes). */
export function useNodeStatus(nodeId: string): NodeRuntimeMetrics["status"] | undefined {
  return useRuntimeStore((s) => s.latest?.nodes[nodeId]?.status);
}

/**
 * The newest run of snapshots covering `windowSec` simulated seconds (see
 * `recentWindow`), re-read whenever a snapshot is pushed. Re-renders at the
 * snapshot rate: mount it only where needed (panel charts, an open sparkline).
 */
export function useRecentHistory(windowSec: number, maxPoints = 120): TickSnapshot[] {
  const version = useRuntimeStore((s) => s.historyVersion);
  const history = useRuntimeStore((s) => s.history);
  return useMemo(
    // `version` is the change signal for the mutable ring buffer.
    () => (version < 0 ? [] : recentWindow(history.toArray(), windowSec, maxPoints)),
    [history, version, windowSec, maxPoints],
  );
}

/** Non-hook access for canvas layers (particles) that read on each animation frame. */
export function getLatestSnapshot(): TickSnapshot | null {
  return useRuntimeStore.getState().latest;
}

/* ---------- test hook ---------- */

// Playwright pushes synthetic snapshots through this handle. Installed in
// development, or in any build when the page is opened with `?e2e`.
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("e2e"))
) {
  (window as unknown as { __runtimeStore?: typeof useRuntimeStore }).__runtimeStore =
    useRuntimeStore;
}
