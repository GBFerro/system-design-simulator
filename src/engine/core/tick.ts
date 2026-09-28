/**
 * Time-stepped flow simulation (Spec 04 Phase 2, "Loop de um tick").
 *
 * One `step(λ)` advances the simulated clock by Δt = TICK_SEC (50 ms):
 *
 * 1. Arrivals: N ~ Poisson(λ·Δt) from the seeded PRNG (exact below a mean of
 *    30, normal approximation above — see `samplePoisson`), split evenly over
 *    the entry nodes, as a rate N/Δt. Retries scheduled by the previous tick
 *    are added on their edges.
 * 2. Propagation in the compiled order with the same routing as `analyze()`
 *    (LB shares, edge rules × callsPerRequest, rate limiter admission, queue
 *    decoupling). What leaves a node is what it COMPLETED this tick, so a
 *    draining backlog shows downstream.
 * 3. Per node, a fluid backlog: Q ← max(0, Q + (λ − cμ)Δt), capped at
 *    `maxQueue` (the excess is dropped). The wait arrivals see is Erlang C
 *    when ρ < 1 and there's no real backlog, else Q/(cμ) (FIFO behind the
 *    backlog). Queue/stream nodes also keep a per-consumer-edge lag that
 *    consumers drain at ≤ their capacity. Timeouts, call failure, success
 *    and availability come from the shared reverse pass (`settle`).
 * 4. `samples` synthetic requests (default 1000) walk the graph through
 *    the tick's stations for end-to-end p50/p95/p99 (`sampleLatency`).
 * 5. A `TickSnapshot` keyed by ReactFlow ids.
 *
 * Retries carry over: an edge out of a node with `maxRetries` R keeps the
 * failed attempts of each generation k < R and re-sends them the next tick,
 * so a steady failure fraction f converges to λ(1 − f^{R+1})/(1 − f), the
 * same amplification `analyze()` solves as a fixed point — and a transient
 * overload can snowball into a retry storm.
 *
 * Accounting: `global.throughput` counts this tick's arrivals that end
 * successfully (fate of the arrivals, like `analyze()`), so it never exceeds
 * `offeredRps`. Per node, `rpsOut` is the completion rate and may exceed
 * `rpsIn` while a backlog drains.
 *
 * Deterministic: the same graph, options and λ sequence give bit-identical
 * snapshots (one mulberry32 stream, fixed consumption order).
 */
import type { SimEdge, SimGraph, SimNode } from "@/domain/graph/compile";
import { UTILIZATION_CRITICAL, UTILIZATION_WARNING } from "../constants";
import { resolveConfig } from "../analyze";
import { EDGE_ERROR_THRESHOLD } from "../snapshot";
import { TICK_SEC } from "../traffic/types";
import type {
  EdgeRuntimeMetrics,
  NodeRuntimeMetrics,
  RuntimeNodeStatus,
  SimConfig,
  TickSnapshot,
} from "../types";
import { clamp01, hopPercentileMs, station, type StationState } from "./queueing";
import { mulberry32, samplePoisson, type Rng } from "./rng";
import {
  consumerCapacity,
  forwardEdges,
  hitRateOf,
  lbShares,
  maxQueueOf,
  maxRetriesOf,
  rateLimit,
  ruleFactor,
} from "./routing";
import { sampleLatency } from "./sampler";
import { sampleNodesFor, settle, type FlowView, type Settled, type Topology } from "./settle";

/** Synthetic requests per tick for end-to-end percentiles (Spec 04: 1000). */
export const TICK_SAMPLES = 1000;

/** Backlog below this many seconds of work is treated as queueing noise (Erlang C covers it). */
const BACKLOG_NOISE_SEC = 0.01;

export interface TickOptions extends SimConfig {
  /** Synthetic requests per tick. Default TICK_SAMPLES. */
  tickSamples?: number;
}

interface NodeState {
  /** Requests waiting at the station. */
  backlog: number;
  /** Queue/stream: undelivered messages per consumer edge. */
  lag: Map<string, number>;
}

