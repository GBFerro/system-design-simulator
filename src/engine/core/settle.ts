/**
 * Shared by `analyze()` and the tick loop (`core/tick.ts`): the reverse pass
 * that turns per-node stations into call failure / end-to-end success /
 * availability, and the model the latency sampler walks.
 */
import type { SimEdge, SimNode } from "@/domain/graph/compile";
import { clamp01, probSojournExceeds, type StationState } from "./queueing";
import {
  availabilityOf,
  callsOf,
  hitRateOf,
  maxRetriesOf,
  ruleProbability,
  timeoutMsOf,
} from "./routing";
import type { SampleEdge, SampleNode } from "./sampler";

/** The graph as both passes walk it. */
export interface Topology {
  byId: Map<string, SimNode>;
  /** Processing order (compiled order, unknown ids removed). */
  order: string[];
  entries: string[];
  /** Forward edges out of each node. */
  out: Map<string, SimEdge[]>;
  readRatio: number;
}

/** What the passes need from one node's flow. */
export interface FlowView {
  st: StationState;
  /** Arrivals, req/s. */
  offered: number;
  /** Arrivals admitted (not dropped/rejected), req/s; ≤ offered. */
  served: number;
  /** Arrivals dropped/rejected, req/s. */
  dropped: number;
}

export interface Settled {
  /** Per node: probability a request entering it ends successfully. */
  success: Map<string, number>;
  /** Per edge: probability a single call fails (drop, timeout, loss, downstream failure). */
  failure: Map<string, number>;
  /** Per node: composed availability of it and its sync dependencies. */
  avail: Map<string, number>;
}

/** Reverse pass over the sync path: success, call failure, availability. */
export function settle(
  topo: Topology,
  flows: ReadonlyMap<string, FlowView>,
  shares: ReadonlyMap<string, number>,
): Settled {
  const { byId, order, out, readRatio } = topo;
  const success = new Map<string, number>();
  const failure = new Map<string, number>();
  const avail = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const node = byId.get(id)!;
    const flow = flows.get(id)!;
    const edges = out.get(id) ?? [];
    const timeout = timeoutMsOf(node);
    const retries = maxRetriesOf(node);
    const nodeAvail = 1 - (1 - availabilityOf(node)) ** node.instances;

    for (const e of edges) {
      const target = flows.get(e.target)!;
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
        const share = shares.get(e.id) ?? 0;
        ok += share * (e.async ? 1 : callOk(e));
        if (!e.async) down *= 1 - (avail.get(e.target) ?? 1);
      }
      s *= ok;
      a *= 1 - down;
    } else {
      for (const e of sync) {
        const q = ruleProbability(e.rule, node, readRatio);
        const k = callsOf(e.rule);
        s *= 1 - q + q * callOk(e) ** k;
        a *= 1 - q + q * (avail.get(e.target) ?? 1);
      }
    }
    success.set(id, clamp01(s));
    avail.set(id, clamp01(a));
  }
  return { success, failure, avail };
}

/** Per-node model for `sampleLatency` (user path only). */
export function sampleNodesFor(
  topo: Topology,
  flows: ReadonlyMap<string, FlowView>,
  shares: ReadonlyMap<string, number>,
): Map<string, SampleNode> {
  const { byId, order, out } = topo;
  const sampleNodes = new Map<string, SampleNode>();
  for (const id of order) {
    const node = byId.get(id)!;
    const flow = flows.get(id)!;
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
              share: shares.get(e.id) ?? 0,
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
  return sampleNodes;
}
