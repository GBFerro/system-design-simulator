/**
 * Queueing primitives (Spec 04, "Fórmulas").
 *
 * Every node is modelled as `instances` identical M/M/c stations behind an
 * even split (the LB in front spreads round-robin). Mapping from the Spec 03
 * params to M/M/c — `capacityPerInstance` stays THE capacity knob:
 *
 *   slots per instance  c = clamp(round(capacityPerInstance × serviceTimeMs / 1000), 1, MAX_SERVERS)
 *   rate per slot       μ = capacityPerInstance / c              (req/s)
 *   per-instance load   λᵢ = λ / instances
 *   utilization         ρ = λᵢ / (c·μ) = λ / (instances × capacityPerInstance)
 *
 * So c·μ is exactly the configured capacity, and c is the concurrency Little's
 * law implies (in-flight = throughput × service time). The service-time part
 * of a hop's latency is the configured `serviceTimeMs` (exponential, as in
 * M/M/c); only the waiting time comes from the queue.
 */
import { sampleExponential, type Rng } from "./rng";

/**
 * Upper bound on c per instance. Erlang B is O(c); above this the station is
 * aggregated into MAX_SERVERS faster slots (same total capacity), which only
 * makes the queueing estimate slightly conservative.
 */
export const MAX_SERVERS = 2000;

/** Default observation horizon for overload (backlog grows for this long). */
export const DEFAULT_HORIZON_SEC = 10;

/**
 * Erlang B (blocking probability of M/M/c/c) via the stable recursion
 * B(0) = 1, B(k) = a·B(k−1) / (k + a·B(k−1)). Never computes aᶜ/c!.
 */
export function erlangB(c: number, a: number): number {
  const servers = Math.max(1, Math.floor(c));
  if (!(a > 0)) return 0;
  let b = 1;
  for (let k = 1; k <= servers; k++) b = (a * b) / (k + a * b);
  return b;
}

/**
 * Erlang C: probability an arrival has to wait in M/M/c, with offered load
 * a = λ/μ. Computed from Erlang B: C = B / (1 − ρ(1 − B)), ρ = a/c.
 * Returns 1 when ρ ≥ 1 (no steady state: everyone waits).
 */
export function erlangC(c: number, a: number): number {
  const servers = Math.max(1, Math.floor(c));
  if (!(a > 0)) return 0;
  const rho = a / servers;
  if (rho >= 1) return 1;
  const b = erlangB(servers, a);
  return b / (1 - rho * (1 - b));
}

/** Retry amplification: λ_ef = λ(1 − f^{R+1}) / (1 − f). Returns the factor. */
export function retryAmplification(failureFraction: number, maxRetries: number): number {
  const r = Math.max(0, Math.floor(Number.isFinite(maxRetries) ? maxRetries : 0));
  const f = Number.isFinite(failureFraction) ? Math.min(1, Math.max(0, failureFraction)) : 0;
  if (r === 0) return 1;
  if (f >= 1 - 1e-12) return r + 1;
  return (1 - f ** (r + 1)) / (1 - f);
}

/** Tiers in series: every one must be up. */
export function seriesAvailability(parts: readonly number[]): number {
  let a = 1;
  for (const p of parts) a *= clamp01(p);
  return a;
}

