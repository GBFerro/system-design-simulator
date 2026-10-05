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
  /** Latency SLO (Spec 11): successes slower than it don't count as goodput. */
  latencySlo?: LatencySlo;
}

/**
 * The latency part of an SLO, as the engine needs it (Spec 11): a request
 * slower than `thresholdMs` end to end — or, with `scope`, at that component
 * type's hop — isn't "good" even when it succeeds.
 */
export interface LatencySlo {
  thresholdMs: number;
  /** Component type (catalog id) whose hop latency the SLO is about. */
  scope?: string;
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
  /** Successful requests within `config.latencySlo`, req/s (= throughput without one). ≤ throughputRps. */
  goodputRps: number;
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

/**
 * What the Analyze button gets from the engine: the steady state and each
 * edge's link failure for the snapshot's `edgeLinkFailure` (request-flow).
 */
export interface AnalyzedGraph {
  steady: SteadyState;
  linkFailure: Record<string, number>;
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
  /** Successful requests within the latency SLO (Spec 11); = throughput without one. */
  goodput: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  availability: number;
  /**
   * Share of requests that are reads, as the engine resolved it
   * (`resolveConfig`: config, else the entry's `readRatio` param, else the
   * default). The flow balls draw reads and writes with it (request-flow).
   * Absent in snapshots built by hand (tests).
   */
  readRatio?: number;
}

/**
 * What happened to one sampled request (request-flow, OBS-06: the Flow tab).
 * Times are ms since the request started. A `call` is one attempt of a sync
 * call; its response is implied by `t1` (when it got back to the caller).
 * An `async` call has no response. A `cache` event is a look-aside or
 * read-through hit or miss (`viaFailure`: the cache call failed, so a miss).
 */
export type TraceEvent =
  | {
      type: "call";
      edgeId: string;
      from: string;
      to: string;
      step: number;
      t0: number;
      t1: number;
      ok: boolean;
      attempt: number;
    }
  | { type: "async"; edgeId: string; from: string; to: string; step: number; t0: number }
  | { type: "cache"; nodeId: string; hit: boolean; viaFailure: boolean };

/** One sampled request, as a sequence of events (`core/trace.ts`). */
export interface RequestTrace {
  cls: "read" | "write";
  ok: boolean;
  /** End to end: when the response got back to the entry. */
  totalMs: number;
  /** In start order; responses are implied by `call.t1`. */
  events: TraceEvent[];
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
  /**
   * Per edge id: probability a call fails on the link or by the caller's
   * timeout, 1 − (1 − packet loss) × (1 − P(timeout)), without the target's
   * own failure (request-flow FLW-05: the balls fail the call with it). Kept
   * out of `edges` so a tick doesn't re-render edges for it. Absent in
   * snapshots built by hand (tests): no call fails on its link.
   */
  edgeLinkFailure?: Record<string, number>;
  traces?: RequestTrace[];
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
