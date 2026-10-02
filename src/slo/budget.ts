/**
 * Error budget and burn rate of a run (Spec 11, SLO-02). Pure: fed the run's
 * snapshots (oldest → newest), as `runtimeStore` keeps them.
 *
 * Each snapshot stands for the simulated time since the previous one. Per SLI:
 * - burn rate = bad share over the last BURN_WINDOW_SEC ÷ the SLI's budget
 *   fraction (1 = spending the budget exactly by the end of the window);
 * - budget consumed = bad requests in the trailing window ÷ the budget of a
 *   whole window at the observed request rate, so ten bad seconds at the start
 *   of a run already count against the 5 minutes.
 * The SLO is violated once either SLI has consumed its whole budget; the
 * verdict keeps the first moment that happened.
 */
import type { TickSnapshot } from "@/engine/types";
import { budgetFraction } from "./slo";
import { BURN_WINDOW_SEC, type Sli, type Slo } from "./types";

export interface SloPoint {
  t: number;
  /** Burn rate of the binding SLI over the short window. */
  burn: number;
}

export interface SloEvaluation {
  /** At least one snapshot that covered simulated time with traffic. */
  hasData: boolean;
  /** Simulated time of the newest snapshot. */
  t: number;
  /** Budget consumed over the trailing window per SLI (1 = all of it). */
  consumed: Record<Sli, number>;
  /** Burn rate over the last BURN_WINDOW_SEC per SLI. */
  burn: Record<Sli, number>;
  /** max(consumed): what's left is 1 − this (≤ 0 = exhausted). */
  budgetUsed: number;
  /** max(burn). */
  burnRate: number;
  /** The SLI behind `budgetUsed`. */
  binding: Sli;
  /** Worst short-window burn rate of the run. */
  worstBurn: number;
  verdict: "met" | "violated";
  /** First moment a budget ran out. */
  breach?: { t: number; sli: Sli };
  /** Burn rate over time, at most `maxPoints` (the worst of each bucket). */
  series: SloPoint[];
}

/** Bad shares of one snapshot: failed requests, and slow ones among the successes. */
export function badShares(s: Pick<TickSnapshot, "global">): { failed: number; slow: number } {
  const g = s.global;
  const failed = Math.min(1, Math.max(0, g.errorRate));
  const slow = g.throughput > 0 ? Math.min(1, Math.max(0, 1 - g.goodput / g.throughput)) : 0;
  return { failed, slow };
}

interface Running {
  t: number[];
  /** Prefix sums (index i = totals up to and including snapshot i). */
  sec: number[];
  requests: number[];
  failed: number[];
  ok: number[];
  slow: number[];
}

function prefixSums(history: readonly TickSnapshot[]): Running {
  const r: Running = { t: [], sec: [], requests: [], failed: [], ok: [], slow: [] };
  let prevT = 0;
  let sec = 0;
  let req = 0;
  let failed = 0;
  let ok = 0;
  let slow = 0;
  for (const s of history) {
    const dt = Math.max(0, s.t - prevT);
    prevT = Math.max(prevT, s.t);
    const n = Math.max(0, s.offeredRps) * dt;
    const bad = badShares(s);
    sec += dt;
    req += n;
    failed += n * bad.failed;
    ok += n * (1 - bad.failed);
    slow += n * (1 - bad.failed) * bad.slow;
    r.t.push(s.t);
    r.sec.push(sec);
    r.requests.push(req);
    r.failed.push(failed);
    r.ok.push(ok);
    r.slow.push(slow);
  }
  return r;
}

const at = (a: number[], i: number) => (i < 0 ? 0 : a[i]);

/** Totals over snapshots (from, to]. */
function span(r: Running, from: number, to: number) {
  return {
    sec: r.sec[to] - at(r.sec, from),
    requests: r.requests[to] - at(r.requests, from),
    failed: r.failed[to] - at(r.failed, from),
    ok: r.ok[to] - at(r.ok, from),
    slow: r.slow[to] - at(r.slow, from),
  };
}

function burnOf(w: ReturnType<typeof span>, slo: Slo): Record<Sli, number> {
  return {
    availability: w.requests > 0 ? w.failed / w.requests / budgetFraction(slo, "availability") : 0,
    latency: w.ok > 0 ? w.slow / w.ok / budgetFraction(slo, "latency") : 0,
  };
}

/** Budget consumed over a window that observed `w.sec` of a `windowSec` window. */
function consumedOf(w: ReturnType<typeof span>, slo: Slo): Record<Sli, number> {
  const burn = burnOf(w, slo);
  const share = Math.min(1, w.sec / slo.windowSec);
  return { availability: burn.availability * share, latency: burn.latency * share };
}

const worst = (x: Record<Sli, number>): Sli =>
  x.latency > x.availability ? "latency" : "availability";

export function evaluateSlo(
  history: readonly TickSnapshot[],
  slo: Slo,
  maxPoints = 240,
): SloEvaluation {
  const empty: SloEvaluation = {
    hasData: false,
    t: history.length > 0 ? history[history.length - 1].t : 0,
    consumed: { availability: 0, latency: 0 },
    burn: { availability: 0, latency: 0 },
    budgetUsed: 0,
    burnRate: 0,
    binding: "availability",
    worstBurn: 0,
    verdict: "met",
    series: [],
  };
  const r = prefixSums(history);
  const n = r.t.length;
  if (n === 0 || r.requests[n - 1] <= 0) return empty;

  let breach: SloEvaluation["breach"];
  let worstBurn = 0;
  const points: SloPoint[] = [];
  // Two pointers: the first snapshot inside each window (the one before it is excluded).
  let w = -1;
  let b = -1;
  let consumed = empty.consumed;
  let burn = empty.burn;
  for (let i = 0; i < n; i++) {
    while (w + 1 < i && r.t[w + 1] <= r.t[i] - slo.windowSec) w++;
    while (b + 1 < i && r.t[b + 1] <= r.t[i] - BURN_WINDOW_SEC) b++;
    consumed = consumedOf(span(r, w, i), slo);
    burn = burnOf(span(r, b, i), slo);
    const used = Math.max(consumed.availability, consumed.latency);
    const rate = Math.max(burn.availability, burn.latency);
    if (!breach && used >= 1) breach = { t: r.t[i], sli: worst(consumed) };
    worstBurn = Math.max(worstBurn, rate);
    points.push({ t: r.t[i], burn: rate });
  }

  return {
    hasData: true,
    t: r.t[n - 1],
    consumed,
    burn,
    budgetUsed: Math.max(consumed.availability, consumed.latency),
    burnRate: Math.max(burn.availability, burn.latency),
    binding: worst(consumed),
    worstBurn,
    verdict: breach ? "violated" : "met",
    ...(breach ? { breach } : {}),
    series: downsample(points, maxPoints),
  };
}

/** At most `max` points, keeping the worst burn of each bucket (spikes stay visible). */
function downsample(points: SloPoint[], max: number): SloPoint[] {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / max);
  const out: SloPoint[] = [];
  for (let i = 0; i < points.length; i += size) {
    let pick = points[i];
    for (let j = i + 1; j < Math.min(points.length, i + size); j++) {
      if (points[j].burn > pick.burn) pick = points[j];
    }
    out.push(pick);
  }
  return out;
}
