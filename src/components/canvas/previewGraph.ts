import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import type { GraphDiff } from "@/advisor/types";

/**
 * The advisor's quick-fix preview (Spec 12, ADV-02) as ReactFlow elements:
 * the diff's new nodes and edges become ghosts (ids prefixed with
 * `GHOST_PREFIX`, never selectable, draggable or connectable), edges it
 * removes or re-rules get a class. Only what ReactFlow renders changes:
 * `canvasStore` never sees a ghost.
 */
export const GHOST_PREFIX = "ghost:";

export const isGhostId = (id: string) => id.startsWith(GHOST_PREFIX);

const GHOST = {
  selectable: false,
  draggable: false,
  connectable: false,
  focusable: false,
  deletable: false,
} as const;

export function withPreview(
  nodes: Node[],
  edges: Edge[],
  diff: GraphDiff | undefined,
): { nodes: Node[]; edges: Edge[] } {
  if (!diff) return { nodes, edges };
  const added = new Set(diff.addNodes.map((n) => n.id));
  const ref = (id: string) => (added.has(id) ? GHOST_PREFIX + id : id);
  const removed = new Set(diff.removeEdgeIds);
  return {
    nodes: [
      ...nodes,
      ...diff.addNodes.map((n) => ({ ...n, ...GHOST, id: GHOST_PREFIX + n.id, type: "ghost" })),
    ],
    edges: [
      ...edges.map((e) => {
        if (removed.has(e.id)) return { ...e, className: "sf-preview-removed" };
        const patch = diff.edgeRules[e.id];
        if (!patch) return e;
        // Show the rule the fix gives it (its badge reads "writes", say).
        const rule = { callsPerRequest: 1, ...(e.data?.rule as object | undefined), ...patch };
        return { ...e, className: "sf-preview-changed", data: { ...e.data, rule } };
      }),
      ...diff.addEdges.map((e) => ({
        ...e,
        ...GHOST,
        id: GHOST_PREFIX + e.id,
        source: ref(e.source),
        target: ref(e.target),
        type: "ghost",
      })),
    ],
  };
}

/** ReactFlow changes minus those about ghosts (their measured size, mostly). */
export function withoutGhostChanges<C extends NodeChange | EdgeChange>(changes: C[]): C[] {
  return changes.filter((c) => !("id" in c) || !isGhostId(c.id));
}
