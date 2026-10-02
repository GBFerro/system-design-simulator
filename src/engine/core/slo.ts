/**
 * Latency SLO in the engine (Spec 11): which successful requests are too slow
 * to count as good, so `goodput` = successful requests within the threshold.
 * Shared by `analyze()` and the tick so both count the same way.
 */
import type { SimNode } from "@/domain/graph/compile";
import type { LatencySlo } from "../types";
import { clamp01, probSojournExceeds } from "./queueing";
import { lookupShareOf } from "./routing";
import type { FlowView } from "./settle";

/** A usable latency SLO, or null (no threshold: every success is good). */
export function sanitizeLatencySlo(slo: LatencySlo | null | undefined): LatencySlo | null {
  if (!slo || !Number.isFinite(slo.thresholdMs) || !(slo.thresholdMs > 0)) return null;
  return {
    thresholdMs: slo.thresholdMs,
    ...(typeof slo.scope === "string" && slo.scope.length > 0 ? { scope: slo.scope } : {}),
  };
}

/**
 * Share of successful requests slower than the SLO's threshold. End to end
 * it's what the sampler counted (`endToEnd`). Scoped to a component type, it's
 * P(hop > threshold) at the nodes of that type, weighted by their load — the
 * same sojourn tail the timeouts use; requests a resolver answers from cache
 * never pay its hop. No such node with traffic → the end-to-end share.
 */
export function slowShareOf(
  slo: LatencySlo | null,
  endToEnd: number,
  nodes: Iterable<SimNode>,
  flows: ReadonlyMap<string, FlowView>,
): number {
  if (!slo) return 0;
  if (!slo.scope) return clamp01(endToEnd);
  let load = 0;
  let slow = 0;
  for (const n of nodes) {
    if (n.componentId !== slo.scope) continue;
    const flow = flows.get(n.id);
    if (!flow || !(flow.served > 0)) continue;
    load += flow.served;
    slow += flow.served * lookupShareOf(n) * probSojournExceeds(flow.st, slo.thresholdMs);
  }
  return load > 0 ? clamp01(slow / load) : clamp01(endToEnd);
}
