/**
 * Structure hints (Spec 12, ADV-03): no entry point, disconnected nodes and
 * single points of failure. Computed on the scorer's `ScoringGraph` with the
 * scorer's own path/SPOF helpers (`scoring/paths.ts`), without the engine,
 * so they agree with the Score tab and cost O(nodes + edges).
 */
import type { Edge, Node } from "@xyflow/react";
import { PARAM } from "@/domain/components/registry";
import { findSpofs } from "@/scoring/paths";
import { emptyDiff } from "./graph";
import { byPriority, type Finding } from "./types";
import { viewOf, type DesignView } from "./view";

/** A SPOF's fix: a second instance to fail over to (what the scorer counts as redundancy). */
const STANDBY_INSTANCES = 2;

export function structureFindings(nodes: readonly Node[], edges: readonly Edge[]): Finding[] {
  return structureHints(viewOf({ nodes: [...nodes], edges: [...edges] })).sort(byPriority);
}

export function structureHints({ comps, byId, scoring, path }: DesignView): Finding[] {
  if (comps.length === 0) return [];
  const label = (id: string) => byId.get(id)?.data.label ?? id;
  const findings: Finding[] = [];

  if (path.entries.length === 0) {
    findings.push({
      id: "no-entry",
      severity: "critical",
      title: "No entry point",
      detail:
        "Nothing receives traffic: an entry point is a component with no incoming connections that calls the rest (usually a Client, DNS or load balancer). Connect one to your components — a design made only of cycles has none.",
      targetIds: comps.map((n) => n.id),
      source: "structure",
    });
    return findings;
  }

  for (const n of comps) {
    if (scoring.reachable.has(n.id)) continue;
    findings.push({
      id: `disconnected:${n.id}`,
      severity: "warning",
      title: `${n.data.label} is disconnected`,
      detail:
        "No entry point reaches it, so it gets no traffic, adds no capacity and earns no score. Wire it into the request path or remove it.",
      targetIds: [n.id],
      source: "structure",
    });
  }

  for (const n of findSpofs(comps, path, scoring)) {
    findings.push({
      id: `spof:${n.id}`,
      severity: "warning",
      title: `${label(n.id)} is a single point of failure`,
      detail:
        "It's on the request path with one instance and no replica: if it fails, every request that needs it fails. Add instances (a standby to fail over to) or a replica in parallel.",
      targetIds: [n.id],
      source: "structure",
      fix: {
        label: `Run ${STANDBY_INSTANCES} instances of ${label(n.id)} (a standby to fail over to)`,
        preview: () => ({
          ...emptyDiff(),
          nodeParams: { [n.id]: { [PARAM.instances]: STANDBY_INSTANCES } },
        }),
      },
    });
  }

  return findings;
}
