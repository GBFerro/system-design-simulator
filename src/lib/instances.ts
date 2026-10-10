/**
 * Instances of an expanded node (Spec 07, OBS-04): the cards it opens into,
 * the ids of the edges drawn to them, and which instances are down under the
 * live run's faults. Pure; `components/canvas/instanceGraph.ts` builds the
 * ReactFlow elements and `lib/flowBalls.ts` routes balls over them.
 */
import { MANAGED_MULTI_ZONE } from "@/domain/components/traits";
import { returnIdOf } from "@/domain/graph/returns";
import type { FaultRecord } from "@/engine/faults/types";

/** Instance cards an expanded node shows before the rest go into one stacked card. */
export const MAX_INSTANCE_CARDS = 4;

/** Prefix of the ids of instance cards and of the edges drawn to them. */
export const INSTANCE_PREFIX = "inst:";

export const isInstanceId = (id: string) => id.startsWith(INSTANCE_PREFIX);

/**
 * Cards (lanes) for `instances`: one per instance up to MAX + 1; beyond that,
 * MAX cards plus one stacked card holding the rest (`stacked` instances).
 */
export function instanceLanes(instances: number): { lanes: number; stacked: number } {
  const n = Math.max(0, Math.floor(instances));
  if (n <= MAX_INSTANCE_CARDS + 1) return { lanes: n, stacked: 0 };
  return { lanes: MAX_INSTANCE_CARDS + 1, stacked: n - MAX_INSTANCE_CARDS };
}

/** The card instance `index` is drawn in (the stacked card holds the overflow). */
export function laneOf(index: number, instances: number): number {
  const { stacked } = instanceLanes(instances);
  return stacked > 0 ? Math.min(index, MAX_INSTANCE_CARDS) : index;
}

/** Id of the card of `lane` of node `nodeId`. */
export const instanceNodeId = (nodeId: string, lane: number) =>
  `${INSTANCE_PREFIX}${nodeId}:${lane}`;

/**
 * Id of the drawn edge for `edgeId` between source lane `from` and target lane
 * `to` (−1 = that end isn't expanded). Both −1: the edge itself.
 */
/**
 * What is drawn for the response to the call drawn as `drawn` (RET-16): the
 * response edge `ret:<id>`, or its copy between the same two cards, the
 * callee's lane first (a response runs from the callee to the caller).
 */
export function responseDrawnId(drawn: string): string {
  const m = /^inst:(.*):(-?\d+):(-?\d+)$/.exec(drawn);
  return m ? instanceEdgeId(returnIdOf(m[1]), Number(m[3]), Number(m[2])) : returnIdOf(drawn);
}

export function instanceEdgeId(edgeId: string, from: number, to: number): string {
  return from < 0 && to < 0 ? edgeId : `${INSTANCE_PREFIX}${edgeId}:${from}:${to}`;
}

/**
 * Which instances of the node the active faults took down, mirroring the
 * catalog: kill-node takes all, kill-instances the last k, a zone outage the
 * instances 0, z, 2z, … it held (managed multi-zone services ride it out).
 */
export function downInstances(
  faults: readonly FaultRecord[],
  nodeId: string,
  componentId: string,
  instances: number,
): boolean[] {
  const n = Math.max(0, Math.floor(instances));
  const down: boolean[] = Array.from({ length: n }, () => false);
  for (const f of faults) {
    if (!f.active) continue;
    const { type, target, intensity } = f.spec;
    if (type === "kill-node" && target.id === nodeId) {
      down.fill(true);
    } else if (type === "kill-instances" && target.id === nodeId) {
      const k = Math.min(n, Math.round(intensity ?? 1));
      for (let i = n - k; i < n; i++) down[i] = true;
    } else if (type === "zone-failure" && !MANAGED_MULTI_ZONE.has(componentId)) {
      const zones = Math.max(1, Math.round(intensity ?? 3));
      for (let i = 0; i < n; i += zones) down[i] = true;
    }
  }
  return down;
}
