import { SYSTEM_COMPONENTS } from "@/data/components";
import { coreParams, type CoreOverrides } from "../params";
import { pricingFor } from "../pricing";
import type { ComponentSchema, ParamSpec, RoutingKind } from "../types";

/**
 * Build a catalog schema: the core params (defaults taken from the catalog
 * entry in `components.ts`) followed by the type-specific ones, priced from
 * the table in `pricing.ts`.
 */
export function defineSchema(
  id: string,
  routing: RoutingKind,
  params: ParamSpec[],
  core: CoreOverrides = {},
): ComponentSchema {
  const component = SYSTEM_COMPONENTS.find((c) => c.id === id);
  if (!component) throw new Error(`Schema for unknown component id "${id}"`);
  return {
    id,
    routing,
    params: [...coreParams(component, core), ...params],
    pricing: pricingFor(id),
  };
}

/** Catalog mean latency of `id` (the default `serviceTimeMs`). */
export function catalogLatencyMs(id: string): number {
  return SYSTEM_COMPONENTS.find((c) => c.id === id)?.latencyMs ?? 10;
}
