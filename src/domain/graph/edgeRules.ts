import { routingFor } from "@/domain/components/registry";
import type { EdgeRule, EdgeRuleKind, ParamSpec, Params } from "@/domain/components/types";

/** Default one-way network latency per protocol, in ms. */
export const PROTOCOL_LATENCY_MS: Record<string, number> = {
  http: 1,
  grpc: 0.5,
  websocket: 0.5,
  pubsub: 2,
  tcp: 0.5,
  custom: 1,
};

const RULE_KINDS: readonly EdgeRuleKind[] = ["always", "on_miss", "reads", "writes", "fraction"];

function networkLatencyFor(protocol: unknown): number {
  return (
    (typeof protocol === "string" && PROTOCOL_LATENCY_MS[protocol]) || PROTOCOL_LATENCY_MS.http
  );
}

/** Ids with special connect defaults (Spec 03, CMP-02). */
const SQL_DB = "sql-db";
const READ_REPLICA = "read-replica";
const DLQ = "dlq";
const AUTOSCALER = "autoscaler";

/** Share of messages a queue dead-letters by default (poison messages are rare). */
export const DEFAULT_DLQ_FRACTION = 0.01;

/** Graph facts `defaultEdgeRule` can't see from the two component ids alone. */
export interface EdgeRuleContext {
  /** The target SQL DB has a read replica (wired to it, or already called by the source). */
  targetHasReadReplica?: boolean;
}

/** Nodes that call a database with their own request flow (not LBs, caches, queues, …). */
function isCaller(componentId: string): boolean {
  if (componentId === SQL_DB || componentId === READ_REPLICA || componentId === AUTOSCALER) {
    return false;
  }
  const routing = routingFor(componentId);
  return routing === "service" || routing === "fixed";
}

/**
 * Rule a new edge gets when the user connects `source` → `target`
 * (both component ids). Spec 03, "Defaults ao conectar":
 * - out of a Cache/CDN → `on_miss`
 * - out of an LB → `always` (the LB splits by algorithm)
 * - Service → SQL DB with a read replica → `writes`; Service → Read Replica → `reads`
 * - anything else → `always`
 * Plus the CMP-02 components: SQL DB → Read Replica carries the `writes`
 * (replication stream), Queue → DLQ gets a small `fraction`, and an
 * Autoscaler's edges are control links (`callsPerRequest: 0`).
 */
export function defaultEdgeRule(
  sourceComponentId: string | undefined,
  targetComponentId?: string,
  protocol?: unknown,
  context: EdgeRuleContext = {},
): EdgeRule {
  const rule: EdgeRule = {
    kind: "always",
    callsPerRequest: 1,
    networkLatencyMs: networkLatencyFor(protocol),
    packetLoss: 0,
  };
  if (!sourceComponentId) return rule;
  const routing = routingFor(sourceComponentId);

  if (routing === "cache") {
    rule.kind = "on_miss";
  } else if (sourceComponentId === AUTOSCALER) {
    rule.callsPerRequest = 0;
  } else if (routing === "queue" && targetComponentId === DLQ) {
    rule.kind = "fraction";
    rule.fraction = DEFAULT_DLQ_FRACTION;
  } else if (sourceComponentId === SQL_DB && targetComponentId === READ_REPLICA) {
    rule.kind = "writes";
  } else if (isCaller(sourceComponentId)) {
    if (targetComponentId === READ_REPLICA) rule.kind = "reads";
    else if (targetComponentId === SQL_DB && context.targetHasReadReplica) rule.kind = "writes";
  }
  return rule;
}

/** Edges that don't carry user-facing latency by default (replication, dead-lettering, control). */
export function defaultEdgeAsync(
  sourceComponentId: string | undefined,
  targetComponentId: string | undefined,
): boolean {
  return (
    sourceComponentId === AUTOSCALER ||
    targetComponentId === DLQ ||
    (sourceComponentId === SQL_DB && targetComponentId === READ_REPLICA)
  );
}

/* ---------- graph-aware connect defaults ---------- */

