/**
 * Findings from the last run's load (Spec 12, ADV-01): tiers running hot or
 * saturated, tiers over-provisioned, and no rate limiter in front of the
 * traffic. Utilization is the run's load over the CURRENT capacity
 * (instances × capacity per instance), so a fix that adds instances clears
 * its finding at once instead of waiting for the next run. Thresholds are the
 * scorer's (`scoring/budget.ts`) and the sizing is right-size's
 * (`cost/rightSize.ts`), so the Advisor, Score and Cost tabs agree.
 */
import type { Edge, Node } from "@xyflow/react";
import { suggestedInstances, TARGET_UTILIZATION } from "@/cost/rightSize";
import { getComponentById } from "@/data/components";
import { capacityPerInstanceOf, instancesOf, numParam, PARAM } from "@/domain/components/registry";
import { OVERPROVISIONED_UTILIZATION, PEAK_UTILIZATION, SURGE_FACTOR } from "@/scoring/budget";
import { pct, rps } from "@/scoring/steady";
import type { ComponentNodeData } from "@/store/canvasStore";
import { emptyDiff, insertBetween } from "./graph";
import type { AdvisorContext, Finding, QuickFix } from "./types";
import { isAsyncEdge } from "@/domain/graph/edgeRules";
import type { DesignView } from "./view";

/**
 * Tiers in front of the application that a rate limiter goes behind: the
 * traffic source, name resolution, edge caches and proxies.
 */
const EDGE_TIER = new Set([
  "client",
  "dns",
  "cdn",
  "origin-shield",
  "load-balancer",
  "waf",
  "reverse-proxy",
]);

/** Requests per second that load the node's own station (DNS: only the uncached lookups). */
function stationRps(node: Node<ComponentNodeData>, load: number): number {
  return load * Math.min(1, Math.max(0, numParam(node.data, PARAM.lookupShare, 1)));
}

function utilizationOf(node: Node<ComponentNodeData>, load: number): number {
  const capacity = instancesOf(node.data) * capacityPerInstanceOf(node.data);
  return capacity > 0 ? stationRps(node, load) / capacity : 0;
}

const isStateless = (n: Node<ComponentNodeData>) =>
  getComponentById(n.data.componentId)?.stateful === false;

function instancesFix(node: Node<ComponentNodeData>, to: number, why: string): Finding["fix"] {
  return {
    label: `${to > instancesOf(node.data) ? "Scale out" : "Scale in"} ${node.data.label} to ${to} instances (${why})`,
    preview: () => ({ ...emptyDiff(), nodeParams: { [node.id]: { [PARAM.instances]: to } } }),
  };
}

export function loadFindings(view: DesignView, ctx: AdvisorContext): Finding[] {
  const load = ctx.load;
  if (!load) return [];
  const findings: Finding[] = [];

  for (const node of view.comps) {
    const rpsIn = load[node.id] ?? 0;
    if (!(rpsIn > 0) || node.data.componentId === "client") continue;
    if (!view.scoring.reachable.has(node.id)) continue;
    const n = instancesOf(node.data);
    const capacity = capacityPerInstanceOf(node.data);
    const util = utilizationOf(node, rpsIn);
    const target = suggestedInstances(stationRps(node, rpsIn), capacity);
    const serving = `${rps(rpsIn)} rps on ${n} × ${rps(capacity)} rps`;

    if (util >= PEAK_UTILIZATION) {
      const saturated = util >= 1;
      const stateless = isStateless(node);
      findings.push({
        id: `hot:${node.id}`,
        severity: saturated ? "critical" : "warning",
        title: saturated
          ? `${node.data.label} is saturated (${pct(util)})`
          : `${node.data.label} runs hot (${pct(util)})`,
        detail: `${serving}. ${
          saturated
            ? "Past full capacity requests queue without bound, time out and get dropped, and every caller's latency climbs with them."
            : `Above ${pct(PEAK_UTILIZATION)} queueing delay grows steeply, and a slow instance or a small burst tips it over.`
        } ${
          stateless
            ? `Run more instances: ~${pct(TARGET_UTILIZATION)} at this load leaves room for a ${SURGE_FACTOR}× surge.`
            : "It's stateful, so adding nodes moves data: shard it, cache its reads or add read replicas to take load off it."
        }`,
        targetIds: [node.id],
        source: "metrics",
        fix:
          stateless && target > n
            ? instancesFix(node, target, `~${pct(TARGET_UTILIZATION)} at this load`)
            : undefined,
      });
      continue;
    }

    // The scorer's over-provisioning check: idle even with one instance fewer.
    if (n >= 3 && (util * n) / (n - 1) < OVERPROVISIONED_UTILIZATION) {
      findings.push({
        id: `idle:${node.id}`,
        severity: "info",
        title: `${node.data.label} is over-provisioned (${n} instances at ${pct(util)})`,
        detail: `${serving}: even with one instance fewer it would idle under ${pct(OVERPROVISIONED_UTILIZATION)}, so you pay for machines that do nothing. Scale it in (or autoscale) and keep the headroom where the load is.`,
        targetIds: [node.id],
        source: "metrics",
        fix:
          isStateless(node) && target < n
            ? instancesFix(node, target, `still ~${pct(TARGET_UTILIZATION)} at this load`)
            : undefined,
      });
    }
  }

  const limiter = rateLimiterFinding(view, load);
  if (limiter) findings.push(limiter);
  return findings;
}

