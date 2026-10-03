import type { EdgeCall, RoutingKind } from "@/domain/components/types";

/**
 * Call plan of one node (request-flow, AD-002): in what order and on what
 * condition it makes its calls. The ONLY place steps and "after miss"
 * dependencies are resolved; the engine, the flow balls, the trace and the
 * edge badges read the plan and never reinterpret steps.
 *
 * Rules (design "Components → callPlan"):
 * 1. Calls are walked in order: edges in graph order, then each edge's list.
 * 2. With no explicit step on the node, the call at position i takes step
 *    i + 1 (sequential, as before the call model).
 * 3. With an explicit step somewhere, calls without one go after the highest
 *    explicit step, one per step, in the order of rule 1.
 * 4. An `after_miss` call needs a sync call of the same node to `missOf`, and
 *    `missOf` must have a hit rate; otherwise it counts as `reads` (warning).
 * 5. Its effective step is max(step, dependency's step + 1) (warning when
 *    raised).
 * 6. Load balancers and queues ignore steps: the LB splits, the queue
 *    decouples.
 *
 * Plain data only (structured-clone safe), so the plan can travel inside the
 * compiled `SimGraph` to the engine worker.
 */

/** An outgoing edge as the plan needs it (back edges already left out). */
export interface PlanEdge {
  id: string;
  target: string;
  async: boolean;
  calls: readonly EdgeCall[];
}

export interface PlannedCall {
  edgeId: string;
  target: string;
  /** Position in the edge's `rule.calls`. */
  index: number;
  /** The call as it runs: an invalid `after_miss` comes out as `reads`. */
  call: EdgeCall;
  /** Effective step (≥ 1). */
  step: number;
  async: boolean;
  /** `after_miss`: edge id of the cache call it depends on. */
  dependsOn?: string;
}

export interface CallPlan {
  /** Sync calls grouped by effective step, ascending; same step = parallel. */
  steps: PlannedCall[][];
  async: PlannedCall[];
  // SPEC_DEVIATION: design.md types `absorbed` as ReadonlySet<string>.
  // Reason: the plan is attached to the SimGraph (T7), which must stay
  // structured-clone safe for the worker: no Set, so an array of edge ids.
  /** Edge ids of cache calls whose failure becomes a miss (an `after_miss` depends on them). */
  absorbed: string[];
  warnings: string[];
}

// SPEC_DEVIATION: design.md declares planFor(sourceId, outEdges, targetHasHitRate).
// Reason: rule 6 needs the source's routing kind, and warnings read better with
// node labels, so an optional fourth argument carries both.
export interface PlanOptions {
  /** Routing kind of the source (rule 6: `lb` and `queue` ignore steps). */
  routing?: RoutingKind;
  /** Node label for warnings; defaults to the id. */
  labelOf?: (nodeId: string) => string;
}

export function planFor(
  sourceId: string,
  outEdges: readonly PlanEdge[],
  targetHasHitRate: (nodeId: string) => boolean,
  options: PlanOptions = {},
): CallPlan {
  const label = options.labelOf ?? ((id: string) => id);
  const stepsIgnored = options.routing === "lb" || options.routing === "queue";
  const warnings: string[] = [];

  // 1. every call, in order
  const planned: PlannedCall[] = [];
  for (const edge of outEdges) {
    edge.calls.forEach((call, index) => {
      planned.push({
        edgeId: edge.id,
        target: edge.target,
        index,
        call,
        step: 0,
        async: edge.async,
      });
    });
  }

  // 2–3. base steps (6: ignored for LBs and queues)
  const explicit = stepsIgnored ? [] : planned.filter((p) => p.call.step !== undefined);
  if (explicit.length === 0) {
    planned.forEach((p, i) => (p.step = i + 1));
  } else {
    let next = Math.max(...explicit.map((p) => p.call.step!));
    for (const p of planned) p.step = p.call.step ?? ++next;
  }

  // 4–5. after-miss dependencies
  const absorbed: string[] = [];
  for (const p of planned) {
    if (p.call.kind !== "after_miss") continue;
    const cache = p.call.missOf;
    const dependency = cache
      ? planned.filter((d) => !d.async && d.target === cache && d.call.kind !== "after_miss")
      : [];
    if (!cache || dependency.length === 0 || !targetHasHitRate(cache)) {
      const why = !cache
        ? "names no cache call"
        : dependency.length === 0
          ? `points to ${label(cache)}, which ${label(sourceId)} doesn't call synchronously`
          : `points to ${label(cache)}, which has no hit rate`;
      warnings.push(
        `${label(sourceId)} → ${label(p.target)}: "reads after a miss" ${why}; treated as reads.`,
      );
      p.call = { kind: "reads", callsPerRequest: p.call.callsPerRequest };
      continue;
    }
    const depEdge = dependency[0].edgeId;
    p.dependsOn = depEdge;
    if (!absorbed.includes(depEdge)) absorbed.push(depEdge);
    if (stepsIgnored) continue;
    const depStep = Math.max(...dependency.filter((d) => d.edgeId === depEdge).map((d) => d.step));
    if (p.step <= depStep) {
      warnings.push(
        `${label(sourceId)} → ${label(p.target)}: the call after a miss in ${label(cache)} was at step ${p.step}; it runs at step ${depStep + 1}, after the cache call.`,
      );
      p.step = depStep + 1;
    }
  }

  // group: sync calls by step (ascending, rule-1 order inside a step)
  const byStep = new Map<number, PlannedCall[]>();
  for (const p of planned) {
    if (p.async) continue;
    const group = byStep.get(p.step);
    if (group) group.push(p);
    else byStep.set(p.step, [p]);
  }
  const steps = [...byStep.keys()].sort((a, b) => a - b).map((s) => byStep.get(s)!);
  return { steps, async: planned.filter((p) => p.async), absorbed, warnings };
}
