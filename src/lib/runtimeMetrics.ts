/**
 * Pure helpers over runtime snapshots (Spec 07): structural sharing between
 * consecutive snapshots, sparkline geometry and number formatting. No React,
 * no DOM — unit-tested in `tests/unit/metrics.test.ts`.
 */
import type {
  EdgeRuntimeMetrics,
  GlobalRuntimeMetrics,
  NodeRuntimeMetrics,
  TickSnapshot,
} from "@/engine/types";

/* ---------- structural sharing ---------- */

function shallowEqual(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.is(ra[k], rb[k]));
}

export function nodeMetricsEqual(a: NodeRuntimeMetrics, b: NodeRuntimeMetrics): boolean {
  if (a === b) return true;
  const { extra: ea, ...ra } = a;
  const { extra: eb, ...rb } = b;
  return shallowEqual(ra, rb) && shallowEqual(ea, eb);
}

export const edgeMetricsEqual = (a: EdgeRuntimeMetrics, b: EdgeRuntimeMetrics): boolean =>
  shallowEqual(a, b);

export const globalMetricsEqual = (a: GlobalRuntimeMetrics, b: GlobalRuntimeMetrics): boolean =>
  shallowEqual(a, b);

function shareRecord<T>(
  prev: Record<string, T> | undefined,
  next: Record<string, T>,
  equal: (a: T, b: T) => boolean,
): Record<string, T> {
  if (!prev) return next;
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  const out: Record<string, T> = {};
  for (const id in next) {
    const p = prev[id];
    if (p !== undefined && equal(p, next[id])) out[id] = p;
    else {
      out[id] = next[id];
      changed = true;
    }
  }
  return changed ? out : prev;
}

/**
 * Reuse the previous snapshot's per-node / per-edge / global objects wherever
 * the values are unchanged, so per-entity selectors (`useNodeRuntime(id)`)
 * keep their identity and untouched nodes/edges don't re-render on a tick.
 */
export function shareUnchanged(prev: TickSnapshot | null, next: TickSnapshot): TickSnapshot {
  if (!prev) return next;
  return {
    ...next,
    nodes: shareRecord(prev.nodes, next.nodes, nodeMetricsEqual),
    edges: shareRecord(prev.edges, next.edges, edgeMetricsEqual),
    global: globalMetricsEqual(prev.global, next.global) ? prev.global : next.global,
  };
}

/* ---------- sparklines / small time series ---------- */

/** Seconds of simulated time shown by node sparklines (OBS-01). */
export const SPARKLINE_WINDOW_SEC = 30;

/**
 * The newest run of snapshots covering the last `windowSec` simulated seconds.
 * Walks back from the newest and stops where time goes backwards (a new run
 * or an `analyze()` snapshot at t = 0 after a played run), so runs never mix.
 * `maxPoints` caps the result by down-sampling evenly (newest kept).
 */
export function recentWindow(
  history: readonly TickSnapshot[],
  windowSec = SPARKLINE_WINDOW_SEC,
  maxPoints = 120,
): TickSnapshot[] {
  const n = history.length;
  if (n === 0) return [];
  const newest = history[n - 1];
  let start = n - 1;
  while (start > 0) {
    const prev = history[start - 1];
    if (prev.t > history[start].t || newest.t - prev.t > windowSec) break;
    start--;
  }
  const run = history.slice(start);
  if (run.length <= maxPoints) return run;
  const step = (run.length - 1) / (maxPoints - 1);
  const out: TickSnapshot[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(run[Math.round(i * step)]);
  return out;
}

export interface SparklineGeometry {
  /** SVG path `d` (empty with < 2 points). */
  d: string;
  /** Upper bound of the y scale (the lower bound is 0). */
  max: number;
  /** Screen coordinates of every point, for hover readouts. */
  points: { x: number; y: number }[];
}

/**
 * Line path for `values` in a `width` × `height` box: x spread evenly, y
 * scaled over [0, max] (a zero baseline, so a flat line reads as "flat", not
 * as "maximum"). Non-finite values are treated as 0. `pad` keeps the 2 px
 * stroke inside the box.
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  pad = 1,
): SparklineGeometry {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = clean.reduce((m, v) => Math.max(m, v), 0);
  if (clean.length < 2) return { d: "", max, points: [] };
  const innerW = Math.max(0, width - 2 * pad);
  const innerH = Math.max(0, height - 2 * pad);
  const points = clean.map((v, i) => ({
    x: round2(pad + (i / (clean.length - 1)) * innerW),
    y: round2(pad + innerH - (max > 0 ? v / max : 0) * innerH),
  }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return { d, max, points };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ---------- formatting ---------- */

/** Compact K/M/B abbreviation (Grafana-style). */
export function abbrev(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  const a = Math.abs(n);
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ""));
  if (a >= 1e9) return fmt(n / 1e9) + "B";
  if (a >= 1e6) return fmt(n / 1e6) + "M";
  if (a >= 1e3) return fmt(n / 1e3) + "K";
  return a > 0 && a < 10 ? n.toFixed(1).replace(/\.0$/, "") : String(Math.round(n));
}

/** Milliseconds with sensible precision (0.42 ms, 12 ms, 1.2 s). */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "∞";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(0)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 10) return `${ms.toFixed(0)} ms`;
  return `${ms.toFixed(ms >= 1 ? 1 : 2)} ms`;
}

/** Percentage of a 0–1 ratio, with more digits near 0 / 100. */
export function fmtPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.1) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(digits)}%`;
}
