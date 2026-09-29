import type { NodeMetrics, SimulationResult } from "@/types/simulation";
import type { SteadyState } from "./types";

/** Utilization shown in the UI is capped at 200% (same as the legacy engine). */
const MAX_DISPLAY_UTILIZATION = 2;

/**
 * Map an `analyze()` steady state onto the `SimulationResult` shape the
 * panel, canvas and edges already render (compatibility with the v1 UI).
 */
export function toSimulationResult(steady: SteadyState, timestamp = Date.now()): SimulationResult {
  const nodeMetrics = new Map<string, NodeMetrics>();
  for (const n of steady.nodes) {
    nodeMetrics.set(n.nodeId, {
      nodeId: n.nodeId,
      incomingQPS: n.offeredRps,
      effectiveQPS: n.capacityRps,
      utilization: Math.min(n.utilization, MAX_DISPLAY_UTILIZATION),
      latencyMs: n.meanLatencyMs,
      status: n.status,
      isBottleneck: n.isBottleneck,
      servedQPS: n.servedRps,
      errorRate: n.errorRate,
      p95Ms: n.p95Ms,
      p99Ms: n.p99Ms,
      queueDepth: n.queueDepth,
    });
  }
  return {
    nodeMetrics,
    totalLatencyMs: steady.latency.p50Ms,
    bottleneckNodes: steady.bottleneckIds,
    throughput: steady.throughputRps,
    timestamp,
    warnings: steady.warnings,
    latencyP50Ms: steady.latency.p50Ms,
    latencyP95Ms: steady.latency.p95Ms,
    latencyP99Ms: steady.latency.p99Ms,
    errorRate: steady.errorRate,
    availability: steady.availability,
  };
}
