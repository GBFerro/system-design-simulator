import { CORE_PARAM, type Params } from "../types";
import { NOSQL_TECHNOLOGIES } from "./nosql";
import { SQL_TECHNOLOGIES } from "./sql";
import type { TechClass, Technology } from "./types";

/**
 * The technology catalog (component-technologies, TEC-10): one place for the
 * numbers, prices and sources of every technology of the central types.
 *
 * Imports no runtime value from `params.ts` or the registry: `params.ts`
 * builds the `technology` spec from this module, so importing back would make
 * a cycle. Param keys here are `CORE_PARAM` or plain strings of `PARAM` keys.
 */

export type * from "./types";

/** The component types that offer technologies. */
export const CENTRAL_TYPES = [
  "load-balancer",
  "api-gateway",
  "sql-db",
  "read-replica",
  "nosql-db",
  "cache",
  "message-queue",
  "pub-sub",
  "search",
  "object-storage",
] as const;

/** Every technology, in display order (the files T2–T7 add). */
export const TECHNOLOGIES: readonly Technology[] = [...SQL_TECHNOLOGIES, ...NOSQL_TECHNOLOGIES];

/** The class asked for, else the technology's default; undefined for a managed technology. */
export function classOf(tech: Technology, classId?: string): TechClass | undefined {
  const classes = tech.classes ?? [];
  return classes.find((c) => c.id === classId) ?? classes.find((c) => c.id === tech.defaultClass);
}

/** Lookups over one technology list (pure, so tests can build one from a fixture). */
export function buildTechIndex(list: readonly Technology[]) {
  const byComponent = new Map<string, Technology[]>();
  for (const tech of list) {
    for (const componentId of tech.componentIds) {
      byComponent.set(componentId, [...(byComponent.get(componentId) ?? []), tech]);
    }
  }

  /** The technologies of a type, without `generic`, in display order. */
  function technologiesOf(componentId: string): readonly Technology[] {
    return byComponent.get(componentId) ?? [];
  }

  function getTechnology(componentId: string, techId: string): Technology | undefined {
    return technologiesOf(componentId).find((t) => t.id === techId);
  }

  /** The technology a new node of the type starts with; undefined for a type without any. */
  function defaultTechnologyOf(componentId: string): string | undefined {
    return technologiesOf(componentId).find((t) => t.defaultFor?.includes(componentId))?.id;
  }

  /**
   * The params a technology (and its class, the default when `classId` is
   * missing or not one of its classes) sets: `technology`, `instanceClass`,
   * capacity and service time, the technology's params, then the class's.
   * Empty for `generic` or a technology the type doesn't offer.
   */
  function techPreset(componentId: string, techId: string, classId?: string): Params {
    const tech = getTechnology(componentId, techId);
    if (!tech) return {};
    const cls = classOf(tech, classId);
    const sized = cls ?? tech.managed;
    return {
      technology: tech.id,
      ...(cls ? { instanceClass: cls.id } : {}),
      ...(sized
        ? {
            [CORE_PARAM.capacityPerInstance]: sized.capacityPerInstance,
            [CORE_PARAM.serviceTimeMs]: sized.serviceTimeMs,
          }
        : {}),
      ...tech.params,
      ...cls?.params,
    };
  }

  return { technologiesOf, getTechnology, defaultTechnologyOf, techPreset };
}

export const { technologiesOf, getTechnology, defaultTechnologyOf, techPreset } =
  buildTechIndex(TECHNOLOGIES);
