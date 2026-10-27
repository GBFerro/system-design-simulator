import { SYSTEM_COMPONENTS } from "@/data/components";
import {
  coreParams,
  type CoreOverrides,
  instanceClassSpec,
  technologyOf,
  technologySpec,
} from "../params";
import { pricingFor } from "../pricing";
import { technologiesOf } from "../technologies";
import type { ComponentSchema, ParamSpec, Params, RoutingKind } from "../types";

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

/**
 * `visibleIf` of a param that only some technologies of `componentId` use:
 * shown for those, and for `generic` (or an unknown id) only when
 * `generic` is true, so the generic form stays what it was.
 */
export function shownFor(
  componentId: string,
  techIds: readonly string[],
  generic: boolean,
): (p: Params) => boolean {
  return (p) => {
    const tech = technologyOf(componentId, p);
    return tech ? techIds.includes(tech.id) : generic;
  };
}

/** Restrict an enum to the options the node's technology allows (`Technology.options`). */
function restrictedByTechnology(componentId: string, spec: ParamSpec): ParamSpec {
  const restricted = technologiesOf(componentId).some((t) => t.options?.[spec.key]);
  if (spec.kind !== "enum" || !restricted) return spec;
  const all = (spec.options ?? []).map((o) => o.value);
  return {
    ...spec,
    optionsFor: (p) => technologyOf(componentId, p)?.options?.[spec.key] ?? all,
  };
}

/** Hide a core param while the node's technology is a managed service (TEC-51). */
function hiddenWhenManaged(
  componentId: string,
  visibleIf?: ParamSpec["visibleIf"],
): ParamSpec["visibleIf"] {
  return (p) =>
    technologyOf(componentId, p)?.billing !== "managed" && (visibleIf ? visibleIf(p) : true);
}

/**
 * A central type's schema (component-technologies): `technology` (and
 * `instanceClass` when one of its technologies has classes) before the
 * type's params, enums limited to what the technology supports, and
 * `instances` / capacity per instance hidden for a managed service. With
 * `generic` every param shows as `defineSchema` would.
 */
export function defineTechSchema(
  id: string,
  routing: RoutingKind,
  params: ParamSpec[],
  core: CoreOverrides = {},
): ComponentSchema {
  const hasClasses = technologiesOf(id).some((t) => (t.classes ?? []).length > 0);
  return defineSchema(
    id,
    routing,
    [
      technologySpec(id),
      ...(hasClasses ? [instanceClassSpec(id)] : []),
      ...params.map((spec) => restrictedByTechnology(id, spec)),
    ],
    {
      ...core,
      instances: { ...core.instances, visibleIf: hiddenWhenManaged(id, core.instances?.visibleIf) },
      capacityPerInstance: {
        ...core.capacityPerInstance,
        visibleIf: hiddenWhenManaged(id, core.capacityPerInstance?.visibleIf),
      },
    },
  );
}

/** Catalog mean latency of `id` (the default `serviceTimeMs`). */
export function catalogLatencyMs(id: string): number {
  return SYSTEM_COMPONENTS.find((c) => c.id === id)?.latencyMs ?? 10;
}
