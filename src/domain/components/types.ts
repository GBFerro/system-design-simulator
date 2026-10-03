/**
 * Component parameter schemas (Spec 03, CMP-01).
 *
 * Every component type declares a `ComponentSchema`. The schema generates the
 * Props panel form, the default `params` of a new node, and the inputs the
 * engine (Spec 04) and cost model (Spec 10) read.
 */

export type ParamValue = number | string | boolean;

export type Params = Record<string, ParamValue>;

export type ParamKind = "number" | "percent" | "duration" | "enum" | "boolean";

/** Props form sections. Prices aren't params: they live in `PricingSpec` (`pricing.ts`). */
export type ParamGroup = "capacity" | "latency" | "resilience" | "advanced";

export interface ParamSpec {
  /** e.g. "instances", "hitRate", "ttlSec" */
  key: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  /** "ms", "rps", "s", "GB" */
  unit?: string;
  /** Only for kind = "enum". */
  options?: { value: string; label: string }[];
  group?: ParamGroup;
  /** One line, shown as a tooltip. */
  help?: string;
  visibleIf?: (p: Params) => boolean;
}

/**
 * How a node turns its incoming flow λ into outgoing flow (Spec 04, routing).
 * - lb: splits across targets by algorithm (edge rules don't apply)
 * - service: each edge by its rule (always / reads / writes / fraction)
 * - cache: `on_miss` edges receive λ × (1 − hitRate)
 * - queue: decouples; output = min(backlog, consumers × rate)
 * - rate-limiter: output = min(λ, limit)
 * - breaker: closed passes, open fails fast
 * - fixed: fixed-capacity service, edges by rule
 */
export type RoutingKind =
  | "lb"
  | "service"
  | "cache"
  | "queue"
  | "rate-limiter"
  | "breaker"
  | "fixed";

/**
 * Price of one component type (Spec 10, CST-01), in USD: approximate
 * on-demand list prices of a reference region, from the versioned table in
 * `pricing.ts`. Educational estimates, not a quote.
 */
export interface PricingSpec {
  /** Per instance (the `instances` param) per hour. */
  perInstanceHour: number;
  /** Fixed per node per month (e.g. a hosted zone, a web ACL). */
  baseMonthly: number;
  /** Per million requests the node handles. */
  perMillionRequests: number;
  /** Storage per GB-month, when the type has a size param (none yet). */
  perGbMonth?: number;
  /** Short text shown in the breakdown: what the prices are and what's left out. */
  assumptions: string;
}

export interface ComponentSchema {
  /** Same id as `components.ts`. */
  id: string;
  params: ParamSpec[];
  pricing: PricingSpec;
  routing: RoutingKind;
}

/**
 * Canonical param keys shared by every schema. They replace the v1
 * `maxQPS` / `latencyMs` / `replicas` fields of `ComponentNodeData`.
 */
export const CORE_PARAM = {
  capacityPerInstance: "capacityPerInstance",
  serviceTimeMs: "serviceTimeMs",
  instances: "instances",
} as const;

/* ---------- edge rules ---------- */

export type EdgeRuleKind = "always" | "on_miss" | "reads" | "writes" | "fraction";

/** Call rule carried by every edge (in `edge.data.rule`). Replaces the v1 "fan-out 100%". */
export interface EdgeRule {
  kind: EdgeRuleKind;
  /** 0–1, only for kind = "fraction". */
  fraction?: number;
  /** Default 1. */
  callsPerRequest: number;
  /** Default depends on the protocol. */
  networkLatencyMs: number;
  /** 0–1, default 0. */
  packetLoss: number;
}

/* ---------- edge calls (request-flow, schema v3) ---------- */

/**
 * Condition of one call: `on_miss` = read-through (a miss of the calling
 * cache itself); `after_miss` = reads that missed the source's call to the
 * cache `missOf` (look-aside).
 */
export type EdgeCallKind = "always" | "reads" | "writes" | "fraction" | "on_miss" | "after_miss";

/** One call the edge's source makes to its target. */
export interface EdgeCall {
  kind: EdgeCallKind;
  /** 0–1, only for kind = "fraction". */
  fraction?: number;
  /** kind = "after_miss": the cache node (a target of another sync call of the same source). */
  missOf?: string;
  /** 1..MAX_CALL_STEP; undefined = implicit (callPlan). */
  step?: number;
  /** Default 1. 0 = control link. */
  callsPerRequest: number;
}

/** The link (network) plus the calls made over it, as stored in `edge.data.rule` from schema v3. */
export interface EdgeRuleV3 {
  /** 1..MAX_EDGE_CALLS. */
  calls: EdgeCall[];
  networkLatencyMs: number;
  packetLoss: number;
}
