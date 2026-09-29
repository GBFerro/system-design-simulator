import type { Edge, Node } from "@xyflow/react";
import { instancesOf } from "@/domain/components/registry";
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
  for (const e of edges) {
    const async = (e.data as { async?: unknown } | undefined)?.async === true;
    sig += `${e.id}|${e.source}>${e.target}|${async ? 1 : 0};`;
  }
  return sig;
}
