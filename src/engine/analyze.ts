/**
 * Instant steady-state analysis (Spec 04, Phase 1: `analyze()`).
 *
 * 1. Propagate the offered load in the compiled order (Kahn + cycle handling;
 *    back edges carry nothing). Each node is an M/M/c station
 *    (core/queueing.ts) and routes its SERVED flow by kind (core/routing.ts).
 * 2. Retries: an edge out of a node with `maxRetries` R carries
 *    λ(1 − f^{R+1})/(1 − f), where f is the call's failure fraction (drops,
 *    timeouts, packet loss, downstream failure). f depends on the load it
 *    creates, so steps 1–2 iterate to a fixed point (monotone: from f = 0 the
 *    load only grows, bounded by (R+1)×).
 * 3. End-to-end success and availability by a reverse pass over the sync
 *    path; latency percentiles by sampling requests (core/sampler.ts).
 *
 * Deterministic for a given graph + config (seeded PRNG). Never throws.
 */
import type { SimEdge, SimGraph, SimNode } from "@/domain/graph/compile";
import { PARAM } from "@/domain/components/registry";
import { UTILIZATION_CRITICAL, UTILIZATION_WARNING } from "./constants";
import {
  DEFAULT_HORIZON_SEC,
  clamp01,
  hopPercentileMs,
  probSojournExceeds,
  retryAmplification,
  station,
  type StationState,
} from "./core/queueing";
import { DEFAULT_SEED, mulberry32 } from "./core/rng";
import {
  DEFAULT_READ_RATIO,
  availabilityOf,
  callsOf,
  consumerCapacity,
  forwardEdges,
  hitRateOf,
  lbShares,
  maxQueueOf,
  maxRetriesOf,
  paramNumber,
  rateLimit,
  ruleFactor,
  ruleProbability,
  timeoutMsOf,
} from "./core/routing";
import { sampleLatency, type SampleEdge, type SampleNode } from "./core/sampler";
import type { EdgeSteadyState, NodeSteadyState, SimConfig, SteadyState } from "./types";
import type { NodeStatus } from "@/types/simulation";

export const DEFAULT_SAMPLES = 2000;
export const DEFAULT_MAX_ITERATIONS = 200;
const MAX_SAMPLES = 20_000;
const CONVERGENCE_TOLERANCE = 1e-10;

interface ResolvedConfig {
  seed: number;
  samples: number;
  horizonSec: number;
  readRatio: number;
  maxIterations: number;
}

function resolveConfig(graph: SimGraph, byId: Map<string, SimNode>, config?: SimConfig) {
  const c = config ?? {};
  const entryRatio = graph.entryIds
    .map((id) => byId.get(id))
    .map((n) => (n ? paramNumber(n, PARAM.readRatio, NaN) : NaN))
    .find((v) => v >= 0 && v <= 1);
  const resolved: ResolvedConfig = {
    seed: Number.isFinite(c.seed) ? Math.trunc(c.seed!) : DEFAULT_SEED,
    samples:
      Number.isFinite(c.samples) && c.samples! >= 1
        ? Math.min(MAX_SAMPLES, Math.floor(c.samples!))
        : DEFAULT_SAMPLES,
    horizonSec:
      Number.isFinite(c.horizonSec) && c.horizonSec! > 0 ? c.horizonSec! : DEFAULT_HORIZON_SEC,
    readRatio:
      Number.isFinite(c.readRatio) && c.readRatio! >= 0 && c.readRatio! <= 1
        ? c.readRatio!
        : (entryRatio ?? DEFAULT_READ_RATIO),
    maxIterations:
      Number.isFinite(c.maxIterations) && c.maxIterations! >= 1
        ? Math.floor(c.maxIterations!)
        : DEFAULT_MAX_ITERATIONS,
  };
  return resolved;
}

/** Per-node result of one propagation pass. */
interface NodeFlow {
  offered: number;
  served: number;
  dropped: number;
  capacity: number;
  st: StationState;
  /** Queue/stream: undrained backlog (messages). */
  backlog: number;
  lagging: boolean;
  rejected: number;
}

