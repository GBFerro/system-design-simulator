/**
 * Routing by node kind (Spec 04, "Roteamento por tipo de nó").
 *
 * | kind          | how inflow λ leaves the node                                        |
 * | ------------- | ------------------------------------------------------------------- |
 * | lb            | split across targets by algorithm; edge rules don't apply           |
 * | service/fixed | each edge by its calls × callsPerRequest (`edgeFactor`)             |
 * | cache         | same, and `on_miss` (read-through) calls get λ × (1 − hitRate)      |
 * | queue         | decoupled: each consumer edge drains min(demand, consumer capacity) |
 * | rate-limiter  | admits min(λ, limit); the excess is rejected (429) or queued        |
 * | breaker       | passes all, or fails fast while open (`core/breaker.ts`)           |
 */
import { PARAM } from "@/domain/components/registry";
import type { EdgeCall } from "@/domain/components/types";
import type { CallPlan } from "@/domain/graph/callPlan";
import type { SimEdge, SimNode } from "@/domain/graph/compile";
import { clamp01 } from "./queueing";

export const DEFAULT_READ_RATIO = 0.9;

/* ---------- param readers (missing key → caller's fallback) ---------- */

export function paramNumber(node: SimNode, key: string, fallback: number): number {
  const v = node.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function paramString(node: SimNode, key: string, fallback: string): string {
  const v = node.params[key];
  return typeof v === "string" ? v : fallback;
}

/** hitRate in [0, 1]; nodes without the param miss everything (on_miss = always). */
export function hitRateOf(node: SimNode): number {
  return clamp01(paramNumber(node, PARAM.hitRate, 0));
}

/**
 * Share of a node's requests that actually hit its station: 1 for every
 * node except resolvers (DNS), where cached answers skip the lookup.
 */
export function lookupShareOf(node: SimNode): number {
  const v = paramNumber(node, PARAM.lookupShare, 1);
  return v >= 0 && v <= 1 ? v : 1;
}

/** Retries a node makes on its outgoing calls (client-side). */
export function maxRetriesOf(node: SimNode): number {
  return Math.min(10, Math.max(0, Math.floor(paramNumber(node, PARAM.maxRetries, 0))));
}

/** Timeout a node applies to its outgoing calls; undefined = waits forever. */
export function timeoutMsOf(node: SimNode): number | undefined {
  const t = paramNumber(node, PARAM.timeoutMs, NaN);
  return t > 0 ? t : undefined;
}

/** Backlog bound; nodes without the param queue without bound (for the horizon). */
export function maxQueueOf(node: SimNode): number {
  const q = paramNumber(node, PARAM.maxQueue, Infinity);
  return q >= 0 ? q : Infinity;
}

export function availabilityOf(node: SimNode): number {
  return clamp01(paramNumber(node, PARAM.availability, 0.999));
}

/* ---------- edge calls ---------- */

/** What a call's probability may depend on besides the source itself. */
export interface CallContext {
  readRatio: number;
  /** Nodes by id (faults applied): the cache's hit rate for `after_miss`. */
  byId?: ReadonlyMap<string, SimNode>;
  /** Per edge: probability a single call fails (settle). Missing = 0. */
  failure?: ReadonlyMap<string, number>;
}

/**
 * Probability a single request makes this call (before callsPerRequest).
 * `after_miss` = the reads that missed the cache call `dependsOn` (edge id,
 * from the call plan): r × (1 − h × (1 − f)), where h is the cache's hit
 * rate and f that call's failure (a failed cache call counts as a miss).
 * Without a resolved dependency it is every read, as the plan treats it.
 */
export function callProbability(
  call: EdgeCall,
  source: SimNode,
  ctx: CallContext,
  dependsOn?: string,
): number {
  switch (call.kind) {
    case "reads":
      return clamp01(ctx.readRatio);
    case "writes":
      return clamp01(1 - ctx.readRatio);
    case "fraction":
      return clamp01(call.fraction ?? 1);
    case "on_miss":
      return 1 - hitRateOf(source);
    case "after_miss": {
      const cache = call.missOf === undefined ? undefined : ctx.byId?.get(call.missOf);
      if (dependsOn === undefined || !cache) return clamp01(ctx.readRatio);
      const f = clamp01(ctx.failure?.get(dependsOn) ?? 0);
      return clamp01(ctx.readRatio) * (1 - hitRateOf(cache) * (1 - f));
    }
    default:
      return 1;
  }
}

export function callsOf(call: EdgeCall): number {
  const k = call.callsPerRequest;
  return Number.isFinite(k) && k > 0 ? k : 0;
}

/** One call of an edge as the engine runs it: resolved by the source's plan. */
export interface EdgeCallView {
  call: EdgeCall;
  /** `after_miss`: edge id of the cache call it depends on. */
  dependsOn?: string;
}

const callsByPlan = new WeakMap<CallPlan, Map<string, EdgeCallView[]>>();

/**
 * The calls `source` makes over `edge`, in list order, as its call plan
 * resolved them (an invalid `after_miss` comes out as `reads`). Without a
 * plan (an edge the compiler left out of it), the edge's own calls.
 */
export function edgeCallsOf(edge: SimEdge, source: SimNode): readonly EdgeCallView[] {
  const plan = source.plan;
  if (!plan) return edge.rule.calls.map((call) => ({ call }));
  let byEdge = callsByPlan.get(plan);
  if (!byEdge) {
    byEdge = new Map();
    const all = [...plan.steps.flat(), ...plan.async].sort((a, b) => a.index - b.index);
    for (const p of all) {
      const view: EdgeCallView = p.dependsOn
        ? { call: p.call, dependsOn: p.dependsOn }
        : { call: p.call };
      const list = byEdge.get(p.edgeId);
      if (list) list.push(view);
      else byEdge.set(p.edgeId, [view]);
    }
    callsByPlan.set(plan, byEdge);
  }
  return byEdge.get(edge.id) ?? edge.rule.calls.map((call) => ({ call }));
}

/**
 * Flow multiplier of an edge: Σ over its calls of P(taken) × callsPerRequest
 * (summed from the first term, so one call gives exactly that call's factor).
 */
export function edgeFactor(edge: SimEdge, source: SimNode, ctx: CallContext): number {
  const [first, ...rest] = edgeCallsOf(edge, source);
  if (!first) return 0;
  let factor = callProbability(first.call, source, ctx, first.dependsOn) * callsOf(first.call);
  for (const c of rest)
    factor += callProbability(c.call, source, ctx, c.dependsOn) * callsOf(c.call);
  return factor;
}

/* ---------- load balancer ---------- */

export type LbAlgorithm = "round-robin" | "least-connections" | "weighted" | "hash";

export function lbAlgorithmOf(node: SimNode): LbAlgorithm {
  const v = paramString(node, PARAM.lbAlgorithm, "round-robin");
  return v === "least-connections" || v === "weighted" || v === "hash" ? v : "round-robin";
}

export function capacityOf(node: SimNode): number {
  return node.instances * node.capacityPerInstance;
}

/**
 * Split shares (sum 1) across an LB's outgoing edges:
 * - round-robin / hash → equal (hash hot-keys are a Phase 2 concern)
 * - weighted → ∝ target capacity (instances × capacityPerInstance)
 * - least-connections → ∝ free capacity (capacity − load already routed there)
 */
export function lbShares(
  node: SimNode,
  targets: readonly SimNode[],
  loadSoFar: (id: string) => number,
): number[] {
  const n = targets.length;
  if (n === 0) return [];
  const equal = targets.map(() => 1 / n);
  const algorithm = lbAlgorithmOf(node);
  if (algorithm === "round-robin" || algorithm === "hash") return equal;
  const weights =
    algorithm === "weighted"
      ? targets.map(capacityOf)
      : targets.map((t) => Math.max(0, capacityOf(t) - loadSoFar(t.id)));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) {
    // Every target is already full: fall back to capacity weights.
    const caps = targets.map(capacityOf);
    const capTotal = caps.reduce((s, w) => s + w, 0);
    return capTotal > 0 ? caps.map((c) => c / capTotal) : equal;
  }
  return weights.map((w) => w / total);
}

