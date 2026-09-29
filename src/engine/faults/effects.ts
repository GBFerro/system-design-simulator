/**
 * Active modifiers at one instant, folded per node/edge (Spec 08). The tick
 * loop asks for `effectsAt(mods, t)` at the start of each tick; with nothing
 * active it gets `null` and runs exactly as without chaos.
 *
 * Folding: multipliers multiply, extra latencies add, error rates combine as
 * independent failures (1 − Π(1 − eᵢ)), the lowest hit rate wins, and any
 * `nodeDown` / `severEdge` wins over everything else.
 */
import type { CompiledModifier } from "./types";

export interface NodeEffect {
  /** × capacity (0 = stopped). */
  capacity: number;
  /** × service time, with the same concurrency (so capacity shrinks by the same factor). */
  latency: number;
  /** + service time (ms), same concurrency. */
  latencyAddMs: number;
  /** Share of arrivals that fail right away (dead instances still in rotation). */
  errorRate: number;
  down: boolean;
  /** Overrides the hit rate (cache flush warm-up). */
  hitRate?: number;
}

export interface EdgeEffect {
  latencyAddMs: number;
  /** Extra loss probability per call. */
  errorRate: number;
  severed: boolean;
  /** An LB edge whose target was taken out of rotation (share 0, the rest renormalized). */
  drained: boolean;
}

export interface TickEffects {
  /** × arrivals everywhere. */
  traffic: number;
  /** × arrivals at these entry nodes. */
  entryTraffic: Map<string, number>;
  nodes: Map<string, NodeEffect>;
  edges: Map<string, EdgeEffect>;
}

export function isActive(m: CompiledModifier, t: number): boolean {
  return m.startT <= t + 1e-9 && (m.endT === undefined || t + 1e-9 < m.endT);
}

/** Hit rate of a `hitRateOverride` at time t (recovering exponentially when `recover` is set). */
export function overrideValueAt(m: CompiledModifier, t: number): number {
  if (!m.recover || !(m.recover.tauSec > 0)) return m.value;
  const elapsed = Math.max(0, t - m.startT);
  return m.recover.to + (m.value - m.recover.to) * Math.exp(-elapsed / m.recover.tauSec);
}

const nodeFx = (): NodeEffect => ({
  capacity: 1,
  latency: 1,
  latencyAddMs: 0,
  errorRate: 0,
  down: false,
});
const edgeFx = (): EdgeEffect => ({
  latencyAddMs: 0,
  errorRate: 0,
  severed: false,
  drained: false,
});

const combine = (a: number, b: number) => 1 - (1 - a) * (1 - Math.min(1, Math.max(0, b)));

export function effectsAt(mods: readonly CompiledModifier[], t: number): TickEffects | null {
  let fx: TickEffects | null = null;
  const get = () =>
    (fx ??= { traffic: 1, entryTraffic: new Map(), nodes: new Map(), edges: new Map() });
  const onNode = (id: string) => {
    const f = get();
    let n = f.nodes.get(id);
    if (!n) f.nodes.set(id, (n = nodeFx()));
    return n;
  };
  const onEdge = (id: string) => {
    const f = get();
    let e = f.edges.get(id);
    if (!e) f.edges.set(id, (e = edgeFx()));
    return e;
  };

  for (const m of mods) {
    if (!isActive(m, t)) continue;
    const v = Number.isFinite(m.value) ? m.value : 0;
    switch (m.kind) {
      case "trafficMultiplier": {
        const f = get();
        const x = Math.max(0, v);
        if (m.targetIds.length === 0) f.traffic *= x;
        else
          for (const id of m.targetIds) f.entryTraffic.set(id, (f.entryTraffic.get(id) ?? 1) * x);
        break;
      }
      case "capacityMultiplier":
        for (const id of m.targetIds) onNode(id).capacity *= Math.max(0, v);
        break;
      case "latencyMultiplier":
        for (const id of m.targetIds) onNode(id).latency *= Math.max(1, v);
        break;
      case "nodeDown":
        for (const id of m.targetIds) onNode(id).down = true;
        break;
      case "hitRateOverride": {
        const h = Math.min(1, Math.max(0, overrideValueAt(m, t)));
        for (const id of m.targetIds) {
          const n = onNode(id);
          n.hitRate = n.hitRate === undefined ? h : Math.min(n.hitRate, h);
        }
        break;
      }
      case "errorRate":
        for (const id of m.targetIds) {
          if (m.onEdges) onEdge(id).errorRate = combine(onEdge(id).errorRate, v);
          else onNode(id).errorRate = combine(onNode(id).errorRate, v);
        }
        break;
      case "latencyAddMs":
        for (const id of m.targetIds) {
          if (m.onEdges) onEdge(id).latencyAddMs += Math.max(0, v);
          else onNode(id).latencyAddMs += Math.max(0, v);
        }
        break;
      case "severEdge":
        for (const id of m.targetIds) onEdge(id).severed = true;
        break;
      case "drainEdge":
        for (const id of m.targetIds) onEdge(id).drained = true;
        break;
      default: {
        // A new ModifierKind must be folded here, or its faults silently do nothing.
        const unhandled: never = m.kind;
        void unhandled;
      }
    }
  }
  return fx;
}
