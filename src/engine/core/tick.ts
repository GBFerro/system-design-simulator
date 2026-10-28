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
 * Reads after a cache miss (look-aside) route by the cache call's failure
 * of the previous tick (a failed cache call is a miss), so a cache that goes
 * down sends every read to the database from the next tick on.
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
 * Faults (Spec 08): `step(λ, effects)` takes the modifiers active at this
 * tick (`faults/effects.ts`). They rewrite the tick's view of the graph —
 * capacity and service time of a node, hit rate, loss/latency of an edge —
 * plus three things that view can't express: a node that is down (drops
 * everything, sends nothing), a severed edge (the target gets nothing, every
 * call fails) and a drained LB edge (out of rotation). Without effects the
 * tick is exactly the fault-free one.
 *
 * Deterministic: the same graph, options, λ and effects sequence give
 * bit-identical snapshots (one mulberry32 stream, fixed consumption order).
 */
import { techLimitOf } from "@/domain/components/technologies/limits";
import {
  capScaleOf,
  scaledStation,
  type TechCore,
  type TechProfile,
} from "@/domain/components/technologies/profile";
import type { SimEdge, SimGraph, SimNode } from "@/domain/graph/compile";
import { UTILIZATION_CRITICAL, UTILIZATION_WARNING } from "../constants";
import { isThrottled, resolveConfig } from "../analyze";
import type { TickEffects } from "../faults/effects";
import { drainShares, entryShares, withEffects } from "./faultView";
import { EDGE_ERROR_THRESHOLD } from "../snapshot";
import { TICK_SEC } from "../traffic/types";
import type {
  EdgeRuntimeMetrics,
  NodeRuntimeMetrics,
  RuntimeNodeStatus,
  LatencySlo,
  SimConfig,
  TickSnapshot,
} from "../types";
import { clamp01, hopPercentileMs, station, type StationState } from "./queueing";
import { mulberry32, samplePoisson, type Rng } from "./rng";
import {
  advanceBreaker,
  breakerAdmits,
  breakerParams,
  closedBreaker,
  type Breaker,
} from "./breaker";
import {
  consumerCapacity,
  forwardEdges,
  hitRateOf,
  lbShares,
  lookupShareOf,
  maxQueueOf,
  maxRetriesOf,
  rateLimit,
  edgeFactor,
  type CallContext,
} from "./routing";
import { sampleLatency } from "./sampler";
import { sampleNodesFor, settle, type FlowView, type Settled, type Topology } from "./settle";
import { sanitizeLatencySlo, slowShareOf } from "./slo";
import {
  admit,
  classesOf,
  edgeWriteShare,
  kafkaLimit,
  replicaEffect,
  replicationLagOf,
  techPercentileMs,
  type ConsumerLimit,
  type TechClassView,
  type TechFlowView,
} from "./tech";

/** Synthetic requests per tick for end-to-end percentiles (Spec 04: 1000). */
export const TICK_SAMPLES = 1000;

/** Backlog below this many seconds of work is treated as queueing noise (Erlang C covers it). */
export const BACKLOG_NOISE_SEC = 0.01;

export interface TickOptions extends SimConfig {
  /** Synthetic requests per tick. Default TICK_SAMPLES. */
  tickSamples?: number;
}

interface NodeState {
  /** Requests waiting at the station. */
  backlog: number;
  /** Queue/stream: undelivered messages per consumer edge. */
  lag: Map<string, number>;
  /** Circuit breaker nodes: closed / open / half-open (`core/breaker.ts`). */
  breaker?: Breaker;
  /**
   * A node with a technology's classes or throttle (component-technologies,
   * A.7): the second station's backlog (`backlog` holds station 0's) and a
   * burst quota's tokens. Dropped when the node's technology changes.
   */
  tech?: TechTickState;
}

/** The tick state of a node with a technology. */
export interface TechTickState {
  technology: string;
  /** Requests (operations) waiting at station 1: the SQL write primary, MongoDB's primaries. */
  primaryBacklog: number;
  /** Token bucket of a burst quota (AWS API Gateway); absent until the first tick. */
  tokens?: number;
}

