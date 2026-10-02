/**
 * Advisor findings (Spec 12): structure hints (ADV-03), findings from the
 * last run's load and the last score (ADV-01), and quick fixes that edit the
 * graph with a preview and one undo step (ADV-02).
 */
import type { Edge, Node } from "@xyflow/react";
import type { EdgeRule, Params } from "@/domain/components/types";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { ScoreResult } from "@/types/scoring";

export type Severity = "critical" | "warning" | "info";

export type FindingSource = "structure" | "scoring" | "metrics" | "chaos";

export interface Finding {
  /** Stable per rule + target, to deduplicate. */
  id: string;
  severity: Severity;
  title: string;
  /** Why it matters, with numbers from the last run when there are any. */
  detail: string;
  /** Nodes/edges to highlight and focus. */
  targetIds: string[];
  source: FindingSource;
  fix?: QuickFix;
}

/** The canvas a fix reads and edits (component and text nodes, edges). */
export interface CanvasGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * What a quick fix changes. New nodes and edges are complete (ids, positions,
 * params, rules); patches are validated when applied (`applyDiff`).
 */
export interface GraphDiff {
  addNodes: Node<ComponentNodeData>[];
  addEdges: Edge[];
  removeEdgeIds: string[];
  /** Param patches by node id (sanitized by the node's schema). */
  nodeParams: Record<string, Params>;
  /** Rule patches by edge id (normalized). */
  edgeRules: Record<string, Partial<EdgeRule>>;
}

export interface QuickFix {
  /** "Add a cache for reads in front of Orders DB". */
  label: string;
  /** Pure: the same graph gives the same diff (ids and positions included). */
  preview(graph: CanvasGraph): GraphDiff;
}

/** What findings beyond the structure read. Everything is optional. */
export interface AdvisorContext {
  /** Load each node received over the last run's recent window, req/s (absent without a run). */
  load?: Readonly<Record<string, number>>;
  /** Share of user requests that are reads (the problem's, else the Client's). */
  readRatio: number;
  /** The last score, while it still describes this design. */
  score?: ScoreResult | null;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/** Within a severity: structure first, then the run, then the score. */
export const SOURCE_RANK: Record<FindingSource, number> = {
  structure: 0,
  metrics: 1,
  chaos: 2,
  scoring: 3,
};

export function byPriority(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
  );
}
