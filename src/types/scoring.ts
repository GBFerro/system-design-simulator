import type { SteadyState } from "@/engine/types";
import type { Slo } from "@/slo/types";

/**
 * Connectivity context computed once per scoring run and shared by all rules.
 * Built from component nodes only — edges referencing unknown nodes (e.g. text
 * annotations) and self-loops are excluded, and parallel edges are deduped.
 */
export interface ScoringGraph {
  /** Directed adjacency between component nodes. */
  adjacency: Map<string, string[]>;
  /**
   * Node ids reachable from entry nodes (in-degree 0 with at least one
   * outgoing edge). Empty when the canvas has no edges, unless the canvas
   * holds exactly one node.
   */
  reachable: Set<string>;
}

export interface CategoryScore {
  category: string;
  score: number; // 0-20
  maxScore: number; // 20
  feedback: string[];
  passed: string[];
}

export interface ScoreResult {
  total: number; // 0-100
  categories: CategoryScore[];
  verdict: string;
  verdictColor: string;
  summary: string;
}

/**
 * What the measured rubric (Spec 09) scores against: the design simulated by
 * `analyze()` at the problem's peak and twice it, and under the problem's
 * drill faults. Built by `scoring/measure.ts`; without it the measured checks
 * score 0 and say why.
 */
export interface Measurements {
  /** Load of the problem's peak, req/s (reference peak until phase 2 captures an estimate). */
  peakRps: number;
  /**
   * The problem's SLO (Spec 11): the latency target (percentile, threshold,
   * `scope` = component whose hop it refers to, else end to end) and the
   * availability whose error budget the failure scenarios must fit in.
   */
  slo: Slo;
  atPeak: SteadyState;
  atDoublePeak: SteadyState;
  /** The drill's faults in steady state (outside an interview), each lasting `durationSec`. */
  underFaults: { label: string; errorRate: number; durationSec: number }[];
  /** A finished interview drill: faults whose SLO held before they ended. */
  drill?: { held: number; total: number };
  /** Deepest sync path of the problem's reference solution, for the hop check. */
  referenceSyncDepth?: number;
  /**
   * Monthly budget in USD at this peak (Spec 10): the problem's, scaled up
   * when the measured peak is above the reference one. Absent → cost unjudged.
   */
  budgetMonthlyUsd?: number;
}
