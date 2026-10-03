import { getParamSpec, PARAM, routingFor } from "@/domain/components/registry";
import { DATABASES } from "@/domain/components/traits";
import type {
  EdgeCall,
  EdgeCallKind,
  EdgeRule,
  EdgeRuleKind,
  EdgeRuleV2,
  ParamSpec,
  Params,
} from "@/domain/components/types";

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
  const call: EdgeCall = { kind: "always", callsPerRequest: 1 };
  const rule: EdgeRule = {
    calls: [call],
    networkLatencyMs: networkLatencyFor(protocol),
    packetLoss: 0,
  };
  if (!sourceComponentId) return rule;
  const routing = routingFor(sourceComponentId);

  if (routing === "cache") {
    call.kind = "on_miss";
  } else if (sourceComponentId === AUTOSCALER) {
    call.callsPerRequest = 0;
  } else if (routing === "queue" && targetComponentId === DLQ) {
    call.kind = "fraction";
    call.fraction = DEFAULT_DLQ_FRACTION;
  } else if (sourceComponentId === SQL_DB && targetComponentId === READ_REPLICA) {
    call.kind = "writes";
  } else if (isCaller(sourceComponentId)) {
    if (targetComponentId === READ_REPLICA) call.kind = "reads";
    else if (targetComponentId === SQL_DB && context.targetHasReadReplica) call.kind = "writes";
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

/** The first cache (a node with a hit rate) `sourceNodeId` calls synchronously, if any. */
function cacheCalledBy(sourceNodeId: string, targetNodeId: string, graph: RuleGraph) {
  return graph.edges.find((e) => {
    if (e.source !== sourceNodeId || e.target === targetNodeId || isAsyncEdge(e)) return false;
    const componentId = graph.componentIdOf(e.target);
    return componentId !== undefined && getParamSpec(componentId, PARAM.hitRate) !== undefined;
  })?.target;
}

/**
 * `defaultEdgeRule` for a new edge between two canvas nodes, reading the graph
 * for context. Look-aside (FLW-24): a service connected to a database while
 * it already calls a cache writes to the database and reads it only after a
 * miss in that cache. With a read replica the replica takes the reads, so the
 * database keeps only the writes.
 */
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
  const rule = defaultEdgeRule(source, target, protocol, { targetHasReadReplica });
  if (!source || !isCaller(source) || !target || !DATABASES.has(target) || targetHasReadReplica) {
    return rule;
  }
  const cache = cacheCalledBy(sourceNodeId, targetNodeId, graph);
  if (!cache) return rule;
  return {
    ...rule,
    calls: [
      { kind: "writes", callsPerRequest: 1 },
      { kind: "after_miss", missOf: cache, callsPerRequest: 1 },
    ],
  };
}

/** A canvas (nodes carrying `data.componentId`) as the connect defaults read it. */
export function canvasRuleGraph<E extends GraphEdge>(
  nodes: readonly { id: string; data?: unknown }[],
  edges: readonly E[],
): RuleGraph<E> {
  const ids = new Map<string, string>();
  for (const n of nodes) {
    const id = (n.data as { componentId?: unknown } | undefined)?.componentId;
    if (typeof id === "string") ids.set(n.id, id);
  }
  return { componentIdOf: (nodeId) => ids.get(nodeId), edges };
}

/** An edge's current rule, normalized (edges saved before v2 get their connect default). */
export function edgeRuleOf<E extends GraphEdge>(
  graph: { nodes: readonly { id: string; data?: unknown }[]; edges: readonly E[] },
  edge: GraphEdge,
): EdgeRule {
  const data = edge.data ?? {};
  return sanitizeEdgeRule(
    data.rule,
    connectEdgeRule(
      edge.source,
      edge.target,
      canvasRuleGraph(graph.nodes, graph.edges),
      data.protocol,
    ),
  );
}

/** True for an edge marked async (replication, fire-and-forget): off the user's request path. */
export function isAsyncEdge(edge: { data?: unknown }): boolean {
  return (edge.data as { async?: unknown } | undefined)?.async === true;
}

