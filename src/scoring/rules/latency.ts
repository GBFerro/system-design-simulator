import type { Node, Edge } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { CategoryScore, Measurements, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE } from "../budget";
import { syncPath } from "../paths";
import { metricsOf, ms, NO_TRAFFIC_FEEDBACK, noTraffic, pct } from "../steady";

/**
 * Measured (Spec 09): the latency at the peak within the problem's SLO (its
 * percentile and threshold, Spec 11), a p50 well under the threshold, and no
 * unnecessary hops on the synchronous path. Max points per
 * check; sums to CATEGORY_MAX_SCORE (checked in tests/unit/scoring.test.ts).
 */
export const BUDGET = {
  target: 12,
  p50: 4,
  hops: 4,
} as const;

/** Partial credit for a check that is only half met (always below its BUDGET). */
export const PARTIAL = {
  target: 6,
  hops: 2,
} as const satisfies Partial<Record<keyof typeof BUDGET, number>>;

/** The SLO percentile within this × its threshold earns partial credit. */
const TARGET_PARTIAL_FACTOR = 1.5;
/** Latency of the few requests that succeed says little when most fail. */
const MEASURABLE_ERROR_RATE = 0.5;
/** Without a reference solution, a sync chain deeper than this is suspect. */
const DEFAULT_MAX_DEPTH = 6;

export function scoreLatency(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  graph: ScoringGraph,
  m?: Measurements,
): CategoryScore {
  const feedback: string[] = [];
  const passed: string[] = [];
  let score = 0;
  const connected = nodes.filter((n) => graph.reachable.has(n.id));

  if (connected.length === 0 || noTraffic(m)) {
    feedback.push(NO_TRAFFIC_FEEDBACK);
    return { category: "Latency", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
  }

  if (!m) {
    feedback.push(
      "Latency is measured by simulating your design at the problem's peak; the simulation didn't run.",
    );
  } else if (m.atPeak.errorRate > MEASURABLE_ERROR_RATE) {
    feedback.push(
      `At the peak ${pct(m.atPeak.errorRate)} of requests fail, so there's no meaningful latency to measure. Make the design hold its load first (see Scalability).`,
    );
  } else {
    // What the SLO is about: one component's hop, or the whole request, at its percentile (Spec 11).
    const { scope, percentile, thresholdMs: sla } = m.slo.latency;
    const at = (x: { p50Ms: number; p95Ms: number; p99Ms: number }) =>
      percentile === 50 ? x.p50Ms : percentile === 95 ? x.p95Ms : x.p99Ms;
    const scoped = scope
      ? metricsOf(
          m.atPeak,
          connected.filter((n) => n.data.componentId === scope),
        )
      : [];
    const scopeLabel = scope ? (getComponentById(scope)?.label ?? scope) : "";
    let tail = at(m.atPeak.latency);
    let p50 = m.atPeak.latency.p50Ms;
    let what = "End-to-end";
    if (scoped.length > 0) {
      tail = Math.max(...scoped.map((x) => at(x.m)));
      p50 = Math.max(...scoped.map((x) => x.m.p50Ms));
      what = scopeLabel;
    } else if (scope) {
      feedback.push(
        `This problem's SLO is about the ${scopeLabel}, and the design has none on the request path; measuring the whole request instead.`,
      );
    }
    const p = `p${percentile}`;

    if (tail <= sla) {
      score += BUDGET.target;
      passed.push(`${what} ${p} at the peak is ${ms(tail)}, within the ${ms(sla)} SLO.`);
    } else if (tail <= sla * TARGET_PARTIAL_FACTOR) {
      score += PARTIAL.target;
      feedback.push(
        `${what} ${p} at the peak is ${ms(tail)}, just over the ${ms(sla)} SLO. Trim the slowest hop on the path: cache hot reads, move work off the request (async), or add capacity where requests queue.`,
      );
    } else {
      feedback.push(
        `${what} ${p} at the peak is ${ms(tail)}, far over the ${ms(sla)} SLO. Tail latency adds up across synchronous hops and grows fast near saturation — shorten the path, cache, go async, and keep tiers well under full load.`,
      );
    }

    if (p50 <= sla / 2) {
      score += BUDGET.p50;
      passed.push(`The typical request (p50 ${ms(p50)}) stays well under the SLO.`);
    } else {
      feedback.push(
        `Even the typical request (p50 ${ms(p50)}) uses more than half of the ${ms(sla)} SLO, so the tail has no room. Cut the per-request work on the common path.`,
      );
    }
  }

  // Unnecessary hops: the deepest synchronous chain vs the reference solution's.
  const depth = syncPath(nodes, edges, graph).depth;
  const allowed = m?.referenceSyncDepth ?? DEFAULT_MAX_DEPTH;
  if (depth <= allowed) {
    score += BUDGET.hops;
    passed.push(`The synchronous path is ${depth} components deep — no unnecessary hops.`);
  } else if (depth <= allowed + 2) {
    score += PARTIAL.hops;
    feedback.push(
      `The deepest synchronous path has ${depth} components (the reference needs ${allowed}). Each hop adds a network round trip and its own tail; make calls the user doesn't wait for asynchronous.`,
    );
  } else {
    feedback.push(
      `The deepest synchronous path has ${depth} components (the reference needs ${allowed}). Long synchronous chains multiply latency and failure risk — flatten them or move steps behind a queue.`,
    );
  }

  return { category: "Latency", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}