interface TickFlow extends FlowView {
  /** Completion rate (includes a draining backlog). */
  completed: number;
  capacity: number;
  backlog: number;
  /** Queue/stream: total lag and whether it grew this tick. */
  lag: number;
  lagGrowing: boolean;
  /** Messages/s delivered to consumers. */
  delivered: number;
  rejected: number;
  overflow: number;
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export class TickSimulator {
  private graph!: SimGraph;
  private topo!: Topology;
  private edgesById = new Map<string, SimEdge>();
  private nodeState = new Map<string, NodeState>();
  /** Retry attempts by generation (index k = k+1-th retry), req/s, per edge. */
  private pending = new Map<string, number[]>();
  private rng: Rng;
  private ticks = 0;
  private readonly samples: number;
  private readonly options: TickOptions;
  private horizonSec = 10;

  constructor(graph: SimGraph, options: TickOptions = {}) {
    this.options = { ...options };
    const s = options.tickSamples;
    this.samples = Number.isFinite(s) && s! >= 1 ? Math.min(20_000, Math.floor(s!)) : TICK_SAMPLES;
    this.rng = mulberry32(0);
    this.setGraph(graph);
    this.reset();
  }

  /** Simulated seconds elapsed. */
  get time(): number {
    return round6(this.ticks * TICK_SEC);
  }

  get tickCount(): number {
    return this.ticks;
  }

  /** Back to t = 0: empty queues, no pending retries, PRNG reseeded. */
  reset(): void {
    this.ticks = 0;
    this.nodeState.clear();
    this.pending.clear();
    this.rng = mulberry32(resolveConfig(this.graph, this.topo.byId, this.options).seed);
  }

  /**
   * Swap the graph without rewinding the clock (live edits while playing).
   * Backlogs, lags and pending retries survive for ids that still exist.
   */
  setGraph(graph: SimGraph): void {
    this.graph = graph;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const cfg = resolveConfig(graph, byId, this.options);
    this.horizonSec = cfg.horizonSec;
    const valid = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
    this.topo = {
      byId,
      order: graph.order.filter((id) => byId.has(id)),
      entries: graph.entryIds.filter((id) => byId.has(id)),
      out: forwardEdges(valid),
      readRatio: cfg.readRatio,
    };
    this.edgesById = new Map(valid.map((e) => [e.id, e]));
    // (deleting the current key while iterating a Map is safe)
    for (const id of this.nodeState.keys()) if (!byId.has(id)) this.nodeState.delete(id);
    for (const [id, gens] of this.pending) {
      const e = this.edgesById.get(id);
      const r = e && !e.back ? maxRetriesOf(byId.get(e.source)!) : 0;
      if (r === 0) this.pending.delete(id);
      else if (gens.length !== r) {
        this.pending.set(
          id,
          Array.from({ length: r }, (_, k) => gens[k] ?? 0),
        );
      }
    }
    for (const [id, st] of this.nodeState) {
      for (const edgeId of st.lag.keys()) {
        if (this.edgesById.get(edgeId)?.source !== id) st.lag.delete(edgeId);
      }
    }
  }

  /** Advance one tick under an arrival rate λ (req/s). */
  step(lambda: number): TickSnapshot {
    const dt = TICK_SEC;
    const { byId, order, entries, out, readRatio } = this.topo;
    const rate = Number.isFinite(lambda) && lambda > 0 ? lambda : 0;

    // 1. arrivals (the PRNG is consumed even without entries, for a stable stream)
    const arrivals = samplePoisson(this.rng, rate * dt);
    const offered = entries.length > 0 ? arrivals / dt : 0;

    const inflow = new Map<string, number>();
    for (const id of entries) inflow.set(id, (inflow.get(id) ?? 0) + offered / entries.length);
    const base = new Map<string, number>();
    const load = new Map<string, number>();
    const shares = new Map<string, number>();
    const flows = new Map<string, TickFlow>();

    // 2–3. propagate in order
    for (const id of order) {
      const node = byId.get(id)!;
      const state = this.stateOf(id);
      const arriving = finite(inflow.get(id) ?? 0);
      const maxQueue = maxQueueOf(node);
      const edges = out.get(id) ?? [];

      let capacityPerInstance = node.capacityPerInstance;
      let admitted = arriving;
      let rejected = 0;
      if (node.routing === "rate-limiter") {
        const adm = rateLimit(node, arriving);
        admitted = adm.admitted;
        rejected = adm.rejected;
        capacityPerInstance = Math.min(capacityPerInstance, adm.capacityLimit / node.instances);
      }
      const capacity = node.instances * capacityPerInstance;

      let completed: number;
      let overflow = 0;
      let st: StationState;
      if (maxQueue === 0) {
        // No buffer: M/M/c/c loss system, nothing carries over.
        st = this.stableStation(node, admitted, capacityPerInstance, maxQueue);
        completed = Math.min(admitted, st.servedRps);
        overflow = admitted - completed;
        state.backlog = 0;
      } else {
        const work = state.backlog + admitted * dt;
        const done = Math.min(work, capacity * dt);
        let q = work - done;
        if (q > maxQueue) {
          overflow = (q - maxQueue) / dt;
          q = maxQueue;
        }
        state.backlog = q;
        completed = done / dt;
        const backlogged = admitted >= capacity || q > Math.max(1, capacity * BACKLOG_NOISE_SEC);
        st = backlogged
          ? this.backlogStation(node, admitted, completed, overflow, capacityPerInstance, q)
          : this.stableStation(node, admitted, capacityPerInstance, maxQueue);
      }

      const dropped = Math.min(arriving, rejected + overflow);
      const flow: TickFlow = {
        st,
        offered: arriving,
        served: Math.max(0, arriving - dropped),
        dropped,
        completed,
        capacity,
        backlog: state.backlog,
        lag: 0,
        lagGrowing: false,
        delivered: 0,
        rejected,
        overflow,
      };
      flows.set(id, flow);
      if (edges.length === 0) continue;

      const push = (e: SimEdge, baseLoad: number) => {
        const gens = this.pending.get(e.id);
        let total = baseLoad;
        if (gens) for (const g of gens) total += g;
        base.set(e.id, baseLoad);
        load.set(e.id, total);
        inflow.set(e.target, (inflow.get(e.target) ?? 0) + total);
      };

      if (node.routing === "lb") {
        const targets = edges.map((e) => byId.get(e.target)!);
        const split = lbShares(node, targets, (t) => inflow.get(t) ?? 0);
        edges.forEach((e, i) => {
          shares.set(e.id, split[i]);
          push(e, completed * split[i]);
        });
      } else if (node.routing === "queue") {
        // Decoupled: each consumer edge drains its own lag at ≤ consumer capacity.
        let lagTotal = 0;
        let lagBefore = 0;
        let delivered = 0;
        let lost = 0;
        for (const e of edges) {
          const prev = state.lag.get(e.id) ?? 0;
          const pendingMsgs = prev + completed * ruleFactor(e.rule, node, readRatio) * dt;
          const drained = Math.min(pendingMsgs, consumerCapacity(node, byId.get(e.target)!) * dt);
          let next = pendingMsgs - drained;
          if (next > maxQueue) {
            lost += (next - maxQueue) / dt;
            next = maxQueue;
          }
          if (next > 1e-9) state.lag.set(e.id, next);
          else state.lag.delete(e.id);
          lagBefore += prev;
          lagTotal += next;
          delivered += drained / dt;
          push(e, drained / dt);
        }
        flow.lag = lagTotal;
        flow.lagGrowing = lagTotal > lagBefore + 1e-9;
        flow.delivered = delivered;
        if (lost > 0) {
          // A full queue refuses publishes: producers see it as drops here.
          flow.overflow += lost;
          flow.dropped = Math.min(arriving, flow.dropped + lost);
          flow.served = Math.max(0, arriving - flow.dropped);
        }
      } else {
        for (const e of edges) push(e, completed * ruleFactor(e.rule, node, readRatio));
      }
    }

    // reverse pass: timeouts, call failure, success, availability
    const settled = settle(this.topo, flows, shares);

    // schedule next tick's retries from this tick's failed attempts
    const nextPending = new Map<string, number[]>();
    for (const id of order) {
      const r = maxRetriesOf(byId.get(id)!);
      if (r === 0) continue;
      for (const e of out.get(id) ?? []) {
        const f = settled.failure.get(e.id) ?? 0;
        const gens = this.pending.get(e.id);
        const next = Array.from({ length: r }, (_, k) =>
          k === 0 ? (base.get(e.id) ?? 0) * f : (gens?.[k - 1] ?? 0) * f,
        );
        if (next.some((v) => v > 0)) nextPending.set(e.id, next);
      }
    }
    this.pending = nextPending;

    // 4. end-to-end percentiles
    const sampled = sampleLatency(
      { nodes: sampleNodesFor(this.topo, flows, shares), entries, readRatio },
      this.samples,
      this.rng,
    );

    this.ticks++;
    return this.snapshot(offered, flows, load, settled, sampled.latency);
  }

  /* ---------- stations ---------- */

  private stableStation(
    node: SimNode,
    lambda: number,
    capacityPerInstance: number,
    maxQueue: number,
  ): StationState {
    return station({
      lambda,
      instances: node.instances,
      capacityPerInstance,
      serviceTimeMs: node.serviceTimeMs,
      maxQueue,
      horizonSec: this.horizonSec,
    });
  }

  /** Arrivals queue behind a real backlog: everyone waits Q/(cμ) (FIFO). */
  private backlogStation(
    node: SimNode,
    admitted: number,
    completed: number,
    overflow: number,
    capacityPerInstance: number,
    backlog: number,
  ): StationState {
    const idle = this.stableStation(node, 0, capacityPerInstance, Infinity);
    const waitMs = finite((backlog / idle.capacityRps) * 1000);
    return {
      ...idle,
      regime: "overloaded",
      utilization: finite(admitted / idle.capacityRps),
      servedRps: completed,
      unservedRps: overflow,
      waitProbability: 1,
      meanWaitMs: waitMs,
      queueDepth: backlog,
      drainPerMs: 0,
      fixedWaitMs: waitMs,
      waitCapMs: Math.max(waitMs, idle.waitCapMs),
    };
  }

  private stateOf(id: string): NodeState {
    let s = this.nodeState.get(id);
    if (!s) {
      s = { backlog: 0, lag: new Map() };
      this.nodeState.set(id, s);
    }
    return s;
  }

  /* ---------- snapshot ---------- */

  private snapshot(
    offered: number,
    flows: Map<string, TickFlow>,
    load: Map<string, number>,
    settled: Settled,
    latency: { p50Ms: number; p95Ms: number; p99Ms: number },
  ): TickSnapshot {
    const { entries } = this.topo;
    const nodes: Record<string, NodeRuntimeMetrics> = {};
    for (const n of this.graph.nodes) {
      const flow = flows.get(n.id);
      if (!flow) {
        nodes[n.id] = idleMetrics();
        continue;
      }
      const util = flow.capacity > 0 ? Math.max(flow.offered, flow.completed) / flow.capacity : 0;
      const queueDepth =
        flow.st.regime === "stable" ? Math.max(flow.backlog, flow.st.queueDepth) : flow.backlog;
      const m: NodeRuntimeMetrics = {
        rpsIn: finite(flow.offered),
        rpsOut: finite(flow.completed),
        utilization: finite(util),
        queueDepth: finite(queueDepth + flow.lag),
        p50: finite(hopPercentileMs(flow.st, 0.5)),
        p95: finite(hopPercentileMs(flow.st, 0.95)),
        p99: finite(hopPercentileMs(flow.st, 0.99)),
        errorRate: flow.offered > 0 ? clamp01(flow.dropped / flow.offered) : 0,
        drops: finite(flow.dropped),
        status: nodeStatus(flow, util),
      };
      if (n.routing === "queue") {
        // Lag in seconds of consumption; unknown (omitted) when nothing is consumed.
        m.extra = flow.delivered > 0 ? { queueLagSec: finite(flow.lag / flow.delivered) } : {};
      } else if (n.routing === "cache") {
        m.extra = { hitRatio: hitRateOf(n) };
      } else if (n.routing === "breaker") {
        m.extra = { breakerState: "closed" };
      }
      nodes[n.id] = m;
    }

    const edges: Record<string, EdgeRuntimeMetrics> = {};
    for (const e of this.edgesById.values()) {
      const target = nodes[e.target]?.status;
      const f = e.back ? 0 : (settled.failure.get(e.id) ?? 0);
      edges[e.id] = {
        rps: finite(load.get(e.id) ?? 0),
        status:
          f > EDGE_ERROR_THRESHOLD
            ? "error"
            : target === "warn" || target === "critical"
              ? "slow"
              : "ok",
      };
    }

    const mean = (m: Map<string, number>) =>
      entries.length === 0
        ? 0
        : entries.reduce((s, id) => s + (m.get(id) ?? 0), 0) / entries.length;
    const successRate = clamp01(mean(settled.success));
    const throughput = Math.min(offered, offered * successRate);

    return {
      t: this.time,
      offeredRps: finite(offered),
      nodes,
      edges,
      global: {
        throughput: finite(throughput),
        goodput: finite(throughput),
        errorRate: offered > 0 ? clamp01(1 - throughput / offered) : 0,
        p50: finite(latency.p50Ms),
        p95: finite(latency.p95Ms),
        p99: finite(latency.p99Ms),
        availability: entries.length > 0 ? clamp01(mean(settled.avail)) : 0,
      },
    };
  }
}

function idleMetrics(): NodeRuntimeMetrics {
  return {
    rpsIn: 0,
    rpsOut: 0,
    utilization: 0,
    queueDepth: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    errorRate: 0,
    drops: 0,
    status: "ok",
  };
}

function nodeStatus(flow: TickFlow, util: number): RuntimeNodeStatus {
  if (flow.offered <= 0 && flow.backlog <= 0 && flow.lag <= 0) return "ok";
  if (util > UTILIZATION_CRITICAL || flow.overflow > 0 || flow.lagGrowing) return "critical";
  if (util > UTILIZATION_WARNING || flow.lag > 0.5 || flow.rejected > 0) return "warn";
  return "ok";
}