export type EdgeProtocol = "http" | "grpc" | "websocket" | "pubsub" | "tcp" | "custom";

/** The `data` every new canvas edge starts with. */
export interface NewEdgeData {
  label: string;
  protocol: EdgeProtocol;
  async: boolean;
  rule: EdgeRule;
  [key: string]: unknown;
}

/**
 * `data` of a new edge, the one shape the editor (connect), the advisor's
 * quick fixes and the reference loader create: no label, HTTP, the default
 * async flag and the connect rule for `source` → `target` in `graph`.
 * `overrides` win (a reference's own async flag and rule).
 */
export function newEdgeData(
  source: string,
  target: string,
  graph: RuleGraph,
  overrides: Partial<Pick<NewEdgeData, "protocol" | "async" | "rule">> = {},
): NewEdgeData {
  const protocol = overrides.protocol ?? "http";
  return {
    label: "",
    protocol,
    async:
      overrides.async ?? defaultEdgeAsync(graph.componentIdOf(source), graph.componentIdOf(target)),
    rule: overrides.rule ?? connectEdgeRule(source, target, graph, protocol),
  };
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
    if (!rule.calls.some((c) => c.kind === "always")) return e;
    changed = true;
    const calls = rule.calls.map((c) =>
      c.kind === "always" ? { ...c, kind: "writes" as const } : c,
    );
    return { ...e, data: { ...e.data, rule: { ...rule, calls } } };
  });
  return changed ? edges : graph.edges;
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * Normalize a raw rule (from storage, import or UI). Missing/invalid fields
 * take the default for this edge. Accepts the v3 shape (`calls`) and, as a
 * defense beyond the persistence migration, the v2 flat one (`kind` on top),
 * normalized exactly as schema v2 did and turned into one call. Problems in
 * the call list go to `onWarning` (`sanitizeEdgeCalls`). Never throws.
 */
export function sanitizeEdgeRule(
  raw: unknown,
  fallback: EdgeRule,
  onWarning?: (message: string) => void,
): EdgeRule {
  const r = asObject(raw);
  if (!r) return cloneEdgeRule(fallback);
  const link = {
    networkLatencyMs: clamp(r.networkLatencyMs, 0, 10_000, fallback.networkLatencyMs),
    packetLoss: clamp(r.packetLoss, 0, 1, fallback.packetLoss),
  };
  if ("calls" in r) {
    return { calls: sanitizeEdgeCalls(r.calls, fallback.calls, onWarning), ...link };
  }
  // v2 flat rule: invalid/missing fields take the fallback's (first) call.
  const base = fallback.calls[0] ?? { kind: "always", callsPerRequest: 1 };
  const kind = RULE_KINDS.includes(r.kind as EdgeRuleKind) ? (r.kind as EdgeRuleKind) : base.kind;
  const call: EdgeCall = {
    kind,
    callsPerRequest: clamp(r.callsPerRequest, 0, 100, base.callsPerRequest),
  };
  if (kind === "fraction") call.fraction = clamp(r.fraction, 0, 1, base.fraction ?? 1);
  return { calls: [call], ...link };
}

function cloneEdgeRule(rule: EdgeRule): EdgeRule {
  return { ...rule, calls: rule.calls.map((c) => ({ ...c })) };
}

/**
 * A rule in the v2 flat shape: its first call plus the link. Only for the
 * v1 → v2 migration, which still produces schema v2 data.
 */
export function edgeRuleV2Of(rule: EdgeRule): EdgeRuleV2 {
  const call = rule.calls[0] ?? { kind: "always", callsPerRequest: 1 };
  // (`after_miss` has no v2 form: without its cache it is every read)
  const kind = RULE_KINDS.includes(call.kind as EdgeRuleKind)
    ? (call.kind as EdgeRuleKind)
    : "reads";
  const v2: EdgeRuleV2 = {
    kind,
    callsPerRequest: call.callsPerRequest,
    networkLatencyMs: rule.networkLatencyMs,
    packetLoss: rule.packetLoss,
  };
  if (kind === "fraction") v2.fraction = call.fraction;
  return v2;
}

