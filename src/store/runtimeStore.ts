import { create } from "zustand";
import type {
  EdgeRuntimeMetrics,
  GlobalRuntimeMetrics,
  NodeRuntimeMetrics,
  TickSnapshot,
} from "@/engine/types";
import { HISTORY_TICKS, type SimSpeed, type TrafficPattern } from "@/engine/traffic/types";
import { RingBuffer } from "@/lib/ringBuffer";

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

  pushSnapshot: (s: TickSnapshot) => void;
  setPlayback: (p: PlaybackStatus) => void;
  setSpeed: (x: SimSpeed) => void;
  setPattern: (p: TrafficPattern) => void;
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

  pushSnapshot: (s) => {
    get().history.push(s);
    set((state) => ({ latest: s, historyVersion: state.historyVersion + 1 }));
  },
  setPlayback: (playback) => set({ playback }),
  setSpeed: (speed) => set({ speed }),
  setPattern: (pattern) => set({ pattern }),
  clear: () => {
    get().history.clear();
    set((state) => ({ latest: null, playback: "idle", historyVersion: state.historyVersion + 1 }));
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

/** Non-hook access for canvas layers (particles) that read on each animation frame. */
export function getLatestSnapshot(): TickSnapshot | null {
  return useRuntimeStore.getState().latest;
}
