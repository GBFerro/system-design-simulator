/**
 * How active faults rewrite the graph (Spec 08), shared by the tick loop and
 * `analyze()` (steady state under a fault, Spec 09 scoring): faulted nodes
 * get capacity × multiplier and a longer service time (same concurrency, so
 * capacity shrinks by the same factor), an overridden hit rate, and zero
 * availability when down; faulted edges get extra latency and loss (a
 * severed edge loses every call). Unaffected entries are shared as is.
 *
 * What a topology can't express — a node that is down, a severed edge
 * (nothing arrives), a drained LB edge, the traffic multipliers — the
 * callers apply in their propagation, with `drainShares`/`entryShares`.
 */
import { PARAM } from "@/domain/components/params";
import type { SimEdge } from "@/domain/graph/compile";
import type { TickEffects } from "../faults/effects";
import { clamp01 } from "./queueing";
import type { Topology } from "./settle";

/** A stopped node keeps this share of its capacity (keeps the station math finite). */
const MIN_CAPACITY_FACTOR = 1e-6;

export function withEffects(topo: Topology, effects: TickEffects | null): Topology {
  if (!effects || (effects.nodes.size === 0 && effects.edges.size === 0)) return topo;
  const byId = new Map(topo.byId);
  for (const [id, fx] of effects.nodes) {
    const node = byId.get(id);
    if (!node) continue;
    const serviceTimeMs = node.serviceTimeMs * fx.latency + fx.latencyAddMs;
    const slowdown = serviceTimeMs / node.serviceTimeMs;
    const params = { ...node.params };
    if (fx.hitRate !== undefined) params[PARAM.hitRate] = fx.hitRate;
    if (fx.down) params[PARAM.availability] = 0;
    byId.set(id, {
      ...node,
      params,
      serviceTimeMs,
      capacityPerInstance:
        (node.capacityPerInstance * Math.max(MIN_CAPACITY_FACTOR, fx.capacity)) / slowdown,
    });
  }
  if (effects.edges.size === 0) return { ...topo, byId };
  const out = new Map<string, SimEdge[]>();
  for (const [id, edges] of topo.out) {
    out.set(
      id,
      edges.map((e) => {
        const fx = effects.edges.get(e.id);
        if (!fx || (fx.latencyAddMs === 0 && fx.errorRate === 0 && !fx.severed)) return e;
        const loss = fx.severed ? 1 : 1 - (1 - e.rule.packetLoss) * (1 - fx.errorRate);
        return {
          ...e,
          rule: {
            ...e.rule,
            networkLatencyMs: e.rule.networkLatencyMs + fx.latencyAddMs,
            packetLoss: clamp01(loss),
          },
        };
      }),
    );
  }
  return { ...topo, byId, out };
}

/**
 * LB shares with the drained (out-of-rotation) targets removed and the rest
 * renormalized. If every target is drained there's nowhere else to go: the
 * shares stay as they were.
 */
export function drainShares(split: number[], drained: boolean[]): number[] {
  if (!drained.some(Boolean)) return split;
  const kept = split.reduce((s, v, i) => (drained[i] ? s : s + v), 0);
  if (!(kept > 0)) return split;
  return split.map((v, i) => (drained[i] ? 0 : v / kept));
}

/**
 * How arrivals split over the entry nodes under a traffic spike, and the
 * factor on the total rate: global × the mean of the entry multipliers.
 * Without effects: an even split and 1.
 */
export function entryShares(
  entries: readonly string[],
  effects: TickEffects | null,
): { shares: number[]; factor: number } {
  const weights = entries.map((id) => effects?.entryTraffic.get(id) ?? 1);
  const sum = weights.reduce((s, w) => s + w, 0);
  const spread = entries.length > 0 && sum > 0 ? sum / entries.length : 1;
  return {
    shares: weights.map((w) => (sum > 0 ? w / sum : 1 / entries.length)),
    factor: (effects?.traffic ?? 1) * spread,
  };
}
