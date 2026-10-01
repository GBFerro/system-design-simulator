import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import { instancesOf } from "@/domain/components/registry";
import type { CategoryScore, Measurements, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE, OVERPROVISIONED_UTILIZATION } from "../budget";
import { metricsOf, NO_TRAFFIC_FEEDBACK, noTraffic, pct, rps } from "../steady";
import { estimateCost } from "@/cost/estimate";
import { formatMoney } from "@/cost/currency";

/**
 * Spec 10 (CST-05): 12 points for the design's monthly cost at the peak
 * staying within the problem's budget (linear down to 0 at twice it) and 8
 * for not over-provisioning (Spec 09). Both are measured. Max points per
 * check; sums to CATEGORY_MAX_SCORE (checked in tests/unit/scoring.test.ts).
 */
export const BUDGET = {
  withinBudget: 12,
  noOverprovisioning: 8,
} as const;

/** Partial credit for a check that is only half met (always below its BUDGET). */
export const PARTIAL = {
  noOverprovisioning: 4,
} as const satisfies Partial<Record<keyof typeof BUDGET, number>>;

/**
 * Points for costing `ratio` × the budget: full up to 1, then linear down to
 * 0 at 2 (rounded down, so any overspend loses at least a point).
 */
export function budgetPoints(ratio: number): number {
  if (ratio <= 1) return BUDGET.withinBudget;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(
    0,
    Math.min(BUDGET.withinBudget - 1, Math.floor(BUDGET.withinBudget * (2 - ratio))),
  );
}

export function scoreCost(
  nodes: Node<ComponentNodeData>[],
  _edges: Edge[],
  graph: ScoringGraph,
  m?: Measurements,
): CategoryScore {
  const feedback: string[] = [];
  const passed: string[] = [];
  let score = 0;

  const connectedNodes = nodes.filter((n) => graph.reachable.has(n.id));

  // Monthly cost at the peak against the budget. Every node counts, reachable
  // or not: an idle component is still paid for.
  if (!m || noTraffic(m)) {
    feedback.push(
      m
        ? NO_TRAFFIC_FEEDBACK
        : "Cost is measured by simulating your design at the problem's peak and pricing what each component handles; the simulation didn't run.",
    );
  } else if (m.budgetMonthlyUsd === undefined) {
    feedback.push(
      "This problem has no monthly budget, so the cost isn't judged. Give the problem a budget to score it.",
    );
  } else {
    const offered = new Map(m.atPeak.nodes.map((n) => [n.nodeId, n.offeredRps]));
    const estimate = estimateCost(nodes, (id) => offered.get(id) ?? 0);
    const budget = m.budgetMonthlyUsd;
    const ratio = estimate.monthly / budget;
    const top = estimate.lines
      .filter((l) => l.monthly > 0)
      .slice(0, 3)
      .map((l) => `${l.label} ${formatMoney(l.monthly)}`)
      .join(", ");
    score += budgetPoints(ratio);
    const costs = `Costs ${formatMoney(estimate.monthly)}/month at the peak (${rps(m.peakRps)} rps)`;
    if (ratio <= 1) {
      passed.push(
        `${costs}, within the ${formatMoney(budget)} budget (${pct(ratio)} of it). Biggest lines: ${top || "none"}.`,
      );
    } else {
      feedback.push(
        `${costs}: ${pct(ratio - 1)} over the ${formatMoney(budget)} budget. Biggest lines: ${top}. Per-request services (CDN, managed gateways, object storage) grow with traffic; caching and batching cut them, and right-sizing trims idle instances.`,
      );
    }
  }

  // Measured: no tier keeps an instance it doesn't need at the peak (with one
  // fewer it would still run under OVERPROVISIONED_UTILIZATION).
  // Without traffic nothing is sized by load (the budget check already said why).
  if (!m || connectedNodes.length === 0 || noTraffic(m)) {
    if (m && !noTraffic(m)) {
      feedback.push(
        "Over-provisioning is measured by simulating your design at the problem's peak; there's nothing to measure yet.",
      );
    }
  } else {
    // Nodes without traffic (control planes such as a quorum) aren't sized by load.
    const idle = metricsOf(m.atPeak, connectedNodes).filter(({ node, m: nm }) => {
      const n = instancesOf(node.data);
      return (
        nm.offeredRps > 0 && n >= 3 && (nm.utilization * n) / (n - 1) < OVERPROVISIONED_UTILIZATION
      );
    });
    if (idle.length === 0) {
      score += BUDGET.noOverprovisioning;
      passed.push("No tier is over-provisioned at the peak: every instance earns its keep.");
    } else {
      if (idle.length === 1) score += PARTIAL.noOverprovisioning;
      feedback.push(
        `Over-provisioned at the peak: ${idle
          .map(
            ({ node, m: nm }) =>
              `${node.data.label} (${instancesOf(node.data)} instances at ${pct(nm.utilization)})`,
          )
          .join(
            ", ",
          )}. Even with one instance fewer it would idle under ${pct(OVERPROVISIONED_UTILIZATION)} — scale it in (or autoscale) and keep the headroom where the load is.`,
      );
    }
  }

  return { category: "Cost Efficiency", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}