/* ---------- rate limiter ---------- */

export interface Admission {
  /** Admitted into the node. */
  admitted: number;
  /** Rejected with 429. */
  rejected: number;
  /** Queue mode: effective capacity is min(capacity, limit). */
  capacityLimit: number;
}

export function rateLimit(node: SimNode, lambda: number): Admission {
  const limit = paramNumber(node, PARAM.limitRps, Infinity);
  const safeLimit = limit > 0 ? limit : Infinity;
  if (paramString(node, PARAM.overLimitAction, "reject") === "queue") {
    return { admitted: lambda, rejected: 0, capacityLimit: safeLimit };
  }
  const admitted = Math.min(lambda, safeLimit);
  return { admitted, rejected: lambda - admitted, capacityLimit: Infinity };
}

/* ---------- queue / stream ---------- */

/**
 * How fast one consumer edge drains a queue: `consumers` parallel consumers
 * (bounded by the target's instances), each at the target's per-instance
 * capacity. Nodes without a `consumers` param drain at the target's capacity.
 */
export function consumerCapacity(queue: SimNode, target: SimNode): number {
  const consumers = Math.floor(paramNumber(queue, PARAM.consumers, target.instances));
  const pullers = Math.max(1, Math.min(consumers > 0 ? consumers : 1, target.instances));
  return pullers * target.capacityPerInstance;
}

/** Forward (non-back) edges out of each node, in edge order. */
export function forwardEdges(edges: readonly SimEdge[]): Map<string, SimEdge[]> {
  const map = new Map<string, SimEdge[]>();
  for (const e of edges) {
    if (e.back) continue;
    const list = map.get(e.source);
    if (list) list.push(e);
    else map.set(e.source, [e]);
  }
  return map;
}
