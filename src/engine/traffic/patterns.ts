/**
 * Load patterns → λ(t) (Spec 06, TRF-03). Pure and total: `rateAt` never
 * returns a negative number or NaN, whatever the pattern holds.
 *
 * `tSec` is the time since the pattern was applied (the engine restarts the
 * pattern clock when the pattern KIND changes and on reset; editing the
 * parameters of the current kind keeps it running).
 */
import { MAX_RPS, type TrafficPattern, type TrafficPatternKind } from "./types";

/** Hard ceiling on any rate a pattern can produce (a ×N spike of 1M stays finite). */
export const MAX_PATTERN_RPS = 100 * MAX_RPS;
const MAX_SEC = 24 * 3600;
const MAX_MULTIPLIER = 1000;
const MAX_STEPS = 50;

export const PATTERN_KINDS: readonly TrafficPatternKind[] = [
  "constant",
  "ramp",
  "spike",
  "diurnal",
  "steps",
];

export const PATTERN_LABELS: Record<TrafficPatternKind, string> = {
  constant: "Constant",
  ramp: "Ramp",
  spike: "Spike",
  diurnal: "Daily wave",
  steps: "Steps",
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

const rps = (v: unknown, fallback: number) => num(v, fallback, 0, MAX_PATTERN_RPS);
const sec = (v: unknown, fallback: number, min = 0) => num(v, fallback, min, MAX_SEC);

/**
 * Defaults per kind, built around a base load (e.g. the current RPS, so
 * switching kinds keeps the load in the same ballpark).
 */
export function defaultPattern(kind: TrafficPatternKind, base = 10_000): TrafficPattern {
  const b = rps(base, 10_000);
  switch (kind) {
    case "constant":
      return { kind, rps: b };
    case "ramp":
      return { kind, fromRps: Math.max(1, b / 10), toRps: b, durationSec: 60 };
    case "spike":
      return { kind, baseRps: b, multiplier: 5, startSec: 10, durationSec: 30 };
    case "diurnal":
      // 24 h compressed into 240 simulated seconds.
      return { kind, meanRps: b, amplitude: 0.5, periodSec: 240 };
    case "steps":
      return {
        kind,
        steps: [
          { atSec: 0, rps: b },
          { atSec: 30, rps: b * 2 },
          { atSec: 60, rps: b * 4 },
        ],
      };
  }
}

/**
 * Coerce anything into a valid pattern: finite non-negative rates, periods
 * and durations ≥ 1 s, multiplier ≥ 0, amplitude in [0, 1], steps sorted by
 * time (at most 50). Unknown input → the default constant pattern.
 */
export function sanitizePattern(input: unknown): TrafficPattern {
  const p = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  switch (p.kind) {
    case "constant":
      return { kind: "constant", rps: rps(p.rps, 10_000) };
    case "ramp":
      return {
        kind: "ramp",
        fromRps: rps(p.fromRps, 1000),
        toRps: rps(p.toRps, 10_000),
        durationSec: sec(p.durationSec, 60, 1),
      };
    case "spike":
      return {
        kind: "spike",
        baseRps: rps(p.baseRps, 10_000),
        multiplier: num(p.multiplier, 5, 0, MAX_MULTIPLIER),
        startSec: sec(p.startSec, 10),
        durationSec: sec(p.durationSec, 30, 1),
      };
    case "diurnal":
      return {
        kind: "diurnal",
        meanRps: rps(p.meanRps, 10_000),
        amplitude: num(p.amplitude, 0.5, 0, 1),
        periodSec: sec(p.periodSec, 240, 1),
      };
    case "steps": {
      const raw = Array.isArray(p.steps) ? p.steps : [];
      const steps = raw
        .slice(0, MAX_STEPS)
        .map((s) => {
          const r = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
          return { atSec: sec(r.atSec, 0), rps: rps(r.rps, 0) };
        })
        .sort((a, b) => a.atSec - b.atSec);
      return { kind: "steps", steps: steps.length > 0 ? steps : [{ atSec: 0, rps: 10_000 }] };
    }
    default:
      return { kind: "constant", rps: 10_000 };
  }
}

/**
 * λ(t) in req/s.
 * - constant: rps
 * - ramp: linear from `fromRps` at 0 to `toRps` at `durationSec`, then holds `toRps`
 * - spike: `baseRps`, × `multiplier` for t ∈ [startSec, startSec + durationSec)
 * - diurnal: meanRps × (1 + amplitude·sin(2πt/periodSec)), amplitude clamped to [0, 1]
 * - steps: the rps of the last step with atSec ≤ t (before the first step: its rps)
 * Negative t is treated as 0.
 */
export function rateAt(pattern: TrafficPattern, tSec: number): number {
  const t = Number.isFinite(tSec) && tSec > 0 ? tSec : 0;
  let r: number;
  switch (pattern.kind) {
    case "constant":
      r = pattern.rps;
      break;
    case "ramp": {
      const d = pattern.durationSec;
      const f = d > 0 ? Math.min(1, t / d) : 1;
      r = pattern.fromRps + (pattern.toRps - pattern.fromRps) * f;
      break;
    }
    case "spike": {
      const inSpike = t >= pattern.startSec && t < pattern.startSec + pattern.durationSec;
      r = inSpike ? pattern.baseRps * pattern.multiplier : pattern.baseRps;
      break;
    }
    case "diurnal": {
      const a = Math.min(
        1,
        Math.max(0, Number.isFinite(pattern.amplitude) ? pattern.amplitude : 0),
      );
      const period = pattern.periodSec > 0 ? pattern.periodSec : 1;
      r = pattern.meanRps * (1 + a * Math.sin((2 * Math.PI * t) / period));
      break;
    }
    case "steps": {
      const steps = pattern.steps;
      r = steps.length > 0 ? steps[0].rps : 0;
      for (const s of steps) {
        if (s.atSec <= t) r = s.rps;
        else break;
      }
      break;
    }
    default:
      r = 0;
  }
  return Number.isFinite(r) && r > 0 ? Math.min(r, MAX_PATTERN_RPS) : 0;
}

/**
 * How long the interesting part of a pattern lasts (for previews): the ramp,
 * the spike plus the same time after it, two periods, the last step + 30 s.
 */
export function patternHorizonSec(pattern: TrafficPattern): number {
  switch (pattern.kind) {
    case "constant":
      return 60;
    case "ramp":
      return pattern.durationSec * 1.25;
    case "spike":
      return pattern.startSec + pattern.durationSec * 2 + 5;
    case "diurnal":
      return pattern.periodSec * 2;
    case "steps": {
      const last = pattern.steps[pattern.steps.length - 1]?.atSec ?? 0;
      return Math.max(30, last * 1.25 + 10);
    }
  }
}

/** Highest λ the pattern reaches (for preview scaling and the "peak" readout). */
export function peakRate(pattern: TrafficPattern): number {
  switch (pattern.kind) {
    case "constant":
      return rateAt(pattern, 0);
    case "ramp":
      return Math.max(rateAt(pattern, 0), rateAt(pattern, pattern.durationSec));
    case "spike":
      return Math.max(rateAt(pattern, 0), rateAt(pattern, pattern.startSec));
    case "diurnal":
      return rateAt(pattern, pattern.periodSec / 4);
    case "steps":
      return pattern.steps.reduce((m, s) => Math.max(m, rateAt(pattern, s.atSec)), 0);
  }
}

/** The pattern's "base" load, used to seed another kind's defaults when switching. */
export function baseRateOf(pattern: TrafficPattern): number {
  switch (pattern.kind) {
    case "constant":
      return pattern.rps;
    case "ramp":
      return pattern.toRps;
    case "spike":
      return pattern.baseRps;
    case "diurnal":
      return pattern.meanRps;
    case "steps":
      return pattern.steps[0]?.rps ?? 10_000;
  }
}

/** Same pattern (value equality). */
export function samePattern(a: TrafficPattern, b: TrafficPattern): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------- log-scale RPS slider (TRF-02) ---------- */

/** Slider position in [0, 1] → rps in [MIN_RPS, MAX_RPS], log scale, rounded to 2 significant digits. */
export function sliderToRps(pos: number, min: number, max: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(pos) ? pos : 0));
  const v = Math.exp(Math.log(min) + f * (Math.log(max) - Math.log(min)));
  const mag = 10 ** Math.floor(Math.log10(v) - 1);
  return Math.min(max, Math.max(min, Math.round(v / mag) * mag));
}

export function rpsToSlider(r: number, min: number, max: number): number {
  const v = Math.min(max, Math.max(min, Number.isFinite(r) ? r : min));
  return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
}
