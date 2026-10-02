/**
 * Circuit breaker state machine for the tick loop (Spec 08, CHS-06), after
 * Resilience4j's CircuitBreaker:
 *
 * - closed: everything passes; the failure rate of the calls it forwards
 *   (errors and timeouts downstream, its own `timeoutMs` included) is
 *   tracked over about the last BREAKER_WINDOW_CALLS calls (exponentially
 *   weighted by call count, like Resilience4j's count-based sliding window).
 *   Once the window holds `minimumCalls` and the rate reaches
 *   `errorThreshold`, it opens.
 * - open: every call fails fast (no wait, nothing reaches the dependency) for
 *   `openDurationSec`, then half-open.
 * - half-open: lets `halfOpenProbes` calls through (the rest fail fast); if
 *   their failure rate is under the threshold it closes, else it opens again.
 *
 * Pure and deterministic (no random numbers). `analyze()` (steady state)
 * treats a breaker as closed: opening is a transient reaction.
 */
import { PARAM } from "@/domain/components/params";
import type { SimNode } from "@/domain/graph/compile";
import type { BreakerState } from "../types";
import { paramNumber } from "./routing";

/** Calls the closed breaker's failure rate looks back over (Resilience4j's default window: 100). */
export const BREAKER_WINDOW_CALLS = 100;

export interface BreakerParams {
  threshold: number;
  openSec: number;
  probes: number;
  minimumCalls: number;
}

export interface Breaker {
  state: BreakerState;
  /** Simulated time the current state began. */
  since: number;
  /** Calls in the window (closed) or probes so far (half-open). */
  calls: number;
  failed: number;
}

export function closedBreaker(now = 0): Breaker {
  return { state: "closed", since: now, calls: 0, failed: 0 };
}

export function breakerParams(node: SimNode): BreakerParams {
  return {
    threshold: Math.min(1, Math.max(0.01, paramNumber(node, PARAM.errorThreshold, 0.5))),
    openSec: Math.max(0, paramNumber(node, PARAM.openDurationSec, 60)),
    probes: Math.max(1, Math.round(paramNumber(node, PARAM.halfOpenProbes, 10))),
    minimumCalls: Math.max(1, Math.round(paramNumber(node, PARAM.minimumCalls, 100))),
  };
}

/** Requests per second the breaker lets through this tick, out of `arriving`. */
export function breakerAdmits(
  b: Breaker,
  p: BreakerParams,
  arriving: number,
  dtSec: number,
): number {
  if (b.state === "closed") return arriving;
  if (b.state === "open") return 0;
  return Math.min(arriving, Math.max(0, p.probes - b.calls) / dtSec);
}

/**
 * The breaker after a tick in which `passedRps` went through and each of
 * those calls failed with probability `failure`; `now` is the time at the
 * end of the tick.
 */
export function advanceBreaker(
  b: Breaker,
  p: BreakerParams,
  passedRps: number,
  failure: number,
  now: number,
  dtSec: number,
): Breaker {
  const calls = Math.max(0, passedRps) * dtSec;
  const failed = calls * Math.min(1, Math.max(0, failure));
  switch (b.state) {
    case "open":
      return now - b.since >= p.openSec - 1e-9
        ? { state: "half-open", since: now, calls: 0, failed: 0 }
        : b;
    case "half-open": {
      const next = { ...b, calls: b.calls + calls, failed: b.failed + failed };
      if (next.calls < p.probes - 1e-9) return next;
      return next.failed / next.calls >= p.threshold
        ? { state: "open", since: now, calls: 0, failed: 0 }
        : closedBreaker(now);
    }
    default: {
      const decay = Math.exp(-calls / BREAKER_WINDOW_CALLS);
      const next = { ...b, calls: b.calls * decay + calls, failed: b.failed * decay + failed };
      return next.calls >= p.minimumCalls && next.failed / next.calls >= p.threshold
        ? { state: "open", since: now, calls: 0, failed: 0 }
        : next;
    }
  }
}
