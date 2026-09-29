/**
 * A live simulation session (Spec 04 Phase 2 / Spec 06): one `FlowEngine`
 * running the tick loop, streaming frames to ONE listener at most
 * `UI_SNAPSHOT_HZ` times per wall-clock second. The worker exposes it over
 * Comlink; `client.ts` uses the same code in-thread when there's no Worker.
 */
import type { SimGraph } from "@/domain/graph/compile";
import { FlowEngine, type FlowEngineOptions } from "./engine";
import { UI_SNAPSHOT_HZ } from "./traffic/types";
import type { SimConfig, SimSpeed, TickSnapshot, TrafficPattern } from "./types";

/** What the UI receives. */
export interface SimFrame {
  snapshot: TickSnapshot;
  /** Simulated seconds since the current pattern was applied (preview playhead). */
  patternTimeSec: number;
  /** The run this frame belongs to: frames of an older generation must be ignored. */
  generation: number;
}

export type FrameListener = (frame: SimFrame) => void;

export interface SimSession {
  load(graph: SimGraph, config?: SimConfig): void;
  play(): void;
  /** Stops and sends the last computed frame, so the UI shows the exact paused state. */
  pause(): void;
  /** Rewinds to t = 0; frames sent afterwards carry `generation`. */
  reset(generation: number): void;
  setSpeed(x: SimSpeed): void;
  setTraffic(p: TrafficPattern): void;
  /** Replaces the listener (null to stop streaming). */
  subscribe(listener: FrameListener | null): void;
  dispose(): void;
}

export function createSimSession(options: FlowEngineOptions = {}): SimSession {
  const engine = new FlowEngine(options);
  const now = options.clock?.now ?? (() => performance.now());
  const minGapMs = 1000 / UI_SNAPSHOT_HZ;
  let listener: FrameListener | null = null;
  let generation = 0;
  let lastSent = -Infinity;
  let pending: TickSnapshot | null = null;

  const send = (snapshot: TickSnapshot) => {
    pending = null;
    lastSent = now();
    listener?.({ snapshot, patternTimeSec: engine.patternTime, generation });
  };

  engine.onBatch((s) => {
    if (now() - lastSent >= minGapMs) send(s);
    else pending = s;
  });

  return {
    load: (graph, config) => engine.load(graph, config),
    play: () => engine.play(),
    pause: () => {
      engine.pause();
      if (pending) send(pending);
    },
    reset: (gen) => {
      engine.reset();
      generation = gen;
      pending = null;
      lastSent = -Infinity;
    },
    setSpeed: (x) => engine.setSpeed(x),
    setTraffic: (p) => engine.setTraffic(p),
    subscribe: (l) => {
      listener = l;
    },
    dispose: () => {
      engine.reset();
      listener = null;
    },
  };
}
