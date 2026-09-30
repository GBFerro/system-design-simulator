/**
 * Structure hints (Spec 12, ADV-03): no entry point, disconnected nodes and
 * single points of failure. Computed on the scorer's `ScoringGraph` with the
 * scorer's own path/SPOF helpers (`scoring/paths.ts`), without the engine,
 * so they agree with the Score tab and cost O(nodes + edges).
 */
import type { Edge, Node } from "@xyflow/react";
import { findSpofs, syncPath } from "@/scoring/paths";
import { buildScoringGraph } from "@/scoring/scorer";
import type { ComponentNodeData } from "@/store/canvasStore";
import { SEVERITY_RANK, type Finding } from "./types";

function isComponent(n: Node): n is Node<ComponentNodeData> {
  return (
    n.type !== "text" && typeof (n.data as { componentId?: unknown })?.componentId === "string"
  );
}

export function structureFindings(nodes: readonly Node[], edges: readonly Edge[]): Finding[] {
  const comps = nodes.filter(isComponent);
  if (comps.length === 0) return [];
  const byId = new Map(comps.map((n) => [n.id, n]));
  const label = (id: string) => byId.get(id)?.data.label ?? id;
  const graph = buildScoringGraph(comps, edges as Edge[]);
  const findings: Finding[] = [];

  const path = syncPath(comps, edges, graph);
  const entries = path.entries;

  if (entries.length === 0) {
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
    if (graph.reachable.has(n.id)) continue;
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

  for (const n of findSpofs(comps, path, graph)) {
    findings.push({
      id: `spof:${n.id}`,
      severity: "warning",
      title: `${label(n.id)} is a single point of failure`,
      detail:
        "It's on the request path with one instance and no replica: if it fails, every request that needs it fails. Add instances (a standby to fail over to) or a replica in parallel.",
      targetIds: [n.id],
      source: "structure",
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