interface Pass {
  flows: Map<string, NodeFlow>;
  /** Edge load before retries. */
  base: Map<string, number>;
  /** Edge load with retries. */
  load: Map<string, number>;
  /** LB split shares by edge id. */
  shares: Map<string, number>;
}

function status(offered: number, utilization: number): NodeStatus {
  if (offered <= 0) return "idle";
  if (utilization > UTILIZATION_CRITICAL) return "critical";
  if (utilization > UTILIZATION_WARNING) return "warning";
  return "healthy";
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export function analyze(graph: SimGraph, rps: number, config?: SimConfig): SteadyState {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const cfg = resolveConfig(graph, byId, config);
  const requestedRps = Number.isFinite(rps) && rps > 0 ? rps : 0;
  const warnings = [...graph.warnings];

  const order = graph.order.filter((id) => byId.has(id));
  const entries = graph.entryIds.filter((id) => byId.has(id));
  const out = forwardEdges(graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)));
  const offeredRps = entries.length > 0 ? requestedRps : 0;

  const retrying = order.some(
    (id) => maxRetriesOf(byId.get(id)!) > 0 && (out.get(id)?.length ?? 0) > 0,
  );

  /* ---------- forward pass: load propagation ---------- */
  const propagate = (failure: Map<string, number>): Pass => {
    const inflow = new Map<string, number>();
    for (const id of entries) inflow.set(id, (inflow.get(id) ?? 0) + offeredRps / entries.length);
    const flows = new Map<string, NodeFlow>();
    const base = new Map<string, number>();
    const load = new Map<string, number>();
    const shares = new Map<string, number>();

    for (const id of order) {
      const node = byId.get(id)!;
      const offered = finite(inflow.get(id) ?? 0);
      const edges = out.get(id) ?? [];
      const maxQueue = maxQueueOf(node);
      let capacityPerInstance = node.capacityPerInstance;
      let admitted = offered;
      let rejected = 0;

      if (node.routing === "rate-limiter") {
        const adm = rateLimit(node, offered);
        admitted = adm.admitted;
        rejected = adm.rejected;
        capacityPerInstance = Math.min(capacityPerInstance, adm.capacityLimit / node.instances);
      }

      const st = station({
        lambda: admitted,
        instances: node.instances,
        capacityPerInstance,
        serviceTimeMs: node.serviceTimeMs,
        maxQueue,
        horizonSec: cfg.horizonSec,
      });
      const served = Math.min(offered, Math.max(0, st.servedRps));
      const flow: NodeFlow = {
        offered,
        served,
        dropped: Math.max(0, offered - served),
        capacity: st.capacityRps,
        st,
        backlog: 0,
        lagging: false,
        rejected,
      };
      flows.set(id, flow);
      if (edges.length === 0) continue;

      const retries = maxRetriesOf(node);
      const push = (e: SimEdge, baseLoad: number) => {
        const amplified = baseLoad * retryAmplification(failure.get(e.id) ?? 0, retries);
        base.set(e.id, baseLoad);
        load.set(e.id, amplified);
        inflow.set(e.target, (inflow.get(e.target) ?? 0) + amplified);
      };

      if (node.routing === "lb") {
        const targets = edges.map((e) => byId.get(e.target)!);
        const split = lbShares(node, targets, (t) => inflow.get(t) ?? 0);
        edges.forEach((e, i) => {
          shares.set(e.id, split[i]);
          push(e, served * split[i]);
        });
      } else if (node.routing === "queue") {
        // Decoupled: each consumer edge drains at most its consumer capacity;
        // the rest piles up as lag (bounded by maxQueue, then lost).
        let lag = 0;
        for (const e of edges) {
          const demand = served * ruleFactor(e.rule, node, cfg.readRatio);
          const drained = Math.min(demand, consumerCapacity(node, byId.get(e.target)!));
          lag += demand - drained;
          push(e, drained);
        }
        flow.backlog = Math.min(maxQueue, lag * cfg.horizonSec);
        flow.lagging = lag > 1e-9;
      } else {
        for (const e of edges) push(e, served * ruleFactor(e.rule, node, cfg.readRatio));
      }
    }
    return { flows, base, load, shares };
  };

  /* ---------- reverse pass: success, call failure, availability ---------- */
  const settle = (pass: Pass) => {
    const success = new Map<string, number>();
    const failure = new Map<string, number>();
    const avail = new Map<string, number>();
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const node = byId.get(id)!;
      const flow = pass.flows.get(id)!;
      const edges = out.get(id) ?? [];
      const timeout = timeoutMsOf(node);
      const retries = maxRetriesOf(node);
      const nodeAvail = 1 - (1 - availabilityOf(node)) ** node.instances;

      for (const e of edges) {
        const target = pass.flows.get(e.target)!;
        const timedOut = timeout === undefined ? 0 : probSojournExceeds(target.st, timeout);
        const ok = (1 - e.rule.packetLoss) * (1 - timedOut) * (success.get(e.target) ?? 1);
        failure.set(e.id, clamp01(1 - ok));
      }

      const servedFraction = flow.offered > 0 ? flow.served / flow.offered : 1;
      const sync = node.routing === "queue" ? [] : edges.filter((e) => !e.async);
      const callOk = (e: SimEdge) => 1 - (failure.get(e.id) ?? 0) ** (retries + 1);

      let s = servedFraction;
      let a = nodeAvail;
      if (sync.length > 0 && node.routing === "lb") {
        // Exactly one target per request; targets are redundant for availability.
        let ok = 0;
        let down = 1;
        for (const e of edges) {
          const share = pass.shares.get(e.id) ?? 0;
          ok += share * (e.async ? 1 : callOk(e));
          if (!e.async) down *= 1 - (avail.get(e.target) ?? 1);
        }
        s *= ok;
        a *= 1 - down;
      } else {
        for (const e of sync) {
          const q = ruleProbability(e.rule, node, cfg.readRatio);
          const k = callsOf(e.rule);
          s *= 1 - q + q * callOk(e) ** k;
          a *= 1 - q + q * (avail.get(e.target) ?? 1);
        }
      }
      success.set(id, clamp01(s));
      avail.set(id, clamp01(a));
    }
    return { success, failure, avail };
  };

  /* ---------- fixed point for retry amplification ---------- */
  let failure = new Map<string, number>();
  let pass = propagate(failure);
  let settled = settle(pass);
  let iterations = 1;
  if (retrying) {
    for (; iterations < cfg.maxIterations; iterations++) {
      failure = settled.failure;
      const next = propagate(failure);
      let delta = 0;
      let scale = 1;
      for (const [id, v] of next.load) {
        delta = Math.max(delta, Math.abs(v - (pass.load.get(id) ?? 0)));
        scale = Math.max(scale, v);
      }
      pass = next;
      settled = settle(pass);
      if (delta <= CONVERGENCE_TOLERANCE * scale) break;
    }
    if (iterations >= cfg.maxIterations) {
      warnings.push("Retry load did not fully settle; figures are approximate.");
    }
  }

  /* ---------- per-node results ---------- */
  const nodes: NodeSteadyState[] = graph.nodes.map((node) => {
    const flow = pass.flows.get(node.id);
    const st =
      flow?.st ??
      station({
        lambda: 0,
        instances: node.instances,
        capacityPerInstance: node.capacityPerInstance,
        serviceTimeMs: node.serviceTimeMs,
        maxQueue: maxQueueOf(node),
        horizonSec: cfg.horizonSec,
      });
    const offered = flow?.offered ?? 0;
    const served = flow?.served ?? 0;
    const dropped = flow?.dropped ?? 0;
    const utilization = finite(st.utilization);
    let nodeStatus = status(offered, utilization);
    let bottleneck = utilization > UTILIZATION_CRITICAL;
    if (flow?.lagging) {
      nodeStatus = "critical";
      bottleneck = true;
    } else if (flow && flow.rejected > 0 && nodeStatus === "healthy") {
      nodeStatus = "warning";
    }
    return {
      nodeId: node.id,
      componentId: node.componentId,
      routing: node.routing,
      offeredRps: offered,
      servedRps: served,
      droppedRps: dropped,
      errorRate: offered > 0 ? clamp01(dropped / offered) : 0,
      capacityRps: finite(st.capacityRps),
      utilization,
      meanLatencyMs: finite(st.serviceTimeMs + st.meanWaitMs),
      p50Ms: finite(hopPercentileMs(st, 0.5)),
      p95Ms: finite(hopPercentileMs(st, 0.95)),
      p99Ms: finite(hopPercentileMs(st, 0.99)),
      queueWaitMs: finite(st.meanWaitMs),
      queueDepth: finite(st.queueDepth + (flow?.backlog ?? 0)),
      availability: clamp01(1 - (1 - availabilityOf(node)) ** node.instances),
      status: nodeStatus,
      isBottleneck: bottleneck,
    };
  });

  const edges: EdgeSteadyState[] = graph.edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => {
      const b = pass.base.get(e.id) ?? 0;
      const l = pass.load.get(e.id) ?? 0;
      return {
        edgeId: e.id,
        source: e.source,
        target: e.target,
        rps: finite(l),
        retryAmplification: b > 0 ? finite(l / b, 1) : 1,
        failureRate: e.back ? 0 : clamp01(settled.failure.get(e.id) ?? 0),
        async: e.async,
        back: e.back,
      };
    });

  /* ---------- end to end ---------- */
  const mean = (m: Map<string, number>) =>
    entries.length === 0 ? 0 : entries.reduce((s, id) => s + (m.get(id) ?? 0), 0) / entries.length;
  const successRate = clamp01(mean(settled.success));
  const throughputRps = Math.min(offeredRps, offeredRps * successRate);

  const sampleNodes = new Map<string, SampleNode>();
  for (const id of order) {
    const node = byId.get(id)!;
    const flow = pass.flows.get(id)!;
    // LB: keep async targets so their share still counts (the user isn't kept waiting).
    const sync: SampleEdge[] =
      node.routing === "queue"
        ? []
        : (out.get(id) ?? [])
            .filter((e) => node.routing === "lb" || !e.async)
            .map((e) => ({
              async: e.async,
              target: e.target,
              kind: e.rule.kind,
              fraction: clamp01(e.rule.fraction ?? 1),
              callsPerRequest: node.routing === "lb" ? 1 : callsOf(e.rule),
              networkLatencyMs: e.rule.networkLatencyMs,
              packetLoss: e.rule.packetLoss,
              share: pass.shares.get(e.id) ?? 0,
            }));
    sampleNodes.set(id, {
      station: flow.st,
      dropProbability: flow.offered > 0 ? clamp01(flow.dropped / flow.offered) : 0,
      kind: node.routing === "lb" ? "lb" : node.routing === "queue" ? "queue" : "rules",
      timeoutMs: timeoutMsOf(node),
      maxRetries: maxRetriesOf(node),
      missProbability: 1 - hitRateOf(node),
      edges: sync,
    });
  }
  const sampled = sampleLatency(
    { nodes: sampleNodes, entries, readRatio: cfg.readRatio },
    cfg.samples,
    mulberry32(cfg.seed),
  );
  if (sampled.truncated) {
    warnings.push("Very large fan-out: latency sampling was truncated for some requests.");
  }

  for (const n of nodes) {
    const flow = pass.flows.get(n.nodeId);
    if (flow?.lagging) {
      warnings.push(
        `${byId.get(n.nodeId)!.label}: consumers can't keep up, backlog grows (lag ${Math.round(n.queueDepth)} messages after ${cfg.horizonSec}s).`,
      );
    }
  }

  return {
    requestedRps,
    offeredRps,
    throughputRps: finite(throughputRps),
    errorRate: offeredRps > 0 ? clamp01(1 - throughputRps / offeredRps) : 0,
    availability: entries.length > 0 ? clamp01(mean(settled.avail)) : 0,
    latency: {
      meanMs: finite(sampled.latency.meanMs),
      p50Ms: finite(sampled.latency.p50Ms),
      p95Ms: finite(sampled.latency.p95Ms),
      p99Ms: finite(sampled.latency.p99Ms),
    },
    nodes,
    edges,
    entryIds: entries,
    bottleneckIds: nodes.filter((n) => n.isBottleneck).map((n) => n.nodeId),
    warnings,
    seed: cfg.seed,
    iterations,
  };
}
