/**
 * Right-size (Spec 10, CST-03): instances per tier for ~45% utilization at
 * the current load, never fewer than 2 per tier (one spare to survive losing
 * an instance). The spec's ~55% would put the scored surge (SURGE_FACTOR =
 * 2× the peak, Spec 09) at 110%, past saturation: at 45% it runs at 90%.
 * `scoring.test.ts` right-sizes every reference and checks its score holds. Stateless tiers can be applied in one undo step; stateful
 * ones (databases, caches, brokers) only get a suggestion, because adding or
 * removing their nodes moves data. The advisor's quick fix (Spec 12) uses the
 * same calculation.
 */
import type { Node } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import { capacityPerInstanceOf, instancesOf, MAX_INSTANCES } from "@/domain/components/registry";
import { isComponentNode } from "@/lib/nodeFactory";
import { costLine } from "./estimate";

export const TARGET_UTILIZATION = 0.45;
export const MIN_INSTANCES_PER_TIER = 2;

export interface RightSizeSuggestion {
  nodeId: string;
  label: string;
  from: number;
  to: number;
  /** Load the tier handles, req/s. */
  rps: number;
  utilizationBefore: number;
  utilizationAfter: number;
  monthlyBefore: number;
  monthlyAfter: number;
  /** Stateless tier: applying it is just a change of instance count. */
  applicable: boolean;
}

/** max(2, ⌈λ / (0.45 × capacity per instance)⌉), capped at MAX_INSTANCES. */
export function suggestedInstances(rps: number, capacityPerInstance: number): number {
  const needed = Math.ceil(rps / (TARGET_UTILIZATION * capacityPerInstance));
  return Math.min(MAX_INSTANCES, Math.max(MIN_INSTANCES_PER_TIER, needed));
}

/**
 * One suggestion per tier whose instance count should change. Tiers without
 * load can't be sized from it, and tiers with no per-instance price (managed
 * per-request services, the client) have nothing to size.
 */
export function rightSize(
  nodes: readonly Node[],
  rpsOf: (nodeId: string) => number,
): RightSizeSuggestion[] {
  const out: RightSizeSuggestion[] = [];
  for (const node of nodes) {
    if (!isComponentNode(node)) continue;
    const rps = rpsOf(node.id);
    if (!Number.isFinite(rps) || rps <= 0) continue;
    const before = costLine(node, rps);
    if (before.pricing.perInstanceHour <= 0) continue;
    const capacity = capacityPerInstanceOf(node.data);
    const from = instancesOf(node.data);
    const to = suggestedInstances(rps, capacity);
    if (to === from) continue;
    const after = costLine(
      { ...node, data: { ...node.data, params: { ...node.data.params, instances: to } } },
      rps,
    );
    out.push({
      nodeId: node.id,
      label: node.data.label,
      from,
      to,
      rps,
      utilizationBefore: rps / (from * capacity),
      utilizationAfter: rps / (to * capacity),
      monthlyBefore: before.monthly,
      monthlyAfter: after.monthly,
      // Unknown types are treated as stateful: suggest, don't touch.
      applicable: getComponentById(node.data.componentId)?.stateful === false,
    });
  }
  return out;
}

/** Monthly change if every applicable suggestion were applied (negative = savings). */
export function rightSizeDelta(suggestions: readonly RightSizeSuggestion[]): number {
  return suggestions
    .filter((s) => s.applicable)
    .reduce((sum, s) => sum + s.monthlyAfter - s.monthlyBefore, 0);
}
