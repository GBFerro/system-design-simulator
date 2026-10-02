/**
 * A problem's SLO and the user's overrides (Spec 11, SLO-01). Pure.
 */
import type { LatencySlo } from "@/engine/types";
import type { ProblemRequirements } from "@/types/problem";
import {
  AVAILABILITY_RANGE,
  DEFAULT_AVAILABILITY,
  DEFAULT_WINDOW_SEC,
  SLO_PERCENTILES,
  THRESHOLD_RANGE_MS,
  WINDOW_RANGE_SEC,
  type Sli,
  type Slo,
  type SloOverrides,
  type SloPercentile,
} from "./types";

function isPercentile(v: unknown): v is SloPercentile {
  return SLO_PERCENTILES.includes(v as SloPercentile);
}

function inRange(v: unknown, r: { min: number; max: number }): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= r.min && v <= r.max;
}

/**
 * The SLO a problem declares: its latency SLA (`latencyMs` at
 * `latencyPercentile`, p99 by default, about `slaScope` when set) and its
 * `availability` (99.9% when absent, e.g. a custom problem).
 */
export function problemSlo(requirements: ProblemRequirements): Slo {
  const percentile = isPercentile(requirements.latencyPercentile)
    ? requirements.latencyPercentile
    : 99;
  const thresholdMs = inRange(requirements.latencyMs, THRESHOLD_RANGE_MS)
    ? requirements.latencyMs
    : THRESHOLD_RANGE_MS.max;
  return {
    latency: {
      percentile,
      thresholdMs,
      ...(requirements.slaScope ? { scope: requirements.slaScope } : {}),
    },
    availability: inRange(requirements.availability, AVAILABILITY_RANGE)
      ? requirements.availability
      : DEFAULT_AVAILABILITY,
    windowSec: DEFAULT_WINDOW_SEC,
  };
}

/**
 * Overrides from anywhere (store, imported file): out-of-range or unknown
 * fields dropped. Undefined when nothing valid is left.
 */
export function sanitizeSloOverrides(raw: unknown): SloOverrides | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: SloOverrides = {};
  if (isPercentile(r.percentile)) out.percentile = r.percentile;
  if (inRange(r.thresholdMs, THRESHOLD_RANGE_MS)) out.thresholdMs = r.thresholdMs;
  if (inRange(r.availability, AVAILABILITY_RANGE)) out.availability = r.availability;
  if (inRange(r.windowSec, WINDOW_RANGE_SEC)) out.windowSec = Math.round(r.windowSec);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The problem's SLO with the user's overrides applied (scope never changes). */
export function resolveSlo(base: Slo, overrides?: SloOverrides): Slo {
  const o = sanitizeSloOverrides(overrides);
  if (!o) return base;
  return {
    latency: {
      ...base.latency,
      ...(o.percentile !== undefined ? { percentile: o.percentile } : {}),
      ...(o.thresholdMs !== undefined ? { thresholdMs: o.thresholdMs } : {}),
    },
    availability: o.availability ?? base.availability,
    windowSec: o.windowSec ?? base.windowSec,
  };
}

/** Overrides that turn `base` into `slo` (only what differs); undefined when equal. */
export function overridesFor(base: Slo, slo: Slo): SloOverrides | undefined {
  const o: SloOverrides = {};
  if (slo.latency.percentile !== base.latency.percentile) o.percentile = slo.latency.percentile;
  if (slo.latency.thresholdMs !== base.latency.thresholdMs) o.thresholdMs = slo.latency.thresholdMs;
  if (slo.availability !== base.availability) o.availability = slo.availability;
  if (slo.windowSec !== base.windowSec) o.windowSec = slo.windowSec;
  return sanitizeSloOverrides(o);
}

/** Share of requests each SLI may get wrong over the window. */
export function budgetFraction(slo: Slo, sli: Sli): number {
  return sli === "availability" ? 1 - slo.availability : 1 - slo.latency.percentile / 100;
}

/** What the engine needs to count goodput. */
export function latencySloOf(slo: Slo): LatencySlo {
  return {
    thresholdMs: slo.latency.thresholdMs,
    ...(slo.latency.scope ? { scope: slo.latency.scope } : {}),
  };
}

/** "99.9%", "99.99%", "99.999%" — never rounds a nine away. */
export function formatAvailability(a: number): string {
  const pct = a * 100;
  for (let d = 0; d <= 4; d++) {
    const s = pct.toFixed(d);
    if (Math.abs(Number(s) - pct) < 1e-9) return `${s}%`;
  }
  return `${pct.toFixed(4)}%`;
}

/** Allowed downtime per 30 days at this availability, e.g. "43 min/month". */
export function downtimePerMonth(a: number): string {
  const minutes = (1 - a) * 30 * 24 * 60;
  if (minutes >= 120) return `${(minutes / 60).toFixed(1)} h/month`;
  if (minutes >= 1) return `${Math.round(minutes)} min/month`;
  return `${Math.round(minutes * 60)} s/month`;
}

/**
 * Highest error rate a fault lasting `durationSec` may cause and still fit in
 * one window's availability budget: (1 − availability) × window ÷ duration.
 * A fault as long as the window (or of unknown length) gets the plain budget.
 */
export function faultErrorAllowance(slo: Slo, durationSec: number): number {
  const d = durationSec > 0 ? Math.min(durationSec, slo.windowSec) : slo.windowSec;
  return Math.min(1, (budgetFraction(slo, "availability") * slo.windowSec) / d);
}

/** "5-minute", "90-second": a window length as an adjective. */
export function formatWindow(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60}-minute` : `${sec}-second`;
}

/** Burn rate: "0×", "0.4×", "3.2×", "120×". */
export function formatBurn(burn: number): string {
  const b = Number.isFinite(burn) ? Math.max(0, burn) : 0;
  if (b === 0) return "0×";
  if (b < 10) return `${Number(b.toFixed(1))}×`;
  return `${Math.round(b)}×`;
}
