import type { Node } from "@xyflow/react";
import { isComponentNode } from "@/lib/nodeFactory";
import { syncPath, type SyncPath } from "@/scoring/paths";
import { buildScoringGraph } from "@/scoring/scorer";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { ScoringGraph } from "@/types/scoring";
import type { CanvasGraph } from "./types";

/**
 * A design as every advisor rule reads it, built once per analysis: the
 * component nodes, the scorer's `ScoringGraph` and the synchronous request
 * path (`scoring/paths.ts`), so the advisor and the Score tab agree on what
 * is reachable, on the request path and redundant.
 */
export interface DesignView {
  graph: CanvasGraph;
  comps: Node<ComponentNodeData>[];
  byId: Map<string, Node<ComponentNodeData>>;
  scoring: ScoringGraph;
  path: SyncPath;
}

export function viewOf(graph: CanvasGraph): DesignView {
  const comps = graph.nodes.filter(isComponentNode);
  const scoring = buildScoringGraph(comps, graph.edges);
  return {
    graph,
    comps,
    byId: new Map(comps.map((n) => [n.id, n])),
    scoring,
    path: syncPath(comps, graph.edges, scoring),
  };
}

export function isAsyncEdge(edge: { data?: unknown }): boolean {
  return (edge.data as { async?: unknown } | undefined)?.async === true;
}
