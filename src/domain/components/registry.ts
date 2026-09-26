import { getComponentById } from "@/data/components";
import type { SystemComponent } from "@/types/component";
import {
  CORE_PARAM,
  type ComponentSchema,
  type ParamSpec,
  type ParamValue,
  type Params,
  type RoutingKind,
} from "./types";

/**
 * Component schema registry (Spec 03, CMP-01).
 *
 * `getSchema(componentId)` always returns a schema: known ids get their own,
 * anything else (custom components, unknown ids from old saves) falls back to
 * the generic fixed-capacity schema built from the catalog defaults.
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
} as const;

/* ---------- routing kind per component id ---------- */

const ROUTING: Record<string, RoutingKind> = {
  "load-balancer": "lb",
  cdn: "cache",
  cache: "cache",
  "origin-shield": "cache",
  "message-queue": "queue",
  "pub-sub": "queue",
  "rate-limiter": "rate-limiter",
  "circuit-breaker": "breaker",
  "app-server": "service",
  "auth-service": "service",
  "api-gateway": "service",
  "websocket-server": "service",
  "notification-service": "service",
  "task-scheduler": "service",
  "stream-processor": "service",
  custom: "service",
};

export function routingFor(componentId: string): RoutingKind {
  return ROUTING[componentId] ?? "fixed";
}

/* ---------- generic schema builders ---------- */

function finitePositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Capacity/latency/instances: the three v1 numbers, now as params. */
function coreParams(component: Pick<SystemComponent, "maxQPS" | "latencyMs">): ParamSpec[] {
  return [
    {
      key: PARAM.instances,
      label: "Instances",
      kind: "number",
      default: 1,
      min: 1,
      max: 100,
      step: 1,
      group: "capacity",
      help: "Identical instances behind this node (replicas).",
    },
    {
      key: PARAM.capacityPerInstance,
      label: "Capacity per instance",
      kind: "number",
      default: finitePositive(component.maxQPS, 1000),
      min: 1,
      step: 100,
      unit: "rps",
      group: "capacity",
      help: "Requests per second one instance sustains before queueing.",
    },
    {
      key: PARAM.serviceTimeMs,
      label: "Service time",
      kind: "duration",
      default: finitePositive(component.latencyMs, 10),
      min: 0.1,
      step: 1,
      unit: "ms",
      group: "latency",
      help: "Mean time one instance spends on a request (no queueing).",
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
    },
  ];
}

function routingParams(routing: RoutingKind): ParamSpec[] {
  switch (routing) {
    case "cache":
      return [
        {
          key: PARAM.hitRate,
          label: "Hit rate",
          kind: "percent",
          default: 0.9,
          min: 0,
          max: 1,
          step: 0.01,
          group: "capacity",
          help: "Fraction served here; the rest goes down on_miss edges.",
        },
      ];
    case "service":
      return [
        {
          key: PARAM.timeoutMs,
          label: "Timeout",
          kind: "duration",
          default: 1000,
          min: 1,
          step: 50,
          unit: "ms",
          group: "resilience",
        },
        {
          key: PARAM.maxRetries,
          label: "Max retries",
          kind: "number",
          default: 0,
          min: 0,
          max: 5,
          step: 1,
          group: "resilience",
        },
        {
          key: PARAM.maxQueue,
          label: "Max queue",
          kind: "number",
          default: 1000,
          min: 0,
          step: 100,
          group: "advanced",
          help: "Requests waiting above this are dropped.",
        },
      ];
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
      return [
        {
          key: PARAM.limitRps,
          label: "Limit",
          kind: "number",
          default: 10_000,
          min: 1,
          step: 100,
          unit: "rps",
          group: "capacity",
        },
        {
          key: PARAM.overLimitAction,
          label: "Over limit",
          kind: "enum",
          default: "reject",
          options: [
            { value: "reject", label: "Reject (429)" },
            { value: "queue", label: "Queue" },
          ],
          group: "resilience",
        },
      ];
    case "lb":
      return [
        {
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
        },
      ];
    default:
      return [];
  }
}

