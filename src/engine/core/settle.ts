/**
 * Shared by `analyze()` and the tick loop (`core/tick.ts`): the reverse pass
 * that turns per-node stations into call failure / end-to-end success /
 * availability, and the model the latency sampler walks.
 */
import type { PlannedCall } from "@/domain/graph/callPlan";
import type { SimEdge, SimNode } from "@/domain/graph/compile";
import { clamp01, probSojournExceeds, type StationState } from "./queueing";
import {
  availabilityOf,
  callProbability,
  callsOf,
  edgeCallsOf,
  hitRateOf,
  lookupShareOf,
  maxRetriesOf,
  timeoutMsOf,
  type CallContext,
} from "./routing";
import type { SampleCall, SampleEdge, SampleNode } from "./sampler";

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
  /**
   * Per edge: the link's and the caller's share of `failure` only, 1 − (1 −
   * packet loss) × (1 − P(caller's timeout)), without the target's own
   * failure (request-flow FLW-05: the balls fail a call with it, then walk
   * the target's failures themselves).
   */
  linkFailure: Map<string, number>;
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
  const linkFailure = new Map<string, number>();
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
      // The round trip on the link eats into the caller's timeout (as in the sampler).
      const timedOut =
        timeout === undefined
          ? 0
          : probSojournExceeds(target.st, timeout - 2 * e.rule.networkLatencyMs);
      const linkOk = (1 - e.rule.packetLoss) * (1 - timedOut);
      const ok = linkOk * (success.get(e.target) ?? 1);
      failure.set(e.id, clamp01(1 - ok));
      linkFailure.set(e.id, clamp01(1 - linkOk));
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
      // A look-aside cache call's failure is a miss (the call after it goes
      // to the database), so it never fails the request or its availability.
      const absorbed = node.plan?.absorbed ?? [];
      const ctx: CallContext = { readRatio, byId, failure };
      for (const e of sync) {
        if (absorbed.includes(e.id)) continue;
        for (const c of edgeCallsOf(e, node)) {
          const q = callProbability(c.call, node, ctx, c.dependsOn);
          const k = callsOf(c.call);
          s *= 1 - q + q * callOk(e) ** k;
          a *= 1 - q + q * (avail.get(e.target) ?? 1);
        }
      }
    }
    success.set(id, clamp01(s));
    avail.set(id, clamp01(a));
  }
  return { success, failure, linkFailure, avail };
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
    const edges = out.get(id) ?? [];
    // LB: keep async targets so their share still counts (the user isn't kept
    // waiting); one entry per edge (the LB picks a target, rules don't apply).
    const lbEdges: SampleEdge[] =
      node.routing === "lb"
        ? edges.map((e) => {
            const call = e.rule.calls[0];
            return {
              edgeId: e.id,
              async: e.async,
              target: e.target,
              kind: call?.kind ?? "always",
              fraction: clamp01(call?.fraction ?? 1),
              callsPerRequest: 1,
              networkLatencyMs: e.rule.networkLatencyMs,
              packetLoss: e.rule.packetLoss,
              share: shares.get(e.id) ?? 0,
            };
          })
        : [];
    // Other nodes (not queues): the sync calls by step, as the call plan
    // orders them; the link (latency, loss) from the edge as faults left it.
    const plan = node.routing === "lb" || node.routing === "queue" ? undefined : node.plan;
    const link = new Map(edges.map((e) => [e.id, e]));
    const sampleCall = (p: PlannedCall): SampleCall[] => {
      const e = link.get(p.edgeId);
      if (!e) return [];
      const call: SampleCall = {
        edgeId: e.id,
        target: e.target,
        kind: p.call.kind,
        fraction: clamp01(p.call.fraction ?? 1),
        callsPerRequest: callsOf(p.call),
        networkLatencyMs: e.rule.networkLatencyMs,
        packetLoss: e.rule.packetLoss,
        step: p.step,
      };
      if (p.dependsOn !== undefined) {
        call.dependsOn = p.dependsOn;
        call.missOf = p.call.missOf;
      }
      return [call];
    };
    const steps: SampleCall[][] = (plan?.steps ?? []).map((group) => group.flatMap(sampleCall));
    // Async calls (the trace only): in step order, as they go out.
    const asyncCalls = (plan?.async ?? [])
      .flatMap(sampleCall)
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
    sampleNodes.set(id, {
      station: flow.st,
      dropProbability: flow.offered > 0 ? clamp01(flow.dropped / flow.offered) : 0,
      latencyShare: lookupShareOf(node),
      kind: node.routing === "lb" ? "lb" : node.routing === "queue" ? "queue" : "rules",
      timeoutMs: timeoutMsOf(node),
      maxRetries: maxRetriesOf(node),
      missProbability: 1 - hitRateOf(node),
      edges: lbEdges,
      steps: steps.filter((group) => group.length > 0),
      absorbed: plan?.absorbed ?? [],
      asyncCalls,
    });
  }
  return sampleNodes;
}