/* ---------- calls (request-flow, schema v3) ---------- */

/** Most calls one edge carries (FLW-17, FLW-49: the only place this limit lives). */
export const MAX_EDGE_CALLS = 8;

/** Highest step a call can take (FLW-26, FLW-49: the only place this limit lives). */
export const MAX_CALL_STEP = 20;

const CALL_KINDS: readonly EdgeCallKind[] = [
  "always",
  "reads",
  "writes",
  "fraction",
  "on_miss",
  "after_miss",
];

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Normalize a raw call list (from storage, import or UI). Missing fields take
 * the matching fallback call's value; an empty or missing list is the
 * fallback. Never throws. Reports what it had to fix through `onWarning`
 * (FLW-45): more than `MAX_EDGE_CALLS` calls (keeps the first ones), a step
 * outside 1..`MAX_CALL_STEP` (brought into range), an unknown condition
 * (becomes `always`).
 */
export function sanitizeEdgeCalls(
  raw: unknown,
  fallback: readonly EdgeCall[],
  onWarning?: (message: string) => void,
): EdgeCall[] {
  const base = (i: number): EdgeCall =>
    fallback[Math.min(i, fallback.length - 1)] ?? { kind: "always", callsPerRequest: 1 };
  if (!Array.isArray(raw) || raw.length === 0) return fallback.map((c) => ({ ...c }));

  let list: unknown[] = raw;
  if (list.length > MAX_EDGE_CALLS) {
    onWarning?.(`An edge had ${list.length} calls; kept the first ${MAX_EDGE_CALLS}.`);
    list = list.slice(0, MAX_EDGE_CALLS);
  }

  const calls: EdgeCall[] = [];
  list.forEach((entry, i) => {
    const r = asObject(entry);
    const def = base(i);
    if (!r) {
      onWarning?.("Ignored an edge call that is not an object.");
      return;
    }
    let kind: EdgeCallKind = def.kind;
    if (r.kind !== undefined) {
      if (CALL_KINDS.includes(r.kind as EdgeCallKind)) kind = r.kind as EdgeCallKind;
      else {
        onWarning?.(`Unknown call condition "${String(r.kind)}" replaced by "always".`);
        kind = "always";
      }
    }
    const call: EdgeCall = {
      kind,
      callsPerRequest: clamp(r.callsPerRequest, 0, 100, def.callsPerRequest),
    };
    if (kind === "fraction") call.fraction = clamp(r.fraction, 0, 1, def.fraction ?? 1);
    if (kind === "after_miss" && typeof r.missOf === "string" && r.missOf !== "") {
      call.missOf = r.missOf;
    }
    if (r.step !== undefined) {
      if (typeof r.step === "number" && Number.isFinite(r.step)) {
        const step = Math.min(MAX_CALL_STEP, Math.max(1, Math.round(r.step)));
        if (step !== r.step) {
          onWarning?.(`Call step ${r.step} is outside 1–${MAX_CALL_STEP}; set to ${step}.`);
        }
        call.step = step;
      } else {
        onWarning?.("Ignored a call step that is not a number.");
      }
    }
    calls.push(call);
  });
  return calls.length > 0 ? calls : fallback.map((c) => ({ ...c }));
}

/**
 * Reshape a v2 edge rule (flat `kind`/`fraction`/`callsPerRequest`) into the
 * v3 link + one call. Values are carried as they are (sanitizing is
 * `sanitizeEdgeCalls`'s job) and `on_miss` keeps its stored value
 * (read-through). Pure and idempotent: a rule that already has `calls`, or
 * anything that isn't an object, comes back unchanged. Never throws.
 */
