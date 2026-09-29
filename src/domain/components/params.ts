import type { SystemComponent } from "@/types/component";
import { CORE_PARAM, type ParamSpec, type Params, type RoutingKind } from "./types";

/**
 * Well-known param keys and the reusable `ParamSpec` builders shared by the
 * generic schema and the per-type schemas in `schemas/`. Kept apart from
 * `registry.ts` so schema modules can import it without an import cycle
 * (`registry.ts` imports every schema).
 */

/* ---------- well-known param keys read by the engine ---------- */

export const PARAM = {
  ...CORE_PARAM,
  /** Cache/CDN: fraction of requests served without calling `on_miss` edges. 0–1. */
  hitRate: "hitRate",
  /** Service: per-request timeout. */
  timeoutMs: "timeoutMs",
  /** Service: max client retries on failure/timeout. */
  maxRetries: "maxRetries",
  /** Anything with a queue in front: backlog above this is dropped. */
  maxQueue: "maxQueue",
  /** Queue/stream: parallel consumers draining the backlog. */
  consumers: "consumers",
  /** Rate limiter: requests per second allowed through. */
  limitRps: "limitRps",
  /** Rate limiter: what happens to the excess. */
  overLimitAction: "overLimitAction",
  /** Load balancer: split algorithm. */
  lbAlgorithm: "lbAlgorithm",
  /** Per-instance availability used for composed availability. 0–1. */
  availability: "availability",
  /** Traffic source: fraction of requests that are reads. 0–1. */
  readRatio: "readRatio",

  /* ----- added by Spec 03 (CMP-01) ----- */

  /** Traffic source: baseline arrivals per second. */
  baseRps: "baseRps",
  /** Traffic source: shape of the load over time (Spec 06). */
  loadPattern: "loadPattern",
  /** Tail (p99) service time of one instance, without queueing. */
  serviceTimeP99Ms: "serviceTimeP99Ms",
  /** Service: base delay before the first retry (exponential backoff). */
  retryBackoffMs: "retryBackoffMs",
  /** Service: randomize the backoff to avoid synchronized retry waves. */
  retryJitter: "retryJitter",
  /** Service: built-in autoscaling on/off. */
  autoscale: "autoscale",
  /** Autoscaling: lower bound for `instances`. */
  autoscaleMin: "autoscaleMin",
  /** Autoscaling: upper bound for `instances`. */
  autoscaleMax: "autoscaleMax",
  /** Autoscaling: utilization the policy tries to hold. 0–1. */
  targetUtilization: "targetUtilization",
  /** Autoscaling: wait after a scaling action before the next one. */
  scaleCooldownSec: "scaleCooldownSec",
  /** Autoscaler: boot + warm-up time before a new instance takes traffic. */
  provisioningDelaySec: "provisioningDelaySec",
  /** DNS/CDN/cache: time-to-live of a cached entry. */
  ttlSec: "ttlSec",
  /** Load balancer: seconds between health checks. */
  healthCheckIntervalSec: "healthCheckIntervalSec",
  /** Load balancer: consecutive failed checks before a target is marked down. */
  unhealthyThreshold: "unhealthyThreshold",
  /** Load balancer: consecutive passed checks before a target is back in rotation. */
  healthyThreshold: "healthyThreshold",
  /** API gateway: throttling on/off. */
  rateLimitEnabled: "rateLimitEnabled",
  /** Rate limiter: counting algorithm. */
  rateLimitAlgorithm: "rateLimitAlgorithm",
  /** Rate limiter (token bucket): requests allowed in a burst above the steady rate. */
  burst: "burst",
  /** Cache: RAM per node. */
  memoryGb: "memoryGb",
  /** Cache: eviction policy when memory is full. */
  evictionPolicy: "evictionPolicy",
  /** Cache: how writes reach the cache and the database. */
  writeStrategy: "writeStrategy",
  /** Cache: request coalescing / locking so one miss refills a hot key. */
  stampedeProtection: "stampedeProtection",
  /** SQL: writes per second the primary sustains. */
  writeCapacityRps: "writeCapacityRps",
  /** SQL: service time of a write on the primary. */
  writeServiceTimeMs: "writeServiceTimeMs",
  /** SQL: connection pool size; requests beyond it wait. */
  connectionPool: "connectionPool",
  /** SQL/search: horizontal partitions of the data set. */
  shards: "shards",
  /** Read replica: how far the replica trails the primary. */
  replicationLagMs: "replicationLagMs",
  /** NoSQL/queue: partitions (the unit of parallelism). */
  partitions: "partitions",
  /** NoSQL: copies of every item. */
  replicationFactor: "replicationFactor",
  /** NoSQL: replicas that must answer a read/write. */
  consistencyLevel: "consistencyLevel",
  /** NoSQL: share of traffic on the busiest partition. 0–1. */
  hotPartitionShare: "hotPartitionShare",
  /** Search: replica copies of each shard. */
  replicas: "replicas",
  /** Queue: how long messages are kept. */
  retentionHours: "retentionHours",
  /** Queue: delivery guarantee. */
  deliverySemantics: "deliverySemantics",
  /** Queue: deliveries before a message moves to the DLQ. */
  maxDeliveryAttempts: "maxDeliveryAttempts",
  /** Circuit breaker: failure rate that opens the circuit. 0–1. */
  errorThreshold: "errorThreshold",
  /** Circuit breaker: time spent open before probing. */
  openDurationSec: "openDurationSec",
  /** Circuit breaker: trial calls allowed while half-open. */
  halfOpenProbes: "halfOpenProbes",
  /** Circuit breaker: calls in the window before the failure rate is evaluated. */
  minimumCalls: "minimumCalls",
  /** WAF: fraction of requests blocked. 0–1. */
  blockRate: "blockRate",
} as const;