/** Redundant replicas in parallel: up while at least one is up. */
export function parallelAvailability(parts: readonly number[]): number {
  let down = 1;
  for (const p of parts) down *= 1 - clamp01(p);
  return 1 - down;
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/* ---------- station (one node) ---------- */

export interface StationInput {
  /** Offered load, req/s. */
  lambda: number;
  instances: number;
  capacityPerInstance: number;
  serviceTimeMs: number;
  /** Max requests waiting (whole node). 0 = no buffer (loss system); Infinity = unbounded. */
  maxQueue: number;
  horizonSec: number;
}

export type StationRegime = "stable" | "overloaded" | "loss";

export interface StationState {
  regime: StationRegime;
  /** instances × capacityPerInstance, req/s. */
  capacityRps: number;
  /** λ / capacity (can exceed 1). */
  utilization: number;
  servedRps: number;
  /** Dropped / rejected, req/s. */
  unservedRps: number;
  /** Slots (c) per instance. */
  servers: number;
  /** P(wait > 0) — Erlang C when stable, 1 when overloaded. */
  waitProbability: number;
  meanWaitMs: number;
  /** Requests waiting (whole node). */
  queueDepth: number;
  serviceTimeMs: number;
  /** Stable: cμ − λᵢ in 1/ms (exponential tail of the wait). */
  drainPerMs: number;
  /** Overloaded: every served request waits this long (full backlog, FIFO). */
  fixedWaitMs: number;
  /** Waits never exceed this (the horizon, or the time to drain a full maxQueue). */
  waitCapMs: number;
}

function finitePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Steady state of one node under offered load λ. Total: never throws, always finite. */
export function station(input: StationInput): StationState {
  const lambda = Number.isFinite(input.lambda) && input.lambda > 0 ? input.lambda : 0;
  const instances = Math.max(1, Math.round(finitePositive(input.instances, 1)));
  const k = finitePositive(input.capacityPerInstance, 1);
  const serviceTimeMs = finitePositive(input.serviceTimeMs, 1);
  const horizonSec = finitePositive(input.horizonSec, DEFAULT_HORIZON_SEC);
  const maxQueue =
    input.maxQueue === Infinity
      ? Infinity
      : Number.isFinite(input.maxQueue) && input.maxQueue >= 0
        ? input.maxQueue
        : Infinity;

  const capacityRps = instances * k;
  const servers = Math.min(MAX_SERVERS, Math.max(1, Math.round((k * serviceTimeMs) / 1000)));
  const mu = k / servers;
  const lambdaI = lambda / instances;
  const a = lambdaI / mu;
  const utilization = lambda / capacityRps;
  const waitCapMs = Math.min(horizonSec * 1000, (maxQueue / capacityRps) * 1000);

  const base = {
    capacityRps,
    utilization,
    servers,
    serviceTimeMs,
    waitCapMs,
  };

  if (lambda === 0) {
    return {
      ...base,
      regime: "stable",
      servedRps: 0,
      unservedRps: 0,
      waitProbability: 0,
      meanWaitMs: 0,
      queueDepth: 0,
      drainPerMs: k / 1000,
      fixedWaitMs: 0,
    };
  }

  // No buffer: M/M/c/c, blocked arrivals are lost (Erlang B).
  if (maxQueue === 0) {
    const blocked = erlangB(servers, a);
    const served = Math.min(lambda * (1 - blocked), capacityRps);
    return {
      ...base,
      regime: "loss",
      servedRps: served,
      unservedRps: lambda - served,
      waitProbability: 0,
      meanWaitMs: 0,
      queueDepth: 0,
      drainPerMs: 0,
      fixedWaitMs: 0,
    };
  }

  if (utilization < 1) {
    const c = erlangC(servers, a);
    const drainPerMs = (k - lambdaI) / 1000;
    const meanWaitMs = Math.min(c / drainPerMs, waitCapMs);
    const queueDepth = Math.min(maxQueue, lambda * (meanWaitMs / 1000));
    return {
      ...base,
      regime: "stable",
      servedRps: lambda,
      unservedRps: 0,
      waitProbability: c,
      meanWaitMs,
      queueDepth,
      drainPerMs,
      fixedWaitMs: 0,
    };
  }

  // ρ ≥ 1: the backlog grows at (λ − cμ) until maxQueue; the excess is lost.
  // Served requests wait behind the full backlog: W ≈ Q / cμ.
  const excess = lambda - capacityRps;
  const queueDepth = Math.min(maxQueue, excess * horizonSec);
  const fixedWaitMs = Math.min((queueDepth / capacityRps) * 1000, waitCapMs);
  return {
    ...base,
    regime: "overloaded",
    servedRps: capacityRps,
    unservedRps: excess,
    waitProbability: 1,
    meanWaitMs: fixedWaitMs,
    queueDepth,
    drainPerMs: 0,
    fixedWaitMs,
  };
}

/**
 * Percentile p of the queue wait: W_q(p) = max(0, ln(C/(1−p)) / (cμ − λ)).
 * Overloaded: the full-backlog wait. Loss system: 0.
 */
export function waitPercentileMs(st: StationState, p: number): number {
  if (st.regime === "overloaded") return st.fixedWaitMs;
  if (st.regime === "loss" || st.waitProbability <= 0 || st.drainPerMs <= 0) return 0;
  const q = Math.min(Math.max(p, 0), 1 - 1e-12);
  const w = Math.log(st.waitProbability / (1 - q)) / st.drainPerMs;
  return Math.min(Math.max(0, w), st.waitCapMs);
}

/** Percentile p of the exponential service time with the configured mean. */
export function servicePercentileMs(serviceTimeMs: number, p: number): number {
  const q = Math.min(Math.max(p, 0), 1 - 1e-12);
  return -serviceTimeMs * Math.log(1 - q);
}

/** Hop latency percentile: L_p ≈ S_p + W_q(p) (Spec 04; conservative sum of percentiles). */
export function hopPercentileMs(st: StationState, p: number): number {
  return servicePercentileMs(st.serviceTimeMs, p) + waitPercentileMs(st, p);
}

/** P(W_q > t). */
export function probWaitExceeds(st: StationState, tMs: number): number {
  if (tMs < 0) return 1;
  if (st.regime === "overloaded") return st.fixedWaitMs > tMs ? 1 : 0;
  if (st.regime === "loss" || st.drainPerMs <= 0) return 0;
  if (tMs >= st.waitCapMs) return 0;
  return Math.min(1, st.waitProbability * Math.exp(-st.drainPerMs * tMs));
}

/**
 * P(hop latency > timeout), approximated as P(S > T) + P(W_q > T − S̄):
 * a request times out if its service alone is too slow, or if it queued
 * longer than what's left after an average service.
 */
export function probSojournExceeds(st: StationState, timeoutMs: number): number {
  if (!(timeoutMs > 0)) return 1;
  const slowService = Math.exp(-timeoutMs / st.serviceTimeMs);
  return Math.min(1, slowService + probWaitExceeds(st, timeoutMs - st.serviceTimeMs));
}

/** One sampled queue wait (ms), consistent with the analytic distribution. */
export function sampleWaitMs(st: StationState, rng: Rng): number {
  if (st.regime === "overloaded") return st.fixedWaitMs;
  if (st.regime === "loss" || st.waitProbability <= 0 || st.drainPerMs <= 0) return 0;
  if (rng() >= st.waitProbability) return 0;
  return Math.min(sampleExponential(rng, 1 / st.drainPerMs), st.waitCapMs);
}

/** One sampled service time (ms). */
export function sampleServiceMs(st: StationState, rng: Rng): number {
  return sampleExponential(rng, st.serviceTimeMs);
}
