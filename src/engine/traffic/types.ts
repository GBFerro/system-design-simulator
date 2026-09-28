/**
 * Load patterns over simulated time (Spec 06, TRF-03).
 *
 * `rateAt(pattern, tSec)` in `patterns.ts` turns a pattern into λ(t) in req/s.
 */
export type TrafficPattern =
  | { kind: "constant"; rps: number }
  | { kind: "ramp"; fromRps: number; toRps: number; durationSec: number }
  | { kind: "spike"; baseRps: number; multiplier: number; startSec: number; durationSec: number }
  /** mean × (1 + amplitude·sin(2πt/period)); period compressed (24 h → e.g. 240 s simulated). */
  | { kind: "diurnal"; meanRps: number; amplitude: number; periodSec: number }
  | { kind: "steps"; steps: { atSec: number; rps: number }[] };

export type TrafficPatternKind = TrafficPattern["kind"];

/** Simulated seconds per wall-clock second. */
export type SimSpeed = 1 | 5 | 20;

export const SIM_SPEEDS: readonly SimSpeed[] = [1, 5, 20];

/** Simulated time advanced by one tick (Spec 04, "Loop de um tick"). */
export const TICK_SEC = 0.05;

/** Ticks kept in the ring buffer: 5 min simulated at 50 ms. */
export const HISTORY_TICKS = 6000;

/** Snapshots reach the UI at most this often (throttled in the worker). */
export const UI_SNAPSHOT_HZ = 10;

/** RPS slider bounds (log scale, TRF-02). */
export const MIN_RPS = 10;
export const MAX_RPS = 1_000_000;