/** Upper bound of `instances` everywhere (form, toolbar, context menu). */
export const MAX_INSTANCES = 100;

export function finitePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/* ---------- core params ---------- */

/** Per-schema tweaks of the core params (label/help/group), never their defaults. */
export type CoreOverrides = Partial<
  Record<keyof typeof CORE_PARAM | "availability", Partial<Omit<ParamSpec, "key" | "kind">>>
>;

/**
 * Capacity/latency/instances (the three v1 numbers, now params) plus
 * per-instance availability. Defaults come from the catalog entry so the
 * palette, the legacy engine and the scoring keep seeing the same numbers.
 */
export function coreParams(
  component: Pick<SystemComponent, "maxQPS" | "latencyMs">,
  overrides: CoreOverrides = {},
): ParamSpec[] {
  const specs: ParamSpec[] = [
    {
      key: PARAM.instances,
      label: "Instances",
      kind: "number",
      default: 1,
      min: 1,
      max: MAX_INSTANCES,
      step: 1,
      group: "capacity",
      help: "Identical instances behind this node (replicas).",
      ...overrides.instances,
    },
    {
      key: PARAM.capacityPerInstance,
      label: "Capacity per instance",
      kind: "number",
      min: 1,
      step: 100,
      unit: "rps",
      group: "capacity",
      help: "Requests per second one instance sustains before queueing.",
      ...overrides.capacityPerInstance,
      default: finitePositive(component.maxQPS, 1000),
    },
    {
      key: PARAM.serviceTimeMs,
      label: "Service time",
      kind: "duration",
      min: 0.1,
      step: 1,
      unit: "ms",
      group: "latency",
      help: "Mean time one instance spends on a request (no queueing).",
      ...overrides.serviceTimeMs,
      default: finitePositive(component.latencyMs, 10),
    },
    {
      key: PARAM.availability,
      label: "Availability",
      kind: "percent",
      default: 0.999,
      min: 0.9,
      max: 1,
      step: 0.0001,
      group: "resilience",
      help: "Availability of a single instance.",
      ...overrides.availability,
    },
  ];
  return specs;
}

/* ---------- reusable specs ---------- */

export function hitRateSpec(def = 0.9, help?: string): ParamSpec {
  return {
    key: PARAM.hitRate,
    label: "Hit rate",
    kind: "percent",
    default: def,
    min: 0,
    max: 1,
    step: 0.01,
    group: "capacity",
    help: help ?? "Fraction served here; the rest goes down on_miss edges.",
  };
}

export function timeoutSpec(def = 1000, help?: string): ParamSpec {
  return {
    key: PARAM.timeoutMs,
    label: "Timeout",
    kind: "duration",
    default: def,
    min: 1,
    max: 300_000,
    step: 50,
    unit: "ms",
    group: "resilience",
    help: help ?? "Callers give up after this long; a timed-out call counts as a failure.",
  };
}

export function retrySpecs(defRetries = 0): ParamSpec[] {
  return [
    {
      key: PARAM.maxRetries,
      label: "Max retries",
      kind: "number",
      default: defRetries,
      min: 0,
      max: 5,
      step: 1,
      group: "resilience",
      help: "Extra attempts after a failure or timeout. Each retry is extra load downstream.",
    },
    {
      key: PARAM.retryBackoffMs,
      label: "Retry backoff",
      kind: "duration",
      default: 100,
      min: 0,
      max: 60_000,
      step: 50,
      unit: "ms",
      group: "resilience",
      help: "Base delay before a retry; doubles on each attempt (exponential backoff).",
      visibleIf: (p) => Number(p[PARAM.maxRetries]) > 0,
    },
    {
      key: PARAM.retryJitter,
      label: "Jitter",
      kind: "boolean",
      default: true,
      group: "resilience",
      help: "Randomize the backoff so clients don't retry in synchronized waves.",
      visibleIf: (p) => Number(p[PARAM.maxRetries]) > 0,
    },
  ];
}

export function maxQueueSpec(def = 1000, group: ParamSpec["group"] = "advanced"): ParamSpec {
  return {
    key: PARAM.maxQueue,
    label: "Max queue",
    kind: "number",
    default: def,
    min: 0,
    step: 100,
    group,
    help: "Requests waiting above this are dropped.",
  };
}

