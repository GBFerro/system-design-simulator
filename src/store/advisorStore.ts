import { create } from "zustand";
import type { Edge, Node } from "@xyflow/react";
import { structureFindings } from "@/advisor/structure";
import { SEVERITY_RANK, type Finding, type Severity } from "@/advisor/types";
import { instancesOf } from "@/domain/components/registry";
import { useCanvasStore, type ComponentNodeData } from "./canvasStore";

/**
 * Advisor findings for the active canvas (Spec 12). NOT persisted: derived
 * from `canvasStore` and recomputed only when the topology changes (ids,
 * types, labels, instances, wiring) — never on a drag. Nodes read their own
 * worst severity with `useNodeFindingSeverity(id)`.
 */
interface AdvisorState {
  findings: Finding[];
  /** Worst severity per node id. */
  byNode: Record<string, Severity>;
}

export const useAdvisorStore = create<AdvisorState>(() => ({ findings: [], byNode: {} }));

/** What the structure hints depend on; positions and selection are left out. */
export function topologySignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  let sig = "";
  for (const n of nodes) {
    if (n.type === "text") continue;
    const d = n.data as ComponentNodeData;
    sig += `${n.id}|${d.componentId}|${d.label}|${d.scalable ? 1 : 0}|${instancesOf(d)};`;
  }
  sig += "#";
  for (const e of edges) {
    sig += `${e.source}>${e.target}|${(e.data as { async?: unknown } | undefined)?.async === true ? 1 : 0};`;
  }
  return sig;
}

function worstByNode(findings: Finding[]): Record<string, Severity> {
  const out: Record<string, Severity> = {};
  for (const f of findings) {
    for (const id of f.targetIds) {
      const prev = out[id];
      if (!prev || SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev]) out[id] = f.severity;
    }
  }
  return out;
}

let lastSignature: string | null = null;

/** Recompute when the topology changed (idempotent otherwise). */
export function refreshAdvisor(nodes: readonly Node[], edges: readonly Edge[]): void {
  const sig = topologySignature(nodes, edges);
  if (sig === lastSignature) return;
  lastSignature = sig;
  const findings = structureFindings(nodes, edges);
  useAdvisorStore.setState({ findings, byNode: worstByNode(findings) });
}

refreshAdvisor(useCanvasStore.getState().nodes, useCanvasStore.getState().edges);
useCanvasStore.subscribe((s, prev) => {
  if (s.nodes !== prev.nodes || s.edges !== prev.edges) refreshAdvisor(s.nodes, s.edges);
});

export function useNodeFindingSeverity(nodeId: string): Severity | undefined {
  return useAdvisorStore((s) => s.byNode[nodeId]);
}