/** Steady limit for a new limiter: the scored surge passes, a flood beyond it doesn't. */
function limitFor(load: number): number {
  return Math.max(100, Math.ceil((SURGE_FACTOR * load) / 100) * 100);
}

/**
 * Edges where requests leave the edge tiers (Client, DNS, CDN, LB…) for the
 * application, walking sync edges from the entries.
 */
function frontierEdges(view: DesignView): Edge[] {
  const isEdgeTier = (id: string) => EDGE_TIER.has(view.byId.get(id)?.data.componentId ?? "");
  const seen = new Set(view.path.entries.filter(isEdgeTier));
  const queue = [...seen];
  const out: Edge[] = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const e of view.graph.edges) {
      if (e.source !== id || isAsyncEdge(e) || !view.byId.has(e.target)) continue;
      if (!isEdgeTier(e.target)) out.push(e);
      else if (!seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return out;
}

/** Something already caps incoming traffic: a rate limiter, or an API gateway with throttling on. */
export function hasRateLimit(view: DesignView): boolean {
  return view.comps.some(
    (n) =>
      view.scoring.reachable.has(n.id) &&
      (n.data.componentId === "rate-limiter" ||
        (n.data.componentId === "api-gateway" && n.data.params?.[PARAM.rateLimitEnabled] === true)),
  );
}

/**
 * The fix that caps incoming traffic at SURGE_FACTOR × `load`: turn on the
 * busiest API gateway's throttling, else insert a rate limiter where requests
 * leave the edge tiers (when that's one edge). `targetIds` = where it acts;
 * no fix when neither fits. Shared with the traffic-spike mitigation (CHS-06).
 */
export function rateLimitFix(
  view: DesignView,
  load: Readonly<Record<string, number>>,
): { fix?: QuickFix; targetIds: string[] } {
  const reachable = view.comps.filter((n) => view.scoring.reachable.has(n.id));
  const gateway = reachable
    .filter((n) => n.data.componentId === "api-gateway")
    .sort((a, b) => (load[b.id] ?? 0) - (load[a.id] ?? 0))[0];
  if (gateway) {
    const limit = limitFor(load[gateway.id] ?? 0);
    return {
      targetIds: [gateway.id],
      fix: {
        label: `Turn on throttling at ${gateway.data.label} (limit ${rps(limit)} rps, ${SURGE_FACTOR}× the current load)`,
        preview: () => ({
          ...emptyDiff(),
          nodeParams: {
            [gateway.id]: { [PARAM.rateLimitEnabled]: true, [PARAM.limitRps]: limit },
          },
        }),
      },
    };
  }

  const frontier = frontierEdges(view);
  if (frontier.length !== 1) return { targetIds: [...new Set(frontier.map((e) => e.target))] };
  const edge = frontier[0];
  const from = view.byId.get(edge.source)!;
  const to = view.byId.get(edge.target)!;
  const entering = load[to.id] ?? 0;
  const limit = limitFor(entering);
  const capacity = capacityPerInstanceOf({ params: {}, componentId: "rate-limiter" });
  return {
    targetIds: [from.id, to.id],
    fix: {
      label: `Add a rate limiter between ${from.data.label} and ${to.data.label} (limit ${rps(limit)} rps, ${SURGE_FACTOR}× the current load)`,
      preview: (graph) => {
        const current = graph.edges.find((e) => e.id === edge.id);
        if (!current) return emptyDiff();
        return insertBetween(graph, current, "rate-limiter", {
          idBase: `rate-limiter-${to.id}`,
          params: {
            [PARAM.limitRps]: limit,
            [PARAM.instances]: suggestedInstances(entering, capacity),
          },
        });
      },
    },
  };
}

/** Info: live traffic and nothing that caps it. */
function rateLimiterFinding(
  view: DesignView,
  load: Readonly<Record<string, number>>,
): Finding | null {
  const live = view.comps.some((n) => view.scoring.reachable.has(n.id) && (load[n.id] ?? 0) > 0);
  if (!live || hasRateLimit(view)) return null;
  return {
    id: "rate-limit",
    severity: "info",
    title: "Nothing limits incoming traffic",
    detail:
      "A burst, a retry storm or a scraper beyond what the tiers can serve overloads all of them at once. A rate limiter at the edge rejects the excess early (HTTP 429) and keeps everyone else fast.",
    source: "metrics",
    ...rateLimitFix(view, load),
  };
}