interface TickFlow extends FlowView {
  /** Completion rate (includes a draining backlog). */
  completed: number;
  /** Arrivals / completions of the station itself (a resolver's lookups only), for utilization. */
  stationIn: number;
  stationOut: number;
  capacity: number;
  backlog: number;
  /** Queue/stream: total lag and whether it grew this tick. */
  lag: number;
  lagGrowing: boolean;
  /** Messages/s delivered to consumers. */
  delivered: number;
  rejected: number;
  overflow: number;
  /** Failed right away by a fault (dead instances still in rotation, node down). */
  refused: number;
  down: boolean;
  /** Technology nodes: refused by the quota or the hot partition, req/s (in `dropped`). */
  throttled?: number;
  /** Technology nodes: requests waiting over all the stations. */
  queueDepth?: number;
  /** Kafka: its busiest consumer edge on this tick's new messages (TEC-34). */
  consumerLimit?: ConsumerLimit;
  /** Reads this tick that may come from a copy behind the last write (a replica loss). */
  staleReadRps?: number;
  /** Share of this tick's served reads that is stale (with `staleReadRps`). */
  staleReadShare?: number;
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/* ---------- stations ---------- */

/** What a station is built from: a node, or one station of a technology. */
type StationCore = Pick<SimNode, "instances" | "serviceTimeMs">;

/** The station as Erlang C / the bounded queue sees it at arrival rate `lambda`. */
export function stableStation(
  core: StationCore,
  lambda: number,
  capacityPerInstance: number,
  maxQueue: number,
  horizonSec: number,
): StationState {
  return station({
    lambda,
    instances: core.instances,
    capacityPerInstance,
    serviceTimeMs: core.serviceTimeMs,
    maxQueue,
    horizonSec,
  });
}

/** Arrivals queue behind a real backlog: everyone waits Q/(cμ) (FIFO). */
export function backlogStation(
  core: StationCore,
  admitted: number,
  completed: number,
  overflow: number,
  capacityPerInstance: number,
  backlog: number,
  horizonSec: number,
): StationState {
  const idle = stableStation(core, 0, capacityPerInstance, Infinity, horizonSec);
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

/* ---------- technology nodes (component-technologies, A.7) ---------- */

export interface TechTickInput {
  profile: TechProfile;
  /** The node as faults left it. */
  core: TechCore;
  /** Arrivals this tick, req/s. */
  arriving: number;
  /** Share of them that are writes. */
  writeShare: number;
  /** Fault: share of the arrivals failed right away. */
  errorRate?: number;
  /** Fault: copies of its replica set a `replica-loss` isolated. */
  lostReplicas?: number;
  /** The node's `replicationLagMs`, when it has one (a synchronous copy: 0). */
  replicationLagMs?: number;
  /** Station 0's backlog before this tick. */
  backlog: number;
  /** Station 1's backlog before this tick. */
  primaryBacklog: number;
  /** A burst quota's tokens before this tick (absent: the bucket starts full). */
  tokens?: number;
  maxQueue: number;
  dtSec: number;
  horizonSec: number;
}

export interface TechTick {
  /** One per station of the profile, in its order. */
  stations: StationState[];
  view: TechFlowView;
  /** Requests completed this tick (a draining backlog included), req/s. */
  completed: number;
  /** Arrivals that won't fail here, req/s (≤ arriving). */
  served: number;
  dropped: number;
  /** Refused by the quota or the hot partition, req/s. */
  throttled: number;
  /** Lost to a full station, req/s. */
  overflow: number;
  /** Failed by the fault's error rate, req/s. */
  refused: number;
  backlog: number;
  primaryBacklog: number;
  tokens?: number;
  /** Requests waiting over all the stations. */
  queueDepth: number;
  /** Reads per second that may come from a copy behind the last write (0 without a loss). */
  staleReadRps: number;
  /** Share of the served reads that is stale (`lost / replicas`), only with `staleReadRps > 0`. */
  staleReadShare?: number;
}

// SPEC_DEVIATION: design.md lists `techTickFlow` in `core/tech.ts`.
// Reason: it steps each station with the tick's own fluid queue and station
// builders, which live here; `tech.ts` importing them would be a cycle.
/**
 * One tick of a node with a technology: the fault's error rate, then the
 * throttle (a burst quota through its token bucket), then each station's
 * fluid backlog exactly like a generic node's (work, done, overflow at
 * `maxQueue`), fed by the operations its classes send it. A station's
 * completions and overflow go back to the classes in proportion to their
 * operations this tick (the node's mix while only a backlog drains).
 */
export function techTickFlow(input: TechTickInput): TechTick {
  const { profile, core, maxQueue, horizonSec } = input;
  const dt = input.dtSec;
  const arriving = finite(Math.max(0, input.arriving));
  const ws = clamp01(input.writeShare);
  const failed = clamp01(input.errorRate ?? 0);
  const arrivingByClass = [arriving * (1 - ws), arriving * ws];
  const replica = profile.replicaSet
    ? replicaEffect(profile.replicaSet, input.lostReplicas, input.replicationLagMs)
    : undefined;
  // A refused class is lost to the lost quorum (in `dropped`), like an error.
  const refusedByClass = [
    replica?.refuseReads ? arrivingByClass[0] * (1 - failed) : 0,
    replica?.refuseWrites ? arrivingByClass[1] * (1 - failed) : 0,
  ];
  const refused = arriving * failed + refusedByClass[0] + refusedByClass[1];
  const throttle = profile.throttle;
  const bucket =
    throttle?.kind === "quota" && throttle.burst !== undefined
      ? { tokens: input.tokens ?? throttle.burst, dtSec: dt }
      : undefined;
  const adm = admit(
    throttle,
    {
      read: arrivingByClass[0] * (1 - failed) - refusedByClass[0],
      write: arrivingByClass[1] * (1 - failed) - refusedByClass[1],
    },
    capScaleOf(profile, core),
    bucket,
  );
  const classes = classesOf(profile, core);
  const routes = [classes.read, classes.write];
  const admitted = [adm.read, adm.write];
  const backlogs = [input.backlog, input.primaryBacklog];
  const completedByClass = [0, 0];
  const overflowByClass = [0, 0];
  let queueDepth = 0;
  const stations = classes.stations.map((s, i) => {
    const run = scaledStation(profile, s, core);
    const capacity = run.instances * run.capacityPerInstance;
    const opsByClass = routes.map((r, c) => (r.station === i ? admitted[c] * r.cost : 0));
    const ops = opsByClass[0] + opsByClass[1];
    let doneOps: number;
    let overflowOps = 0;
    let q: number;
    let st: StationState;
    if (maxQueue === 0) {
      st = stableStation(run, ops, run.capacityPerInstance, maxQueue, horizonSec);
      doneOps = Math.min(ops, st.servedRps);
      overflowOps = ops - doneOps;
      q = 0;
    } else {
      const work = (backlogs[i] ?? 0) + ops * dt;
      const done = Math.min(work, capacity * dt);
      q = work - done;
      if (q > maxQueue) {
        overflowOps = (q - maxQueue) / dt;
        q = maxQueue;
      }
      doneOps = done / dt;
      const backlogged = ops >= capacity || q > Math.max(1, capacity * BACKLOG_NOISE_SEC);
      st = backlogged
        ? backlogStation(run, ops, doneOps, overflowOps, run.capacityPerInstance, q, horizonSec)
        : stableStation(run, ops, run.capacityPerInstance, maxQueue, horizonSec);
    }
    backlogs[i] = q;
    queueDepth += st.regime === "stable" ? Math.max(q, st.queueDepth) : q;
    // Operations back to requests, by each class's share of the station's work.
    const weights =
      ops > 0
        ? opsByClass
        : routes.map((r, c) => (r.station === i ? (c === 0 ? 1 - ws : ws) * r.cost : 0));
    const total = weights[0] + weights[1];
    for (let c = 0; c < 2; c++) {
      if (!(total > 0) || weights[c] === 0) continue;
      const share = weights[c] / total / routes[c].cost;
      completedByClass[c] += doneOps * share;
      overflowByClass[c] += overflowOps * share;
    }
    return st;
  });
  const view = (c: number): TechClassView => {
    const route = routes[c];
    const st = stations[route.station] ?? stations[0];
    const served = Math.min(arrivingByClass[c], Math.max(0, admitted[c] - overflowByClass[c]));
    return {
      station: st,
      serviceTimeMs: st.serviceTimeMs * route.serviceScale,
      shape: route.shape,
      addMs: route.addMs,
      served,
      dropProbability: arrivingByClass[c] > 0 ? clamp01(1 - served / arrivingByClass[c]) : 0,
    };
  };
  const overflow = overflowByClass[0] + overflowByClass[1];
  // (a quota that let everything through leaves float noise in `throttled`)
  const throttled = isThrottled(adm.throttled, arriving) ? adm.throttled : 0;
  const dropped = Math.min(arriving, refused + throttled + overflow);
  const read = view(0);
  const write = view(1);
  // Only reads COMPLETED this tick can be stale: `view(0).served` also holds
  // the reads still queued at a saturated store, which never came back from a
  // copy, and would make the tick disagree with `analyze()`.
  const staleReadShare = replica?.staleShare ?? 0;
  const staleReadRps = completedByClass[0] * staleReadShare;
  return {
    stations,
    view: { ws, read, write },
    completed: finite(completedByClass[0] + completedByClass[1]),
    served: Math.max(0, arriving - dropped),
    dropped,
    throttled,
    overflow,
    refused,
    backlog: backlogs[0],
    primaryBacklog: backlogs[1] ?? 0,
    ...(adm.tokens !== undefined ? { tokens: adm.tokens } : {}),
    queueDepth: finite(queueDepth),
    staleReadRps,
    ...(staleReadRps > 0 ? { staleReadShare } : {}),
  };
}

export class TickSimulator {
  private graph!: SimGraph;
  private topo!: Topology;
  private edgesById = new Map<string, SimEdge>();
  private nodeState = new Map<string, NodeState>();
  /** Retry attempts by generation (index k = k+1-th retry), req/s, per edge. */
  private pending = new Map<string, number[]>();
  /**
   * Per edge: the previous tick's call failure. Reads after a cache miss go
   * to the database when the cache call fails, so this tick routes them by
   * the failure the last one measured (none on the first tick).
   */
  private lastFailure = new Map<string, number>();
  private rng: Rng;
  private ticks = 0;
  private readonly samples: number;
  private readonly options: TickOptions;
  private horizonSec = 10;
  private latencySlo: LatencySlo | null;
  /** Some node has a technology: split reads and writes (A.3). */
  private needsSplit = false;

  constructor(graph: SimGraph, options: TickOptions = {}) {
    this.options = { ...options };
    const s = options.tickSamples;
    this.samples = Number.isFinite(s) && s! >= 1 ? Math.min(20_000, Math.floor(s!)) : TICK_SAMPLES;
    this.rng = mulberry32(0);
    this.latencySlo = sanitizeLatencySlo(options.latencySlo);
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

  /** Back to t = 0: empty queues, no pending retries or past failures, PRNG reseeded. */
  reset(): void {
    this.ticks = 0;
    this.nodeState.clear();
    this.pending.clear();
    this.lastFailure = new Map();
    this.rng = mulberry32(resolveConfig(this.graph, this.topo.byId, this.options).seed);
  }

  /** Latency SLO for goodput (Spec 11), from the next tick; null = none. Never touches the PRNG. */
  setLatencySlo(slo: LatencySlo | null): void {
    this.latencySlo = sanitizeLatencySlo(slo);
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
    // A node whose technology changed starts its technology state afresh.
    for (const [id, st] of this.nodeState) {
      if (st.tech && st.tech.technology !== byId.get(id)?.tech?.technology) delete st.tech;
    }
    // SPEC_DEVIATION: A.3 splits only with classes or a throttle; every node
    // with a technology reports `writeRps`, so any technology turns it on.
    this.needsSplit = graph.nodes.some((n) => n.tech !== undefined);
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

  /** Advance one tick under an arrival rate λ (req/s) and the faults active now. */
  step(lambda: number, effects: TickEffects | null = null): TickSnapshot {
    const dt = TICK_SEC;
    const topo = withEffects(this.topo, effects);
    const { byId, order, entries, out, readRatio } = topo;
    const rate = Number.isFinite(lambda) && lambda > 0 ? lambda : 0;
    const edgeFx = (e: SimEdge) => effects?.edges.get(e.id);

    // 1. arrivals (the PRNG is consumed even without entries, for a stable
    //    stream); a traffic spike scales them globally or at its entry points
    const split = entryShares(entries, effects);
    const arrivals = samplePoisson(this.rng, rate * split.factor * dt);
    const offered = entries.length > 0 ? arrivals / dt : 0;

    const inflow = new Map<string, number>();
    entries.forEach((id, i) => inflow.set(id, (inflow.get(id) ?? 0) + offered * split.shares[i]));
    const base = new Map<string, number>();
    const load = new Map<string, number>();
    const shares = new Map<string, number>();
    const flows = new Map<string, TickFlow>();
    const callCtx: CallContext = { readRatio, byId, failure: this.lastFailure };
    // Read/write split (A.3), alongside the loads (which it never changes).
    const defaultWs = clamp01(1 - readRatio);
    const inflowWrite = this.needsSplit ? new Map<string, number>() : undefined;
    const nodeWs = this.needsSplit ? new Map<string, number>() : undefined;
    const edgeWs = this.needsSplit ? new Map<string, number>() : undefined;
    if (inflowWrite) for (const [id, v] of inflow) inflowWrite.set(id, v * defaultWs);

    // 2–3. propagate in order
    for (const id of order) {
      const node = byId.get(id)!;
      const state = this.stateOf(id);
      const arriving = finite(inflow.get(id) ?? 0);
      const maxQueue = maxQueueOf(node);
      const edges = out.get(id) ?? [];
      const fx = effects?.nodes.get(id);
      const ws = arriving > 0 ? clamp01((inflowWrite?.get(id) ?? 0) / arriving) : defaultWs;
      nodeWs?.set(id, ws);

      if (fx?.down) {
        // Down: every arrival fails, in-flight work is lost, nothing goes out.
        // A queue keeps its undelivered messages for when it comes back.
        state.backlog = 0;
        if (state.tech) state.tech.primaryBacklog = 0;
        let lag = 0;
        for (const v of state.lag.values()) lag += v;
        flows.set(id, {
          st: stableStation(node, 0, node.capacityPerInstance, maxQueue, this.horizonSec),
          offered: arriving,
          served: 0,
          dropped: arriving,
          completed: 0,
          stationIn: 0,
          stationOut: 0,
          capacity: 0,
          backlog: 0,
          lag,
          lagGrowing: false,
          delivered: 0,
          rejected: 0,
          overflow: 0,
          refused: arriving,
          down: true,
        });
        for (const e of edges) {
          base.set(e.id, 0);
          load.set(e.id, 0);
        }
        continue;
      }

      let flow: TickFlow;
      if (node.tech?.classes || node.tech?.throttle) {
        // A technology's classes, quota or hot partition (A.7).
        state.tech ??= { technology: node.tech.technology, primaryBacklog: 0 };
        const t = techTickFlow({
          profile: node.tech,
          core: node,
          arriving,
          writeShare: ws,
          errorRate: fx?.errorRate,
          lostReplicas: node.lostReplicas,
          replicationLagMs: replicationLagOf(node),
          backlog: state.backlog,
          primaryBacklog: state.tech.primaryBacklog,
          tokens: state.tech.tokens,
          maxQueue,
          dtSec: dt,
          horizonSec: this.horizonSec,
        });
        state.backlog = t.backlog;
        state.tech.primaryBacklog = t.primaryBacklog;
        if (t.tokens !== undefined) state.tech.tokens = t.tokens;
        flow = {
          st: t.stations[0],
          offered: arriving,
          served: t.served,
          dropped: t.dropped,
          completed: t.completed,
          stationIn: arriving,
          stationOut: t.completed,
          capacity: t.stations[0].capacityRps,
          backlog: t.backlog + t.primaryBacklog,
          lag: 0,
          lagGrowing: false,
          delivered: 0,
          rejected: 0,
          overflow: t.overflow,
          refused: t.refused,
          down: false,
          tech: t.view,
          throttled: t.throttled,
          queueDepth: t.queueDepth,
          ...(t.staleReadRps > 0 && t.staleReadShare !== undefined
            ? { staleReadRps: t.staleReadRps, staleReadShare: t.staleReadShare }
            : {}),
        };
      } else {
        let capacityPerInstance = node.capacityPerInstance;
        let admitted = arriving;
        let rejected = 0;
        if (node.routing === "rate-limiter") {
          const adm = rateLimit(node, arriving);
          admitted = adm.admitted;
          rejected = adm.rejected;
          capacityPerInstance = Math.min(capacityPerInstance, adm.capacityLimit / node.instances);
        }
        // A resolver only works on its uncached lookups; cached answers pass straight through.
        const share = lookupShareOf(node);
        const bypass = admitted * (1 - share);
        admitted -= bypass;
        // Dead instances still in rotation fail their share fast (no capacity
        // used) — of the lookups only, for a resolver.
        let refused = fx && fx.errorRate > 0 ? admitted * fx.errorRate : 0;
        admitted -= refused;
        if (node.routing === "breaker") {
          // Open (or half-open past its probes): fail fast, nothing reaches the dependency.
          state.breaker ??= closedBreaker(this.time);
          const pass = breakerAdmits(state.breaker, breakerParams(node), admitted, dt);
          refused += admitted - pass;
          admitted = pass;
        }
        const capacity = node.instances * capacityPerInstance;

        let completed: number;
        let overflow = 0;
        let st: StationState;
        if (maxQueue === 0) {
          // No buffer: M/M/c/c loss system, nothing carries over.
          st = stableStation(node, admitted, capacityPerInstance, maxQueue, this.horizonSec);
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
            ? backlogStation(
                node,
                admitted,
                completed,
                overflow,
                capacityPerInstance,
                q,
                this.horizonSec,
              )
            : stableStation(node, admitted, capacityPerInstance, maxQueue, this.horizonSec);
        }

        const stationOut = completed;
        completed += bypass; // cached answers leave with the completed lookups
        const dropped = Math.min(arriving, rejected + overflow + refused);
        flow = {
          st,
          offered: arriving,
          served: Math.max(0, arriving - dropped),
          dropped,
          completed,
          stationIn: share < 1 ? admitted : arriving,
          stationOut,
          capacity,
          backlog: state.backlog,
          lag: 0,
          lagGrowing: false,
          delivered: 0,
          rejected,
          overflow,
          refused,
          down: false,
        };
      }
      flows.set(id, flow);
      const completed = flow.completed;
      if (edges.length === 0) continue;

      const push = (e: SimEdge, baseLoad: number) => {
        const gens = this.pending.get(e.id);
        let total = baseLoad;
        if (gens) for (const g of gens) total += g;
        base.set(e.id, baseLoad);
        load.set(e.id, total);
        const severed = edgeFx(e)?.severed;
        // A severed link: the calls are made (and fail), nothing arrives.
        if (!severed) inflow.set(e.target, (inflow.get(e.target) ?? 0) + total);
        if (inflowWrite && edgeWs) {
          const w = edgeWriteShare(e, node, ws, callCtx);
          edgeWs.set(e.id, w);
          if (!severed) inflowWrite.set(e.target, (inflowWrite.get(e.target) ?? 0) + total * w);
        }
      };

      if (node.routing === "lb") {
        const targets = edges.map((e) => byId.get(e.target)!);
        const split = drainShares(
          lbShares(node, targets, (t) => inflow.get(t) ?? 0),
          edges.map((e) => edgeFx(e)?.drained === true),
        );
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
        const consumers: { target: SimNode; demand: number }[] = [];
        for (const e of edges) {
          const prev = state.lag.get(e.id) ?? 0;
          const factor = edgeFactor(e, node, callCtx);
          if (node.tech)
            consumers.push({ target: byId.get(e.target)!, demand: completed * factor });
          const pendingMsgs = prev + completed * factor * dt;
          const pull = edgeFx(e)?.severed ? 0 : consumerCapacity(node, byId.get(e.target)!);
          const drained = Math.min(pendingMsgs, pull * dt);
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
        const consumerLimit = kafkaLimit(node, consumers);
        if (consumerLimit) flow.consumerLimit = consumerLimit;
        flow.delivered = delivered;
        if (lost > 0) {
          // A full queue refuses publishes: producers see it as drops here.
          flow.overflow += lost;
          flow.dropped = Math.min(arriving, flow.dropped + lost);
          flow.served = Math.max(0, arriving - flow.dropped);
        }
      } else {
        for (const e of edges) push(e, completed * edgeFactor(e, node, callCtx));
      }
    }

    // reverse pass: timeouts, call failure, success, availability
    const settled = settle(topo, flows, shares, edgeWs);
    this.lastFailure = settled.failure;
    this.advanceBreakers(topo, flows, load, settled, dt);

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
      { nodes: sampleNodesFor(topo, flows, shares), entries, readRatio },
      this.samples,
      this.rng,
      this.latencySlo?.thresholdMs,
    );
    const slowShare = slowShareOf(this.latencySlo, sampled.slowShare, byId.values(), flows);

    this.ticks++;
    return this.snapshot(topo, offered, flows, load, settled, sampled.latency, slowShare, nodeWs);
  }

  /**
   * Each breaker sees the calls it forwarded this tick fail at the rate its
   * outgoing edges did (downstream errors, timeouts), weighted by load.
   */
  private advanceBreakers(
    topo: Topology,
    flows: ReadonlyMap<string, TickFlow>,
    load: ReadonlyMap<string, number>,
    settled: Settled,
    dt: number,
  ): void {
    const now = round6((this.ticks + 1) * TICK_SEC);
    for (const id of topo.order) {
      const node = topo.byId.get(id)!;
      const state = this.nodeState.get(id);
      if (node.routing !== "breaker" || !state?.breaker) continue;
      const flow = flows.get(id)!;
      let weight = 0;
      let failed = 0;
      for (const e of topo.out.get(id) ?? []) {
        if (e.async) continue;
        const l = load.get(e.id) ?? 0;
        weight += l;
        failed += l * (settled.failure.get(e.id) ?? 0);
      }
      const failure = weight > 0 ? failed / weight : 0;
      const passed = flow.down ? 0 : flow.served;
      state.breaker = advanceBreaker(state.breaker, breakerParams(node), passed, failure, now, dt);
    }
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
    topo: Topology,
    offered: number,
    flows: Map<string, TickFlow>,
    load: Map<string, number>,
    settled: Settled,
    latency: { p50Ms: number; p95Ms: number; p99Ms: number },
    slowShare: number,
    nodeWs?: ReadonlyMap<string, number>,
  ): TickSnapshot {
    const { entries } = this.topo;
    const nodes: Record<string, NodeRuntimeMetrics> = {};
    for (const n of this.graph.nodes) {
      const flow = flows.get(n.id);
      if (!flow) {
        nodes[n.id] = idleMetrics();
        continue;
      }
      // A node with a technology: its limiting resource on the offered demand,
      // the same `techLimitOf` as `analyze()` (TEC-41, D5).
      const sim = topo.byId.get(n.id) ?? n;
      const ws = nodeWs?.get(n.id) ?? clamp01(1 - topo.readRatio);
      const techLimit = sim.tech
        ? techLimitOf(sim.tech, sim, {
            read: flow.offered * (1 - ws),
            write: flow.offered * ws,
          })
        : undefined;
      // Kafka: its consumers when their busiest edge is fuller than the brokers.
      const consumers = flow.consumerLimit;
      const limit =
        techLimit && consumers && consumers.utilization > techLimit.utilization
          ? consumers
          : techLimit;
      const util = limit
        ? finite(limit.utilization)
        : flow.capacity > 0
          ? Math.max(flow.stationIn, flow.stationOut) / flow.capacity
          : 0;
      const queueDepth =
        flow.queueDepth ??
        (flow.st.regime === "stable" ? Math.max(flow.backlog, flow.st.queueDepth) : flow.backlog);
      const tech = flow.tech;
      const m: NodeRuntimeMetrics = {
        rpsIn: finite(flow.offered),
        rpsOut: finite(flow.completed),
        utilization: finite(util),
        queueDepth: finite(queueDepth + flow.lag),
        p50: finite(tech ? techPercentileMs(tech, 0.5) : hopPercentileMs(flow.st, 0.5)),
        p95: finite(tech ? techPercentileMs(tech, 0.95) : hopPercentileMs(flow.st, 0.95)),
        p99: finite(tech ? techPercentileMs(tech, 0.99) : hopPercentileMs(flow.st, 0.99)),
        errorRate: flow.offered > 0 ? clamp01(flow.dropped / flow.offered) : 0,
        drops: finite(flow.dropped),
        status: nodeStatus(flow, util),
        ...(limit
          ? {
              limitKind: limit.kind,
              limitUtilization: finite(util),
              writeRps: finite(flow.offered * ws),
            }
          : {}),
        ...(flow.staleReadRps !== undefined
          ? {
              staleReadRps: finite(flow.staleReadRps),
              ...(flow.staleReadShare !== undefined
                ? { staleReadShare: finite(flow.staleReadShare) }
                : {}),
            }
          : {}),
      };
      if (n.routing === "queue") {
        // Lag in seconds of consumption; unknown (omitted) when nothing is consumed.
        m.extra = flow.delivered > 0 ? { queueLagSec: finite(flow.lag / flow.delivered) } : {};
      } else if (n.routing === "cache") {
        m.extra = { hitRatio: hitRateOf(topo.byId.get(n.id) ?? n) };
      } else if (n.routing === "breaker") {
        m.extra = { breakerState: this.nodeState.get(n.id)?.breaker?.state ?? "closed" };
      }
      nodes[n.id] = m;
    }

    const edges: Record<string, EdgeRuntimeMetrics> = {};
    const edgeLinkFailure: Record<string, number> = {};
    for (const e of this.edgesById.values()) {
      const target = nodes[e.target]?.status;
      const f = e.back ? 0 : (settled.failure.get(e.id) ?? 0);
      edgeLinkFailure[e.id] = e.back ? 0 : (settled.linkFailure.get(e.id) ?? 0);
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
        goodput: finite(throughput * (1 - slowShare)),
        errorRate: offered > 0 ? clamp01(1 - throughput / offered) : 0,
        p50: finite(latency.p50Ms),
        p95: finite(latency.p95Ms),
        p99: finite(latency.p99Ms),
        availability: entries.length > 0 ? clamp01(mean(settled.avail)) : 0,
        readRatio: topo.readRatio,
      },
      edgeLinkFailure,
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
  if (flow.down) return "down";
  if (flow.offered <= 0 && flow.backlog <= 0 && flow.lag <= 0) return "ok";
  if (
    util > UTILIZATION_CRITICAL ||
    flow.overflow > 0 ||
    flow.lagGrowing ||
    flow.refused > 0 ||
    isThrottled(flow.throttled, flow.offered)
  )
    return "critical";
  if (util > UTILIZATION_WARNING || flow.lag > 0.5 || flow.rejected > 0) return "warn";
  return "ok";
}