/** Generic schema for any catalog entry: core params + routing-specific ones. */
export function genericSchema(component: SystemComponent): ComponentSchema {
  const routing = routingFor(component.id);
  return {
    id: component.id,
    routing,
    params: [...coreParams(component), ...routingParams(routing)],
  };
}

/* ---------- registry ---------- */

/**
 * Hand-written schemas by component id. Ids missing here use `genericSchema`.
 * Spec 03 fills this per type (`schemas/<type>.ts`).
 */
const SCHEMAS: Record<string, ComponentSchema> = {};

export function registerSchema(schema: ComponentSchema): void {
  SCHEMAS[schema.id] = schema;
}

const FALLBACK_COMPONENT: SystemComponent = {
  id: "custom",
  label: "Custom",
  category: "compute",
  icon: "Box",
  maxQPS: 1000,
  latencyMs: 10,
  scalable: true,
  stateful: false,
  description: "",
};

export function getSchema(componentId: string): ComponentSchema {
  const own = SCHEMAS[componentId];
  if (own) return own;
  const component = getComponentById(componentId) ?? { ...FALLBACK_COMPONENT, id: componentId };
  return genericSchema(component);
}

export function defaultParams(componentId: string): Params {
  const params: Params = {};
  for (const spec of getSchema(componentId).params) params[spec.key] = spec.default;
  return params;
}

/** Is `value` valid for `spec`? (type matches, finite, within min/max, known enum option) */
export function isValidParam(spec: ParamSpec, value: unknown): value is ParamValue {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && (spec.options ?? []).some((o) => o.value === value);
    default:
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
  }
}

/**
 * Validate raw params against the schema: keys outside the schema are
 * dropped, invalid values fall back to the default, missing keys get the
 * default. Never throws.
 */
export function sanitizeParams(componentId: string, raw: unknown): Params {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const params: Params = {};
  for (const spec of getSchema(componentId).params) {
    const value = input[spec.key];
    params[spec.key] = isValidParam(spec, value) ? value : spec.default;
  }
  return params;
}

/* ---------- typed readers (used by UI, scoring and engine) ---------- */

/** Minimal shape of a component node's data that the readers need. */
export interface ParamsCarrier {
  componentId?: unknown;
  params?: unknown;
  [key: string]: unknown;
}

/**
 * v1 node data kept these three numbers at the top level. Until the persisted
 * stores migrate (Spec 05), readers fall back to them so old canvases keep
 * their values.
 */
const LEGACY_FIELD: Record<string, string> = {
  [CORE_PARAM.instances]: "replicas",
  [CORE_PARAM.capacityPerInstance]: "maxQPS",
  [CORE_PARAM.serviceTimeMs]: "latencyMs",
};

function rawParams(data: ParamsCarrier): Record<string, unknown> {
  return typeof data.params === "object" && data.params !== null
    ? (data.params as Record<string, unknown>)
    : {};
}

/** Numeric param with schema default, then `fallback`. Always finite. */
export function numParam(data: ParamsCarrier, key: string, fallback: number): number {
  const v = rawParams(data)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const legacy = LEGACY_FIELD[key] ? data[LEGACY_FIELD[key]] : undefined;
  if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  const componentId = typeof data.componentId === "string" ? data.componentId : "custom";
  const def = getSchema(componentId).params.find((p) => p.key === key)?.default;
  return typeof def === "number" && Number.isFinite(def) ? def : fallback;
}

export function instancesOf(data: ParamsCarrier): number {
  return Math.max(1, Math.round(numParam(data, PARAM.instances, 1)));
}

export function capacityPerInstanceOf(data: ParamsCarrier): number {
  return finitePositive(numParam(data, PARAM.capacityPerInstance, 1000), 1000);
}

export function serviceTimeMsOf(data: ParamsCarrier): number {
  return finitePositive(numParam(data, PARAM.serviceTimeMs, 10), 10);
}