export function p99Spec(def: number): ParamSpec {
  return {
    key: PARAM.serviceTimeP99Ms,
    label: "Service time p99",
    kind: "duration",
    default: def,
    min: 0.1,
    step: 1,
    unit: "ms",
    group: "latency",
    help: "Tail service time without queueing. Exponential service times put p99 at ≈ 4.6× the mean.",
  };
}

export function ttlSpec(def: number, help: string): ParamSpec {
  return {
    key: PARAM.ttlSec,
    label: "TTL",
    kind: "duration",
    default: def,
    min: 0,
    max: 31_536_000,
    step: 60,
    unit: "s",
    group: "advanced",
    help,
  };
}

/** Autoscaling policy keys, shared by services (built-in) and the Autoscaler node. */
export function autoscalePolicySpecs(visibleIf?: ParamSpec["visibleIf"]): ParamSpec[] {
  return [
    {
      key: PARAM.autoscaleMin,
      label: "Min instances",
      kind: "number",
      default: 1,
      min: 1,
      max: MAX_INSTANCES,
      step: 1,
      group: "capacity",
      visibleIf,
    },
    {
      key: PARAM.autoscaleMax,
      label: "Max instances",
      kind: "number",
      default: 10,
      min: 1,
      max: MAX_INSTANCES,
      step: 1,
      group: "capacity",
      help: "Hard ceiling: protects the database and the bill from runaway scale-out.",
      visibleIf,
    },
    {
      key: PARAM.targetUtilization,
      label: "Target utilization",
      kind: "percent",
      default: 0.6,
      min: 0.1,
      max: 0.95,
      step: 0.05,
      group: "capacity",
      help: "Target tracking adds instances above this and removes them below it. 50–70% leaves headroom for spikes.",
      visibleIf,
    },
    {
      key: PARAM.scaleCooldownSec,
      label: "Cooldown",
      kind: "duration",
      default: 300,
      min: 0,
      max: 3600,
      step: 30,
      unit: "s",
      group: "advanced",
      help: "Wait after a scaling action before the next one (AWS default cooldown and the Kubernetes HPA scale-down window are both 300 s).",
      visibleIf,
    },
  ];
}

/** Built-in autoscaling toggle + policy (hidden while off). */
export function builtInAutoscaleSpecs(): ParamSpec[] {
  const on = (p: Params) => p[PARAM.autoscale] === true;
  return [
    {
      key: PARAM.autoscale,
      label: "Autoscaling",
      kind: "boolean",
      default: false,
      group: "capacity",
      help: "Let the platform add/remove instances to hold the target utilization.",
    },
    ...autoscalePolicySpecs(on),
  ];
}

/* ---------- generic, routing-based params (used by `genericSchema`) ---------- */

export function routingParams(routing: RoutingKind): ParamSpec[] {
  switch (routing) {
    case "cache":
      return [hitRateSpec()];
    case "service":
      return [timeoutSpec(), ...retrySpecs().slice(0, 1), maxQueueSpec()];
    case "queue":
      return [
        {
          key: PARAM.consumers,
          label: "Consumers",
          kind: "number",
          default: 4,
          min: 1,
          max: 1000,
          step: 1,
          group: "capacity",
        },
        {
          key: PARAM.maxQueue,
          label: "Max depth",
          kind: "number",
          default: 1_000_000,
          min: 0,
          step: 1000,
          group: "capacity",
        },
      ];
    case "rate-limiter":
      return [limitRpsSpec(), overLimitSpec()];
    case "lb":
      return [lbAlgorithmSpec()];
    default:
      return [];
  }
}

export function limitRpsSpec(visibleIf?: ParamSpec["visibleIf"]): ParamSpec {
  return {
    key: PARAM.limitRps,
    label: "Limit",
    kind: "number",
    default: 10_000,
    min: 1,
    step: 100,
    unit: "rps",
    group: "capacity",
    help: "Steady-state requests per second let through.",
    visibleIf,
  };
}

export function overLimitSpec(visibleIf?: ParamSpec["visibleIf"]): ParamSpec {
  return {
    key: PARAM.overLimitAction,
    label: "Over limit",
    kind: "enum",
    default: "reject",
    options: [
      { value: "reject", label: "Reject (429)" },
      { value: "queue", label: "Queue" },
    ],
    group: "resilience",
    help: "Reject the excess with 429 Too Many Requests, or delay it in a queue.",
    visibleIf,
  };
}

export function lbAlgorithmSpec(): ParamSpec {
  return {
    key: PARAM.lbAlgorithm,
    label: "Algorithm",
    kind: "enum",
    default: "round-robin",
    options: [
      { value: "round-robin", label: "Round robin" },
      { value: "least-connections", label: "Least connections" },
      { value: "weighted", label: "Weighted" },
      { value: "hash", label: "Hash" },
    ],
    group: "capacity",
    help: "How requests are spread across healthy targets.",
  };
}
