/**
 * Engine contract (Spec 04, "Contrato do motor").
 *
 * Phase 1 implements `load` + `analyze` (instant steady state), Phase 2 the
 * tick loop (`play`/`pause`/`reset`/`setSpeed`/`setTraffic`/`onTick`), and
 * Spec 08 (chaos) `inject`/`heal`.
 */
import type { RoutingKind } from "@/domain/components/types";
import type { SimGraph } from "@/domain/graph/compile";
import type { NodeStatus } from "@/types/simulation";
import type { FaultId, FaultSpec } from "./faults/types";
import type { SimSpeed, TrafficPattern } from "./traffic/types";

export type { SimGraph, SimNode, SimEdge } from "@/domain/graph/compile";

export interface SimConfig {
  /** PRNG seed (mulberry32). Same graph + seed → identical result. Default 42. */
  seed?: number;
  /** Synthetic requests sampled for end-to-end percentiles. Default 2000. */
  samples?: number;
  /** How long overload is observed: the backlog grows for this long. Default 10 s. */
  horizonSec?: number;
  /**
   * Fraction of requests that are reads (drives `reads`/`writes` edge rules).
   * Default: the entry node's `readRatio` param, else 0.9.
   */
  readRatio?: number;
  /** Cap on fixed-point iterations for retry amplification. Default 200. */
  maxIterations?: number;
}

export interface NodeSteadyState {
  nodeId: string;
  componentId: string;
  routing: RoutingKind;
  /** Arrivals (including retries), req/s. */
  offeredRps: number;
  /** Successfully processed, req/s. Always ≤ offeredRps. */
  servedRps: number;
  /** Dropped, rejected (429) or lost to overload, req/s. */
  droppedRps: number;
  /** droppedRps / offeredRps. */
  errorRate: number;
  /** instances × capacityPerInstance (rate limiter: min with the limit). */
  capacityRps: number;
  /** offered / capacity; may exceed 1 under overload. */
  utilization: number;
  /** Mean hop latency: service time + mean queue wait. */
  meanLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Mean time waiting in the queue. */
  queueWaitMs: number;
  /** Requests waiting (queue/stream: message backlog = consumer lag). */
  queueDepth: number;
  /** Availability of the node's instances in parallel: 1 − (1 − a)^instances. */
  availability: number;
  status: NodeStatus;
  isBottleneck: boolean;
}

export interface EdgeSteadyState {
  edgeId: string;
  source: string;
  target: string;
  /** Load carried, retries included, req/s. */
  rps: number;
  /** rps / load before retries (≥ 1). */
  retryAmplification: number;
  /** Fraction of calls that fail (drop, timeout, packet loss, or downstream failure). */
  failureRate: number;
  async: boolean;
  /** Closes a cycle: carries no load. */
  back: boolean;
}

export interface LatencySummary {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface SteadyState {
  /** Requested load, req/s. */
  requestedRps: number;
  /** Load that actually entered the system (0 without an entry point), req/s. */
  offeredRps: number;
  /** Successful end-to-end requests, req/s. Always ≤ offeredRps. */
  throughputRps: number;
  /** 1 − throughput / offered. */
  errorRate: number;
  /** Composed availability of the user-facing path (series × parallel). */
  availability: number;
  /** End-to-end, successful user requests, sync path only (async edges excluded). */
  latency: LatencySummary;
  nodes: NodeSteadyState[];
  edges: EdgeSteadyState[];
  entryIds: string[];
  bottleneckIds: string[];
  warnings: string[];
  seed: number;
  /** Fixed-point iterations used to settle retry amplification. */
  iterations: number;
}

/* ---------- Spec 06 (traffic) and Spec 08 (chaos) ---------- */

export type { TrafficPattern, SimSpeed } from "./traffic/types";
export type { FaultId, FaultRecord, FaultSpec } from "./faults/types";

/**
 * Blast radius of the active faults (Spec 08, CHS-04): the fault's own
 * target, or a node/edge degraded compared with just before the first fault
 * (errors, worse status, p99 well above baseline).
 */
export type BlastRole = "target" | "affected";

/* ---------- runtime metrics (Spec 07) ---------- */

/** Runtime status of a node. Shown by color AND icon (a11y NFR). */
export type RuntimeNodeStatus = "ok" | "warn" | "critical" | "down";

export type RuntimeEdgeStatus = "ok" | "slow" | "error";

export type BreakerState = "closed" | "open" | "half-open";

/** Per-node metrics of one tick (Spec 07, OBS-01/03). Latencies are the hop only, in ms. */
export interface NodeRuntimeMetrics {
  rpsIn: number;
  rpsOut: number;
  /** ρ; may exceed 1 under overload. */
  utilization: number;
  queueDepth: number;
  p50: number;
  p95: number;
  p99: number;
  /** 0–1. */
  errorRate: number;
  /** Dropped/rejected, req/s. */
  drops: number;
  status: RuntimeNodeStatus;
  /** Set while faults are active (and until the node recovers). */
  blast?: BlastRole;
  /** OBS-03, by component type. */
  extra?: {
    hitRatio?: number;
    queueLagSec?: number;
    poolUsage?: number;
    replicationLagMs?: number;
    breakerState?: BreakerState;
  };
}

export interface EdgeRuntimeMetrics {
  rps: number;
  status: RuntimeEdgeStatus;
  blast?: BlastRole;
}

/** End-to-end metrics of one tick (OBS-02). Latencies in ms. */
export interface GlobalRuntimeMetrics {
  throughput: number;
  /** Successful requests within the SLO (Spec 11); = throughput until SLOs exist. */
  goodput: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  availability: number;
}

/** One sampled request (OBS-06, Phase 5). */
export interface Trace {
  id: string;
  ok: boolean;
  totalMs: number;
  hops: { nodeId: string; startMs: number; durationMs: number }[];
}

/**
 * One tick of the time-stepped loop (Spec 04 Phase 2) or an `analyze()`
 * steady state mapped to the same shape. Keyed by ReactFlow node/edge id.
 */
export interface TickSnapshot {
  /** Simulated seconds since play (0 for an analyze() snapshot). */
  t: number;
  /** Offered load at this tick, req/s. */
  offeredRps: number;
  nodes: Record<string, NodeRuntimeMetrics>;
  edges: Record<string, EdgeRuntimeMetrics>;
  global: GlobalRuntimeMetrics;
  traces?: Trace[];
}

export type Unsubscribe = () => void;

export interface Engine {
  /** Validates and compiles params + rules. */
  load(graph: SimGraph, config?: SimConfig): void;
  play(): void;
  pause(): void;
  reset(): void;
  setSpeed(x: SimSpeed): void;
  /** Changes live. */
  setTraffic(p: TrafficPattern): void;
  /** Applies from the next tick; throws when the spec can't apply to the loaded graph. */
  inject(fault: FaultSpec): FaultId;
  heal(id: FaultId): void;
  /** Instant analytic mode: steady state at `rps`. */
  analyze(rps: number): SteadyState;
  onTick(cb: (s: TickSnapshot) => void): Unsubscribe;
}
