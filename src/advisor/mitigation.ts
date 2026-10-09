/**
 * Mitigations per fault (Spec 08, CHS-06): for a fault on a design, what
 * limits its damage, with the advisor's quick fixes (Spec 12) where one
 * applies to this design — a circuit breaker in front of a dependency,
 * retries on a lossy call, N+1 instances, a standby, a dead-letter queue, a
 * rate limiter, health-check hysteresis, longer DNS caching. Pure: the
 * same fault and graph give the same tips and fixes.
 */
import type { Edge, Node } from "@xyflow/react";
import { getParamSpec, instancesOf, numParam, PARAM } from "@/domain/components/registry";
import { isAsyncEdge } from "@/domain/graph/edgeRules";
import { requestsWithAsync } from "@/domain/graph/returns";
import type { FaultSpec } from "@/engine/faults/types";
import { isComponentNode } from "@/lib/nodeFactory";
import { INHERENTLY_REDUNDANT } from "@/scoring/paths";
import type { ComponentNodeData } from "@/store/canvasStore";
import {
  emptyDiff,
  insertBetween,
  newComponentNode,
  newEdge,
  uniqueId,
  withResponse,
} from "./graph";
import { hasRateLimit, rateLimitFix } from "./load";
import type { AdvisorContext, CanvasGraph, GraphDiff, QuickFix } from "./types";
import { viewOf } from "./view";

export interface Mitigation {
  /** Stable per fault type + tip. */
  id: string;
  text: string;
  fix?: QuickFix;
}

/** Retries a mitigation turns on: one first try plus two, with backoff. */
export const MITIGATION_RETRIES = 2;
/** Consecutive health-check failures before a target leaves rotation (hysteresis). */
export const STABLE_UNHEALTHY_THRESHOLD = 3;

type CompNode = Node<ComponentNodeData>;

const comps = (graph: CanvasGraph) => graph.nodes.filter(isComponentNode);
const nodeIn = (graph: CanvasGraph, id: string | undefined) =>
  comps(graph).find((n) => n.id === id);
const label = (graph: CanvasGraph, id: string) => nodeIn(graph, id)?.data.label ?? id;
const componentOf = (graph: CanvasGraph, id: string) => nodeIn(graph, id)?.data.componentId ?? "";
const supports = (n: CompNode, key: string) => getParamSpec(n.data.componentId, key) !== undefined;

const paramsFix = (label: string, patch: Record<string, Record<string, unknown>>): QuickFix => ({
  label,
  preview: (): GraphDiff => ({ ...emptyDiff(), nodeParams: patch as GraphDiff["nodeParams"] }),
});

/** Sync edges into `targetId`, busiest caller first. */
function callers(graph: CanvasGraph, targetId: string, ctx: AdvisorContext): Edge[] {
  return requestsWithAsync(graph.edges)
    .filter((e) => e.target === targetId && !isAsyncEdge(e) && nodeIn(graph, e.source))
    .sort((a, b) => (ctx.load?.[b.source] ?? 0) - (ctx.load?.[a.source] ?? 0));
}

/** N+1: one more instance (two for a single instance), so a survivor takes over. */
function redundancyFix(n: CompNode): QuickFix | undefined {
  if (INHERENTLY_REDUNDANT.has(n.data.componentId)) return undefined;
  const from = instancesOf(n.data);
  const to = from + 1;
  return paramsFix(
    from === 1
      ? `Run 2 instances of ${n.data.label} (a standby to take over)`
      : `Run ${to} instances of ${n.data.label} (N+1: survive losing one)`,
    { [n.id]: { [PARAM.instances]: to } },
  );
}

/**
 * A circuit breaker on `edge` (caller → dependency). The link to the
 * dependency keeps its id, so a fault on that link stays where it is.
 */
