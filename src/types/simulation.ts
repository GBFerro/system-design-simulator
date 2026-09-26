export type NodeStatus = "healthy" | "warning" | "critical" | "idle";

export interface NodeMetrics {
  nodeId: string;
  incomingQPS: number;
  effectiveQPS: number;
  utilization: number;
  latencyMs: number;
  status: NodeStatus;
  isBottleneck: boolean;
  /** Engine v2 (Spec 04) extras — absent on legacy results. */
  servedQPS?: number;
  errorRate?: number;
  p95Ms?: number;
  p99Ms?: number;
  queueDepth?: number;
}

export interface SimulationResult {
  nodeMetrics: Map<string, NodeMetrics>;
  totalLatencyMs: number;
  bottleneckNodes: string[];
  throughput: number;
  timestamp: number;
  warnings: string[];
  /** Engine v2 (Spec 04) extras — absent on legacy results. */
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  errorRate?: number;
  availability?: number;
}

export interface SimulationConfig {
  requestsPerSec: number;
  durationSec: number;
  rampUp: boolean;
}
