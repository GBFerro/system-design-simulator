/**
 * Map an `analyze()` steady state to the runtime snapshot shape (Spec 07), so
 * the "Simulate" button and the tick loop feed the same `runtimeStore`.
 */
import { PARAM } from "@/domain/components/params";
import type { NodeStatus } from "@/types/simulation";
import type {
  NodeSteadyState,
  SimGraph,
  SimNode,
  EdgeRuntimeMetrics,
  NodeRuntimeMetrics,
  RuntimeEdgeStatus,
  RuntimeNodeStatus,
  SteadyState,
  TickSnapshot,
} from "./types";

/** Share of failed calls above which an edge shows as erroring. */
export const EDGE_ERROR_THRESHOLD = 0.01;

export function runtimeStatusOf(status: NodeStatus): RuntimeNodeStatus {
  switch (status) {
    case "critical":
      return "critical";
    case "warning":
      return "warn";
    default:
      return "ok";
  }
}

function num(node: SimNode | undefined, key: string): number | undefined {
  const v = node?.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * OBS-03 metrics that depend on the component type. `sim` (the compiled node)
 * supplies params; without it only what the steady state carries is reported.
 */
export function extrasOf(
  n: NodeSteadyState,
  sim: SimNode | undefined,
): NodeRuntimeMetrics["extra"] | undefined {
  const extra: NonNullable<NodeRuntimeMetrics["extra"]> = {};

  // Queue / stream: consumer lag = backlog / drain rate (Little's law).
  if (n.routing === "queue" && n.servedRps > 0) extra.queueLagSec = n.queueDepth / n.servedRps;

  // Cache / CDN: the engine sends λ × (1 − hitRate) down `on_miss` edges.
  const hitRate = num(sim, PARAM.hitRate);
  if (n.routing === "cache" && hitRate !== undefined) extra.hitRatio = clamp01(hitRate);

  // Connection pool (SQL): connections busy per instance = λ × service time
  // (Little's law), over the pool size; an overloaded node exhausts it.
  const pool = num(sim, PARAM.connectionPool);
  if (pool !== undefined && pool > 0 && sim) {
    const serviceSec = Math.max(0, n.meanLatencyMs - n.queueWaitMs) / 1000;
    const busy = (n.servedRps * serviceSec) / Math.max(1, sim.instances);
    extra.poolUsage = n.utilization >= 1 ? 1 : clamp01(busy / pool);
  }

  // Read replica: how far it trails the primary (a param in the steady state).
  const lag = num(sim, PARAM.replicationLagMs);
  if (lag !== undefined) extra.replicationLagMs = Math.max(0, lag);

  // Circuit breaker: the steady state models it closed (open/half-open come
  // with faults, Spec 08, from the tick loop).
  if (n.routing === "breaker") extra.breakerState = "closed";

  return Object.keys(extra).length > 0 ? extra : undefined;
}

/**
 * `graph` is optional: pass the compiled graph the steady state came from to
 * get the param-based OBS-03 extras (hit ratio, pool usage, replication lag).
 */
export function steadyStateToSnapshot(
  steady: SteadyState,
  t = 0,
  graph?: Pick<SimGraph, "nodes">,
): TickSnapshot {
  const nodes: Record<string, NodeRuntimeMetrics> = {};
  const statusById = new Map<string, RuntimeNodeStatus>();
  const simById = new Map(graph?.nodes.map((n) => [n.id, n]));
  for (const n of steady.nodes) {
    const status = runtimeStatusOf(n.status);
    statusById.set(n.nodeId, status);
    const metrics: NodeRuntimeMetrics = {
      rpsIn: n.offeredRps,
      rpsOut: n.servedRps,
      utilization: n.utilization,
      queueDepth: n.queueDepth,
      p50: n.p50Ms,
      p95: n.p95Ms,
      p99: n.p99Ms,
      errorRate: n.errorRate,
      drops: n.droppedRps,
      status,
    };
    const extra = extrasOf(n, simById.get(n.nodeId));
    if (extra) metrics.extra = extra;
    nodes[n.nodeId] = metrics;
  }

  const edges: Record<string, EdgeRuntimeMetrics> = {};
  for (const e of steady.edges) {
    const target = statusById.get(e.target);
    const status: RuntimeEdgeStatus =
      e.failureRate > EDGE_ERROR_THRESHOLD
        ? "error"
        : target === "warn" || target === "critical"
          ? "slow"
          : "ok";
    edges[e.edgeId] = { rps: e.rps, status };
  }

  return {
    t,
    offeredRps: steady.offeredRps,
    nodes,
    edges,
    global: {
      throughput: steady.throughputRps,
      goodput: steady.throughputRps,
      errorRate: steady.errorRate,
      p50: steady.latency.p50Ms,
      p95: steady.latency.p95Ms,
      p99: steady.latency.p99Ms,
      availability: steady.availability,
    },
  };
}