function breakerFix(graph: CanvasGraph, edge: Edge): QuickFix | undefined {
  if (componentOf(graph, edge.source) === "circuit-breaker") return undefined;
  const target = label(graph, edge.target);
  return {
    label: `Put a circuit breaker between ${label(graph, edge.source)} and ${target}`,
    preview: (g) => {
      const current = g.edges.find((e) => e.id === edge.id);
      if (!current) return emptyDiff();
      return insertBetween(g, current, "circuit-breaker", {
        idBase: `circuit-breaker-${edge.target}`,
        keepLinkOnOut: true,
      });
    },
  };
}

/** Retries (with backoff) on callers that support them and don't retry yet. */
function retriesFix(graph: CanvasGraph, callerIds: string[], why: string): QuickFix | undefined {
  const nodes = callerIds
    .map((id) => nodeIn(graph, id))
    .filter((n): n is CompNode => !!n && supports(n, PARAM.maxRetries))
    .filter((n) => numParam(n.data, PARAM.maxRetries, 0) === 0);
  if (nodes.length === 0) return undefined;
  return paramsFix(
    `Retry ${MITIGATION_RETRIES}× with backoff in ${nodes.map((n) => n.data.label).join(", ")} (${why})`,
    Object.fromEntries(nodes.map((n) => [n.id, { [PARAM.maxRetries]: MITIGATION_RETRIES }])),
  );
}

/** Fewer retries on callers that retry more than once (retry storm). */
function capRetriesFix(graph: CanvasGraph, callerIds: string[]): QuickFix | undefined {
  const nodes = callerIds
    .map((id) => nodeIn(graph, id))
    .filter((n): n is CompNode => !!n && numParam(n.data, PARAM.maxRetries, 0) > 1);
  if (nodes.length === 0) return undefined;
  return paramsFix(
    `Cap retries at 1 in ${nodes.map((n) => n.data.label).join(", ")}`,
    Object.fromEntries(nodes.map((n) => [n.id, { [PARAM.maxRetries]: 1 }])),
  );
}

/** A dead-letter queue off `queueId`, when it has none. */
function dlqFix(graph: CanvasGraph, queueId: string): QuickFix | undefined {
  const hasDlq = graph.edges.some(
    (e) => e.source === queueId && componentOf(graph, e.target) === "dlq",
  );
  if (hasDlq || componentOf(graph, queueId) === "dlq") return undefined;
  return {
    label: `Add a dead-letter queue to ${label(graph, queueId)}`,
    preview: (g) => {
      const queue = nodeIn(g, queueId);
      if (!queue) return emptyDiff();
      const position = { x: queue.position.x, y: queue.position.y + 140 };
      const dlq = newComponentNode("dlq", uniqueId(`dlq-${queueId}`, g), position);
      const nodes = [...g.nodes, dlq];
      const edge = newEdge(nodes, g.edges, uniqueId(`e-${queueId}-${dlq.id}`, g), queueId, dlq.id);
      return { ...emptyDiff(), addNodes: [dlq], addEdges: withResponse(edge, !isAsyncEdge(edge)) };
    },
  };
}

const tip = (type: string, key: string, text: string, fix?: QuickFix): Mitigation => ({
  id: `${type}:${key}`,
  text,
  ...(fix ? { fix } : {}),
});

