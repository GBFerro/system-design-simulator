import type { Edge, Node } from "@xyflow/react";
import { instancesOf } from "@/domain/components/registry";
import { isAsyncEdge } from "@/domain/graph/edgeRules";
import { requestsWithAsync } from "@/domain/graph/returns";
import type { ComponentNodeData } from "@/store/canvasStore";

/**
 * A string that changes only when the design's structure does: component
 * ids, types, labels, `scalable`, instances, and the wiring (edge ids,
 * endpoints, sync/async). Positions and selection are left out, so views
 * keyed on it (advisor findings, chaos target lists) never recompute on a
 * drag.
 */
export function topologySignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  let sig = "";
  for (const n of nodes) {
    if (n.type === "text") continue;
    const d = n.data as ComponentNodeData;
    sig += `${n.id}|${d.componentId}|${d.label}|${d.scalable ? 1 : 0}|${instancesOf(d)};`;
  }
  sig += "#";
  // (sync/async is derived from the responses: they are not listed themselves)
  for (const e of requestsWithAsync(edges)) {
    sig += `${e.id}|${e.source}>${e.target}|${isAsyncEdge(e) ? 1 : 0};`;
  }
  return sig;
}