export function migrateEdgeRuleV2toV3(raw: unknown): unknown {
  const r = asObject(raw);
  if (!r || "calls" in r) return raw;
  const call: Record<string, unknown> = {};
  if (r.kind !== undefined) call.kind = r.kind;
  if (r.fraction !== undefined) call.fraction = r.fraction;
  if (r.callsPerRequest !== undefined) call.callsPerRequest = r.callsPerRequest;
  const rule: Record<string, unknown> = { calls: [call] };
  if (r.networkLatencyMs !== undefined) rule.networkLatencyMs = r.networkLatencyMs;
  if (r.packetLoss !== undefined) rule.packetLoss = r.packetLoss;
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

/**
 * An edit to an edge's rule: link fields, a whole call list (`calls`), or
 * fields of the edge's first call (`kind`/`fraction`/`callsPerRequest`, what
 * the single-call form and the context menu edit).
 */
export type EdgeRulePatch = Partial<EdgeRule> &
  Partial<Pick<EdgeCall, "kind" | "fraction" | "callsPerRequest">>;

/** Apply a form edit to a rule, then normalize it. */
export function applyEdgeRulePatch(
  current: EdgeRule,
  patch: EdgeRulePatch,
  fallback: EdgeRule,
): EdgeRule {
  const { kind, fraction, callsPerRequest, calls, ...link } = patch;
  let nextCalls = calls ?? current.calls;
  if (kind !== undefined || fraction !== undefined || callsPerRequest !== undefined) {
    const first: EdgeCall = { ...nextCalls[0] };
    if (kind !== undefined) first.kind = kind;
    if (fraction !== undefined) first.fraction = fraction;
    if (callsPerRequest !== undefined) first.callsPerRequest = callsPerRequest;
    nextCalls = [first, ...nextCalls.slice(1)];
  }
  nextCalls = nextCalls.map((c) =>
    c.kind === "fraction" && c.fraction === undefined
      ? { ...c, fraction: DEFAULT_RULE_FRACTION }
      : c,
  );
  return sanitizeEdgeRule({ ...current, ...link, calls: nextCalls }, fallback);
}

/**
 * Short label for the canvas edge badge: each call's label, joined; `null`
 * for the plain `always` × 1 case.
 */
export function edgeRuleBadge(rule: EdgeRule | undefined): string | null {
  if (!rule) return null;
  const labels = rule.calls.map(edgeCallBadge).filter((l): l is string => l !== null);
  return labels.length > 0 ? labels.join(" · ") : null;
}

function edgeCallBadge(call: EdgeCall): string | null {
  const calls = call.callsPerRequest === 1 ? "" : ` ×${call.callsPerRequest}`;
  switch (call.kind) {
    case "on_miss":
      return `miss${calls}`;
    case "reads":
      return `reads${calls}`;
    case "writes":
      return `writes${calls}`;
    case "fraction":
      return `${Math.round((call.fraction ?? DEFAULT_RULE_FRACTION) * 1000) / 10}%${calls}`;
    default:
      return calls ? calls.trim() : null;
  }
}

/* ---------- call form (Props panel) and badge, request-flow ---------- */

// SPEC_DEVIATION: the spec quotes these labels in Portuguese ("Read-through
// (miss do próprio cache)", "Leituras após miss em…").
// Reason: the whole app UI is in English; the labels keep the spec's meaning.
const CALL_KIND_LABEL: Record<EdgeCallKind, string> = {
  always: "Always",
  reads: "Reads only",
  writes: "Writes only",
  fraction: "Fraction",
  on_miss: "Read-through (cache's own miss)",
  after_miss: "Reads after a miss in…",
};

/** Condition options of one call; `on_miss` keeps its stored value (read-through). */
export const EDGE_CALL_KIND_OPTIONS: readonly { value: EdgeCallKind; label: string }[] =
  CALL_KINDS.map((value) => ({ value, label: CALL_KIND_LABEL[value] }));

/**
 * The editable fields of one `EdgeCall` as `ParamSpec`s (bounds match
 * `sanitizeEdgeCalls`). `missOf` has no options here: `edgeCallSpecsFor`
 * fills them with the caches the edge's source calls.
 */
export const EDGE_CALL_SPECS: readonly ParamSpec[] = [
  {
    key: "kind",
    label: "Call rule",
    kind: "enum",
    default: "always",
    options: [...EDGE_CALL_KIND_OPTIONS],
    help: "Which requests make this call: all, reads, writes, a fixed share, a miss of this cache (read-through) or reads that missed another call to a cache (look-aside).",
  },
  {
    key: "missOf",
    label: "Cache",
    kind: "enum",
    default: "",
    options: [],
    help: "The cache call this one follows: it runs only when that call misses or fails.",
    visibleIf: (p) => p.kind === "after_miss",
  },
  {
    key: "fraction",
    label: "Fraction",
    kind: "percent",
    default: DEFAULT_RULE_FRACTION,
    min: 0,
    max: 1,
    step: 0.01,
    help: "Share of the source's requests that make this call.",
    visibleIf: (p) => p.kind === "fraction",
  },
  {
    key: "step",
    label: "Step",
    kind: "number",
    default: 1,
    min: 1,
    max: MAX_CALL_STEP,
    step: 1,
    help: "Order of the call among the source's calls: steps run one after another, calls in the same step run in parallel.",
  },
  {
    key: "callsPerRequest",
    label: "Calls per request",
    kind: "number",
    default: 1,
    min: 0,
    max: 100,
    step: 0.5,
    help: "Calls per incoming request (e.g. 3 for an N+1 lookup); 0 for a control link.",
  },
];

/** The link fields of an edge (network), shared by every call over it. */
export const EDGE_LINK_SPECS: readonly ParamSpec[] = EDGE_RULE_SPECS.filter(
  (s) => s.key === "networkLatencyMs" || s.key === "packetLoss",
);

/** What the call form needs to know about the edge's source. */
export interface CallFormContext {
  /** Caches (nodes with a hit rate) the source calls synchronously over its other edges. */
  caches: readonly { id: string; label: string }[];
  /** The source itself has a hit rate (read-through makes sense out of it). */
  readThrough: boolean;
}

/**
 * `EDGE_CALL_SPECS` for one call of an edge: "reads after a miss" only when
 * the source calls a cache (FLW-08), listing those caches; read-through only
 * out of a node with a hit rate (FLW-14). A call already using a condition
 * keeps it among the options.
 */
export function edgeCallSpecsFor(ctx: CallFormContext, call: EdgeCall): ParamSpec[] {
  const offered = (kind: EdgeCallKind) =>
    kind === call.kind ||
    (kind === "after_miss" ? ctx.caches.length > 0 : kind === "on_miss" ? ctx.readThrough : true);
  return EDGE_CALL_SPECS.map((spec) => {
    if (spec.key === "kind") {
      return { ...spec, options: EDGE_CALL_KIND_OPTIONS.filter((o) => offered(o.value)) };
    }
    if (spec.key === "missOf") {
      return { ...spec, options: ctx.caches.map((c) => ({ value: c.id, label: c.label })) };
    }
    return spec;
  });
}

/** A call as form values: its fields (fraction shown even while hidden) and the step it runs at. */
export function edgeCallValues(call: EdgeCall, step: number): Params {
  return {
    kind: call.kind,
    missOf: call.missOf ?? "",
    fraction: call.fraction ?? DEFAULT_RULE_FRACTION,
    step,
    callsPerRequest: call.callsPerRequest,
  };
}

/**
 * Short label of an edge's calls for the canvas badge, e.g.
 * `"writes · miss: Redis"` (FLW-15); `null` for a plain `always` × 1.
 * `labelOf` names the cache a look-aside call depends on.
 */
export function edgeCallsBadge(
  rule: EdgeRule | undefined,
  labelOf: (nodeId: string) => string,
): string | null {
  if (!rule) return null;
  const labels = rule.calls
    .map((call) => {
      if (call.kind !== "after_miss") return edgeCallBadge(call);
      const times = call.callsPerRequest === 1 ? "" : ` ×${call.callsPerRequest}`;
      return `miss: ${call.missOf ? labelOf(call.missOf) : "?"}${times}`;
    })
    .filter((l): l is string => l !== null);
  return labels.length > 0 ? labels.join(" · ") : null;
}