/** What limits the damage of `fault` on this design, most effective first. */
export function mitigationsFor(
  fault: FaultSpec,
  graph: CanvasGraph,
  ctx: AdvisorContext,
): Mitigation[] {
  const t = fault.type;
  const target = fault.target.kind === "node" ? nodeIn(graph, fault.target.id) : undefined;
  const edge =
    fault.target.kind === "edge" ? graph.edges.find((e) => e.id === fault.target.id) : undefined;
  const busiestCaller = target ? callers(graph, target.id, ctx)[0] : undefined;
  const callerIds = target ? callers(graph, target.id, ctx).map((e) => e.source) : [];

  switch (t) {
    case "kill-instances":
    case "kill-node":
      return [
        tip(
          t,
          "redundancy",
          "Run N+1 instances behind a load balancer, so the survivors carry the load while the dead ones are replaced; keep each tier under ~70% so they can.",
          target && redundancyFix(target),
        ),
        tip(
          t,
          "breaker",
          "Callers that can live without it should fail fast and fall back (cached or default response) instead of waiting on timeouts: a circuit breaker does that.",
          busiestCaller && breakerFix(graph, busiestCaller),
        ),
        tip(
          t,
          "health-check",
          "Shorter health-check intervals take dead instances out of rotation sooner.",
        ),
      ];

    case "zone-failure": {
      const single = comps(graph).filter(
        (n) => !INHERENTLY_REDUNDANT.has(n.data.componentId) && instancesOf(n.data) === 1,
      );
      return [
        tip(
          t,
          "spread",
          "Run every tier in at least two zones with headroom for losing one (static stability): with three zones, each at ≤ 2/3 of its capacity.",
          single.length > 0
            ? paramsFix(
                `Run 2 instances of ${single.map((n) => n.data.label).join(", ")} (one per zone)`,
                Object.fromEntries(single.map((n) => [n.id, { [PARAM.instances]: 2 }])),
              )
            : undefined,
        ),
        tip(t, "managed", "Prefer managed multi-AZ services (databases with automatic failover)."),
      ];
    }

    case "memory-leak":
      return [
        tip(
          t,
          "restart",
          "Set memory limits with automatic restarts and alert on heap growth; stagger restarts so instances don't crash together.",
          target && redundancyFix(target),
        ),
        tip(t, "find", "Capture a heap dump before restarting to find the leak."),
      ];

    case "slow-node":
    case "thread-pool-exhausted":
      return [
        tip(
          t,
          "breaker",
          "Timeouts on every call to it, and a circuit breaker so callers stop waiting on a sick dependency and it gets room to recover.",
          busiestCaller && breakerFix(graph, busiestCaller),
        ),
        tip(
          t,
          "bulkhead",
          "Bulkheads: a separate thread pool or concurrency limit per dependency, so one slow dependency can't take every thread.",
        ),
      ];

    case "transient-errors":
      return [
        tip(
          t,
          "cap-retries",
          "Retry only idempotent calls, at one layer, with exponential backoff and jitter, within a retry budget — every extra retry multiplies the load on a struggling service.",
          capRetriesFix(graph, callerIds),
        ),
        tip(
          t,
          "breaker",
          "A circuit breaker stops the calls (and the retries) once failures are sustained.",
          busiestCaller && breakerFix(graph, busiestCaller),
        ),
      ];

    case "edge-latency":
    case "partition":
      return [
        tip(
          t,
          "breaker",
          "Timeouts from the latency budget and a circuit breaker on the link, so callers fail fast (or serve a fallback) instead of hanging.",
          edge && breakerFix(graph, edge),
        ),
        tip(
          t,
          "async",
          "Work the user doesn't wait for belongs behind a queue: it survives the link being slow or cut and catches up afterwards.",
        ),
      ];

    case "packet-loss":
      return [
        tip(
          t,
          "retries",
          "Retries with backoff recover lost calls — make the operations idempotent (idempotency keys for writes) and cap them with a budget.",
          edge && retriesFix(graph, [edge.source], "lost calls are sent again"),
        ),
      ];

    case "cache-flush":
      return [
        tip(
          t,
          "coalesce",
          "Request coalescing (one request refills each hot key while the others wait), staggered TTLs and warming the cache before it takes traffic stop the stampede.",
        ),
        tip(
          t,
          "headroom",
          "Keep headroom (or a rate limit) in front of the database for the misses while the cache warms up.",
        ),
      ];

    case "db-primary-failure":
      return [
        tip(
          t,
          "standby",
          "A synchronous standby in another zone, promoted automatically (Multi-AZ); clients retry writes idempotently while it fails over.",
          target && instancesOf(target.data) === 1 ? redundancyFix(target) : undefined,
        ),
        tip(
          t,
          "retries",
          "Writers retry with backoff, so the writes made during the failover go through once the standby is promoted.",
          retriesFix(graph, callerIds, "writes go through after the failover"),
        ),
        tip(t, "queue", "Buffer writes that can wait in a queue."),
      ];

    case "consumer-stopped": {
      const queues = target
        ? graph.edges
            .filter((e) => e.target === target.id)
            .map((e) => e.source)
            .filter((id) => {
              const c = componentOf(graph, id);
              return c === "message-queue" || c === "pub-sub";
            })
        : [];
      return [
        tip(
          t,
          "dlq",
          "Move messages that keep failing (poison messages) to a dead-letter queue after N attempts, so one bad message can't stall the consumers.",
          queues[0] ? dlqFix(graph, queues[0]) : undefined,
        ),
        tip(
          t,
          "lag",
          "Alert on consumer lag and scale consumers out to drain the backlog after recovery.",
        ),
      ];
    }

    case "traffic-spike": {
      const view = viewOf(graph);
      // The run's load includes the spike: the limit is set from the normal load.
      const factor = fault.intensity && fault.intensity > 0 ? fault.intensity : 1;
      const load = Object.fromEntries(
        Object.entries(ctx.load ?? {}).map(([id, v]) => [id, v / factor]),
      );
      return [
        tip(
          t,
          "rate-limit",
          "Shed the excess at the edge (a rate limiter or the API gateway answering 429), so the rest is served fast.",
          hasRateLimit(view) ? undefined : rateLimitFix(view, load).fix,
        ),
        tip(
          t,
          "autoscale",
          "Keep headroom and autoscaling on the stateless tiers, serve hot reads from caches and the CDN, and move non-critical work to a queue.",
        ),
      ];
    }

    case "disk-full":
      return [
        tip(
          t,
          "alerts",
          "Alert well before the disk is full (e.g. at 80%), rotate logs, set retention on data, and use storage that grows automatically.",
        ),
      ];

    case "iops-throttle":
      return [
        tip(
          t,
          "iops",
          "Provision IOPS for the peak (and watch the burst balance), cache hot reads and batch writes so the volume needs fewer operations.",
        ),
      ];

    case "deadlock":
      return [
        tip(
          t,
          "retries",
          "Retry the aborted transactions with backoff — the database rolled them back, so they're safe to retry.",
          retriesFix(graph, callerIds, "deadlock victims are retried"),
        ),
        tip(
          t,
          "ordering",
          "Take locks in a consistent order, keep transactions short and index the rows you update.",
        ),
      ];

    case "tls-expired":
      return [
        tip(
          t,
          "renew",
          "Automate renewal (ACME), alert on expiry dates weeks ahead, and make health checks go through TLS so an expired certificate takes the target out of rotation.",
        ),
      ];

    case "dns-outage": {
      const share = target ? numParam(target.data, PARAM.lookupShare, 1) : 1;
      const next = Math.round(share * 50) / 100;
      return [
        tip(
          t,
          "ttl",
          "Longer TTLs keep more answers cached through an outage (at the cost of slower changes); resolvers that serve stale answers (RFC 8767) help too.",
          target && next > 0 && next < share
            ? paramsFix(
                `Raise ${target.data.label}'s TTLs (fresh lookups ${Math.round(share * 100)}% → ${Math.round(next * 100)}%)`,
                { [target.id]: { [PARAM.lookupShare]: next } },
              )
            : undefined,
        ),
        tip(t, "providers", "Use a second DNS provider so one provider's outage isn't yours."),
      ];
    }

    case "health-check-flapping": {
      const lb = edge ? nodeIn(graph, edge.source) : undefined;
      const current = lb ? numParam(lb.data, PARAM.unhealthyThreshold, 2) : 0;
      return [
        tip(
          t,
          "hysteresis",
          "Hysteresis: several consecutive failures to take a target out and several successes to bring it back; keep health endpoints shallow and fast, and slow-start rejoining targets.",
          lb && current < STABLE_UNHEALTHY_THRESHOLD
            ? paramsFix(
                `Require ${STABLE_UNHEALTHY_THRESHOLD} failed checks at ${lb.data.label} before taking a target out`,
                { [lb.id]: { [PARAM.unhealthyThreshold]: STABLE_UNHEALTHY_THRESHOLD } },
              )
            : undefined,
        ),
      ];
    }

    default: {
      const unhandled: never = t;
      void unhandled;
      return [];
    }
  }
}
