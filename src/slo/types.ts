/**
 * SLOs and error budget (Spec 11). Pure: no React, no stores.
 *
 * An SLO has two SLIs, each with its own error budget:
 * - availability: a request that fails is bad; budget = 1 − availability;
 * - latency: a successful request slower than `thresholdMs` is bad; budget =
 *   1 − percentile/100 (a p99 target lets 1% of requests be slower).
 * The engine's goodput (Spec 07) counts the successful requests within the
 * threshold, so the bad ones are exactly offered − goodput.
 */

export type SloPercentile = 50 | 95 | 99;

export const SLO_PERCENTILES: readonly SloPercentile[] = [50, 95, 99];

export interface Slo {
  latency: {
    percentile: SloPercentile;
    thresholdMs: number;
    /** Component type whose hop the target is about (problem's `slaScope`); else end to end. */
    scope?: string;
  };
  /** Target share of requests that succeed, e.g. 0.999. */
  availability: number;
  /** Simulated seconds the error budget covers. */
  windowSec: number;
}

/**
 * What the user may change in a problem's SLO (SLO-01). Saved per problem and
 * in the design envelope (`slo`); an interview always uses the problem's.
 */
export interface SloOverrides {
  percentile?: SloPercentile;
  thresholdMs?: number;
  availability?: number;
  windowSec?: number;
}

/** The two SLIs, for budgets and verdicts. */
export type Sli = "availability" | "latency";

/** Availability when a problem doesn't declare one. */
export const DEFAULT_AVAILABILITY = 0.999;
/** Default error-budget window: 5 simulated minutes (the run history). */
export const DEFAULT_WINDOW_SEC = 300;
/** Short window of the displayed burn rate. */
export const BURN_WINDOW_SEC = 30;
/** Burn rate that counts as burning fast (the alert threshold, OBS-07). */
export const FAST_BURN_RATE = 10;

/** Editable ranges. Availability stops short of 100%: that leaves no budget at all. */
export const AVAILABILITY_RANGE = { min: 0.9, max: 0.99999 } as const;
export const THRESHOLD_RANGE_MS = { min: 0.1, max: 60_000 } as const;
export const WINDOW_RANGE_SEC = { min: 30, max: 300 } as const;
