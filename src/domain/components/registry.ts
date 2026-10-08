import { getComponentById } from "@/data/components";
import type { SystemComponent } from "@/types/component";
import { coreParams, finitePositive, MAX_INSTANCES, PARAM, routingParams } from "./params";
import { pricingFor } from "./pricing";
import { CATALOG_SCHEMAS } from "./schemas";
import {
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

// Defined in `params.ts` (shared with `schemas/` without an import cycle).
export { PARAM, MAX_INSTANCES };

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
  // Spec 03 (CMP-02)
  client: "service",
  "worker-pool": "service",
  dlq: "queue",
  // waf, read-replica, autoscaler: "fixed" (default)
};

export function routingFor(componentId: string): RoutingKind {
  return ROUTING[componentId] ?? "fixed";
}

/* ---------- generic schema ---------- */

/** Generic schema for any catalog entry: core params + routing-specific ones. */
export function genericSchema(component: SystemComponent): ComponentSchema {
  const routing = routingFor(component.id);
  return {
    id: component.id,
    routing,
    params: [...coreParams(component), ...routingParams(routing)],
    pricing: pricingFor(component.id),
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

for (const schema of CATALOG_SCHEMAS) registerSchema(schema);

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

export function getParamSpec(componentId: string, key: string): ParamSpec | undefined {
  return getSchema(componentId).params.find((p) => p.key === key);
}

/**
 * Whether the component declares a hit rate: what makes a node a valid
 * `missOf` target of an `after_miss` call (AD-002). Every reader that builds a
 * call plan from the canvas asks this, so the badges, the balls and the
 * editor agree with the compiler, which checks the sanitized params instead
 * (same answer: `sanitizeParams` gives every declared key a value;
 * `call-plan.test.ts` checks it for the whole catalog).
 */
export function hasHitRateParam(componentId: string): boolean {
  return getParamSpec(componentId, PARAM.hitRate) !== undefined;
}

/* ---------- typed readers (used by UI, scoring and engine) ---------- */

/**
 * The part of a component node's data the readers need (`ComponentNodeData`
 * satisfies it). Every entry path (rehydrate, saved designs, import,
 * references, palette, paste) delivers `params`; v1 top-level fields are
 * converted by the persistence migration, never read here.
 */
export interface ParamsCarrier {
  componentId?: unknown;
  params?: unknown;
}

function rawParams(data: ParamsCarrier): Record<string, unknown> {
  return typeof data.params === "object" && data.params !== null
    ? (data.params as Record<string, unknown>)
    : {};
}

/** Numeric param with schema default, then `fallback`. Always finite. */
export function numParam(data: ParamsCarrier, key: string, fallback: number): number {
  const v = rawParams(data)[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
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

/** Every schema param of a node, validated: what the Props form shows and what an edit is merged into. */
export function resolvedParams(data: ParamsCarrier): Params {
  const componentId = typeof data.componentId === "string" ? data.componentId : "custom";
  return sanitizeParams(componentId, rawParams(data));
}
