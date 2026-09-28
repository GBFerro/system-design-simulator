/**
 * Map an `analyze()` steady state to the runtime snapshot shape (Spec 07), so
 * the "Simulate" button and the tick loop feed the same `runtimeStore`.
 */
import type { NodeStatus } from "@/types/simulation";
import type {
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

export function steadyStateToSnapshot(steady: SteadyState, t = 0): TickSnapshot {
  const nodes: Record<string, NodeRuntimeMetrics> = {};
  const statusById = new Map<string, RuntimeNodeStatus>();
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
    if (n.routing === "queue" && n.servedRps > 0) {
      metrics.extra = { queueLagSec: n.queueDepth / n.servedRps };
    }
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
