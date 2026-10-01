import type { Node, Edge } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import { instancesOf, PARAM } from "@/domain/components/registry";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { CategoryScore, Measurements, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE, PEAK_UTILIZATION, SLO_ERROR_RATE } from "../budget";
import { INHERENTLY_REDUNDANT, syncPath } from "../paths";
import { hottest, metricsOf, NO_TRAFFIC_FEEDBACK, noTraffic, pct, rps } from "../steady";

/**
 * Measured (Spec 09): the design holds the problem's peak with headroom and
 * a 2× surge, and its stateless tiers scale out. Max points per check; sums
 * to CATEGORY_MAX_SCORE (checked in tests/unit/scoring.test.ts).
 */
export const BUDGET = {
  holdsPeak: 8,
  holdsDoublePeak: 8,
  horizontal: 4,
} as const;

/** Partial credit for a check that is only half met (always below its BUDGET). */
export const PARTIAL = {
  holdsPeak: 4,
  holdsDoublePeak: 4,
  horizontal: 2,
} as const satisfies Partial<Record<keyof typeof BUDGET, number>>;

/** A 2× surge may run a tier hot, but not past saturation, and errors stay under this. */
const SURGE_PARTIAL_ERROR_RATE = 0.05;

export function scoreScalability(
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
    return { category: "Scalability", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
  }
  if (!m) {
    feedback.push(
      "Scalability is measured by simulating your design at the problem's peak; the simulation didn't run.",
    );
  } else {
    // 1× peak with headroom
    const peak = metricsOf(m.atPeak, connected);
    const maxUtil = Math.max(0, ...peak.map((x) => x.m.utilization));
    const peakOk = m.atPeak.errorRate <= SLO_ERROR_RATE;
    if (peakOk && maxUtil < PEAK_UTILIZATION) {
      score += BUDGET.holdsPeak;
      passed.push(
        `Holds the peak (${rps(m.peakRps)} rps) with headroom: errors ${pct(m.atPeak.errorRate)}, busiest tier at ${pct(maxUtil)}.`,
      );
    } else if (peakOk && maxUtil < 1) {
      score += PARTIAL.holdsPeak;
      feedback.push(
        `Holds the peak (${rps(m.peakRps)} rps) but without headroom: ${hottest(peak, PEAK_UTILIZATION)}. Keep every tier under ${pct(PEAK_UTILIZATION)} so a slow instance or a small burst doesn't tip it over — add instances or capacity there.`,
      );
    } else {
      feedback.push(
        `Doesn't hold the peak (${rps(m.peakRps)} rps): ${pct(m.atPeak.errorRate)} of requests fail${
          maxUtil >= 1 ? `; saturated: ${hottest(peak, 1)}` : ""
        }. Size each tier for its load: instances × capacity per instance must exceed the requests it receives.`,
      );
    }

    // 2× surge
    const surge = metricsOf(m.atDoublePeak, connected);
    const surgeMax = Math.max(0, ...surge.map((x) => x.m.utilization));
    if (m.atDoublePeak.errorRate <= SLO_ERROR_RATE && surgeMax < 1) {
      score += BUDGET.holdsDoublePeak;
      passed.push(
        `Survives a 2× surge (${rps(2 * m.peakRps)} rps) without errors: busiest tier at ${pct(surgeMax)}.`,
      );
    } else if (m.atDoublePeak.errorRate <= SURGE_PARTIAL_ERROR_RATE) {
      score += PARTIAL.holdsDoublePeak;
      feedback.push(
        `A 2× surge (${rps(2 * m.peakRps)} rps) degrades it: ${pct(m.atDoublePeak.errorRate)} errors${
          surgeMax >= 1 ? `, ${hottest(surge, 1)} saturated` : ""
        }. Leave room for bursts (launches, retries) or shed load at the edge with a rate limiter.`,
      );
    } else {
      feedback.push(
        `A 2× surge (${rps(2 * m.peakRps)} rps) breaks it: ${pct(m.atDoublePeak.errorRate)} of requests fail (${hottest(surge, 1) || "overloaded tiers"}). Real traffic bursts well above the average peak; size for it or shed the excess at the edge.`,
      );
    }
  }

  // Stateless tiers on the request path scale out (instances ≥ 2 or autoscaling).
  const path = syncPath(nodes, edges, graph);
  const stateless = connected.filter(
    (n) =>
      path.onPath.has(n.id) &&
      !INHERENTLY_REDUNDANT.has(n.data.componentId) &&
      getComponentById(n.data.componentId)?.stateful === false,
  );
  const scaled = stateless.filter(
    (n) => instancesOf(n.data) >= 2 || n.data.params?.[PARAM.autoscale] === true,
  );
  if (stateless.length > 0 && scaled.length === stateless.length) {
    score += BUDGET.horizontal;
    passed.push(
      "Every stateless tier on the request path runs several instances (or autoscales), so capacity grows by adding machines.",
    );
  } else if (stateless.length > 0 && scaled.length * 2 >= stateless.length) {
    score += PARTIAL.horizontal;
    feedback.push(
      `Some stateless tiers run a single instance with no autoscaling: ${stateless
        .filter((n) => !scaled.includes(n))
        .map((n) => n.data.label)
        .join(
          ", ",
        )}. Stateless tiers are the cheapest to scale out — run at least two behind a load balancer.`,
    );
  } else if (stateless.length > 0) {
    feedback.push(
      "Most stateless tiers run a single instance. Run at least two instances (or enable autoscaling) so you scale by adding machines and survive losing one.",
    );
  } else {
    feedback.push(
      "No stateless compute tier on the request path — add the application tier (e.g. App Server) behind your entry point.",
    );
  }

  return { category: "Scalability", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}