interface GraphEdge {
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

/** Minimal view of the canvas the connect defaults need. */
export interface RuleGraph<E extends GraphEdge = GraphEdge> {
  componentIdOf: (nodeId: string) => string | undefined;
  edges: readonly E[];
}

function hasReadReplica(dbNodeId: string, callerNodeId: string, graph: RuleGraph): boolean {
  const isReplica = (id: string) => graph.componentIdOf(id) === READ_REPLICA;
  return graph.edges.some(
    (e) =>
      (e.source === dbNodeId && isReplica(e.target)) ||
      (e.target === dbNodeId && isReplica(e.source)) ||
      (e.source === callerNodeId && isReplica(e.target)),
  );
}

/** `defaultEdgeRule` for a new edge between two canvas nodes, reading the graph for context. */
export function connectEdgeRule(
  sourceNodeId: string,
  targetNodeId: string,
  graph: RuleGraph,
  protocol?: unknown,
): EdgeRule {
  const source = graph.componentIdOf(sourceNodeId);
  const target = graph.componentIdOf(targetNodeId);
  const targetHasReadReplica =
    target === SQL_DB && hasReadReplica(targetNodeId, sourceNodeId, graph);
  return defaultEdgeRule(source, target, protocol, { targetHasReadReplica });
}

/**
 * When a caller gets its first edge to a Read Replica, its existing
 * `always` edges to SQL DBs become `writes` (reads now go to the replica).
 * Returns the same array when nothing changes.
 */
export function splitReadsOnReplicaConnect<E extends GraphEdge>(
  sourceNodeId: string,
  targetNodeId: string,
  graph: RuleGraph<E>,
): readonly E[] {
  const source = graph.componentIdOf(sourceNodeId);
  if (!source || !isCaller(source) || graph.componentIdOf(targetNodeId) !== READ_REPLICA) {
    return graph.edges;
  }
  let changed = false;
  const edges = graph.edges.map((e) => {
    if (e.source !== sourceNodeId || graph.componentIdOf(e.target) !== SQL_DB) return e;
    // Edges saved before v2 may lack a rule: their default is `always`
    const rule = sanitizeEdgeRule(e.data?.rule, defaultEdgeRule(source, SQL_DB, e.data?.protocol));
    if (rule.kind !== "always") return e;
    changed = true;
    return { ...e, data: { ...e.data, rule: { ...rule, kind: "writes" as const } } };
  });
  return changed ? edges : graph.edges;
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * Normalize a raw rule (from storage, import or UI). Missing/invalid fields
 * take the default for this edge. Never throws.
 */
export function sanitizeEdgeRule(raw: unknown, fallback: EdgeRule): EdgeRule {
  if (typeof raw !== "object" || raw === null) return { ...fallback };
  const r = raw as Record<string, unknown>;
  const kind = RULE_KINDS.includes(r.kind as EdgeRuleKind)
    ? (r.kind as EdgeRuleKind)
    : fallback.kind;
  const rule: EdgeRule = {
    kind,
    callsPerRequest: clamp(r.callsPerRequest, 0, 100, fallback.callsPerRequest),
    networkLatencyMs: clamp(r.networkLatencyMs, 0, 10_000, fallback.networkLatencyMs),
    packetLoss: clamp(r.packetLoss, 0, 1, fallback.packetLoss),
  };
  if (kind === "fraction") rule.fraction = clamp(r.fraction, 0, 1, fallback.fraction ?? 1);
  return rule;
}

/* ---------- form spec (Props panel + context menu) ---------- */

/** Fraction a rule gets when switched to `fraction` without one. */
export const DEFAULT_RULE_FRACTION = 0.5;

const RULE_KIND_LABEL: Record<EdgeRuleKind, string> = {
  always: "Always",
  on_miss: "On cache miss",
  reads: "Reads only",
  writes: "Writes only",
  fraction: "Fraction",
};

export const EDGE_RULE_KIND_OPTIONS = RULE_KINDS.map((value) => ({
  value,
  label: RULE_KIND_LABEL[value],
}));

/**
 * The editable fields of an `EdgeRule` as `ParamSpec`s, so the generic
 * params form renders them. Bounds match `sanitizeEdgeRule`.
 */
export const EDGE_RULE_SPECS: readonly ParamSpec[] = [
  {
    key: "kind",
    label: "Call rule",
    kind: "enum",
    default: "always",
    options: EDGE_RULE_KIND_OPTIONS,
    help: "Which requests take this edge: all, only cache misses, only reads, only writes, or a fixed share.",
  },
  {
    key: "fraction",
    label: "Fraction",
    kind: "percent",
    default: DEFAULT_RULE_FRACTION,
    min: 0,
    max: 1,
    step: 0.01,
    help: "Share of the source's requests that take this edge.",
    visibleIf: (p) => p.kind === "fraction",
  },
  {
    key: "callsPerRequest",
    label: "Calls per request",
    kind: "number",
    default: 1,
    min: 0,
    max: 100,
    step: 0.5,
    help: "Downstream calls per incoming request (e.g. 3 for an N+1 lookup); 0 for a control link.",
  },
  {
    key: "networkLatencyMs",
    label: "Network latency",
    kind: "duration",
    default: PROTOCOL_LATENCY_MS.http,
    min: 0,
    max: 10_000,
    step: 0.5,
    unit: "ms",
    help: "One-way network time added per call (same zone ≈ 0.5–1 ms; cross-region tens of ms).",
  },
  {
    key: "packetLoss",
    label: "Packet loss",
    kind: "percent",
    default: 0,
    min: 0,
    max: 1,
    step: 0.001,
    help: "Share of calls lost in transit; they fail or wait for a retransmission.",
  },
];

/** A rule as flat form values (fraction shown even while hidden). */
export function edgeRuleValues(rule: EdgeRule): Params {
  return {
    kind: rule.kind,
    fraction: rule.fraction ?? DEFAULT_RULE_FRACTION,
    callsPerRequest: rule.callsPerRequest,
    networkLatencyMs: rule.networkLatencyMs,
    packetLoss: rule.packetLoss,
  };
}

/** Apply a form edit to a rule, then normalize it. */
export function applyEdgeRulePatch(
  current: EdgeRule,
  patch: Partial<EdgeRule>,
  fallback: EdgeRule,
): EdgeRule {
  const merged: EdgeRule = { ...current, ...patch };
  if (merged.kind === "fraction" && merged.fraction === undefined) {
    merged.fraction = DEFAULT_RULE_FRACTION;
  }
  return sanitizeEdgeRule(merged, fallback);
}

/** Short label for the canvas edge badge; `null` for the plain `always` × 1 case. */
export function edgeRuleBadge(rule: EdgeRule | undefined): string | null {
  if (!rule) return null;
  const calls = rule.callsPerRequest === 1 ? "" : ` ×${rule.callsPerRequest}`;
  switch (rule.kind) {
    case "on_miss":
      return `miss${calls}`;
    case "reads":
      return `reads${calls}`;
    case "writes":
      return `writes${calls}`;
    case "fraction":
      return `${Math.round((rule.fraction ?? DEFAULT_RULE_FRACTION) * 1000) / 10}%${calls}`;
    default:
      return calls ? calls.trim() : null;
  }
}
