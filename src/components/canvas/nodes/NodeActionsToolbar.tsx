"use client";

import { NodeToolbar, Position } from "@xyflow/react";
import { CopyPlus, Minus, Plus, Trash2 } from "lucide-react";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { usePenStore } from "@/store/penStore";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import { instancesOf, MAX_INSTANCES } from "@/domain/components/registry";

/**
 * Quick actions floating above a node while it is the only selected item.
 * Everything goes through the same store actions as the keyboard and the
 * context menu (one undo step each).
 */
export function NodeActionsToolbar({ nodeId }: { nodeId: string }) {
  const visible = useCanvasStore((s) => {
    if (s.tabs.find((t) => t.id === s.activeTabId)?.readOnly) return false;
    let count = 0;
    let self = false;
    for (const n of s.nodes) {
      if (!n.selected) continue;
      count++;
      if (n.id === nodeId) self = true;
    }
    return self && count === 1 && !s.edges.some((e) => e.selected);
  });
  const replicas = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId);
    return node?.type === "component" ? instancesOf(node.data as ComponentNodeData) : null;
  });
  const penActive = usePenStore((s) => s.mode !== "off");
  const isCoarse = useIsCoarsePointer();
  const changeReplicas = useCanvasStore((s) => s.changeReplicas);
  const duplicateSelection = useCanvasStore((s) => s.duplicateSelection);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);

  const btn = `flex ${isCoarse ? "h-9 w-9" : "h-7 w-7"} items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent`;
  const icon = isCoarse ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <NodeToolbar isVisible={visible && !penActive} position={Position.Top} offset={10}>
      <div
        role="toolbar"
        aria-label="Node actions"
        className="flex items-center gap-0.5 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-0.5 shadow-lg backdrop-blur"
      >
        {replicas !== null && (
          <>
            <button
              type="button"
              className={btn}
              aria-label="Remove replica"
              title="Remove replica"
              disabled={replicas <= 1}
              onClick={() => changeReplicas(nodeId, -1)}
            >
              <Minus className={icon} />
            </button>
            <span
              className="min-w-[28px] text-center font-mono text-[11px] text-zinc-300"
              aria-label={`${replicas} replicas`}
            >
              ×{replicas}
            </span>
            <button
              type="button"
              className={btn}
              aria-label="Add replica"
              title="Add replica"
              disabled={replicas >= MAX_INSTANCES}
              onClick={() => changeReplicas(nodeId, 1)}
            >
              <Plus className={icon} />
            </button>
            <div className="mx-0.5 h-4 w-px bg-zinc-700" />
          </>
        )}
        <button
          type="button"
          className={btn}
          aria-label="Duplicate"
          title="Duplicate"
          onClick={duplicateSelection}
        >
          <CopyPlus className={icon} />
        </button>
        <button
          type="button"
          className={`${btn} text-rose-400 hover:text-rose-300`}
          aria-label="Delete"
          title="Delete"
          onClick={deleteSelection}
        >
          <Trash2 className={icon} />
        </button>
      </div>
    </NodeToolbar>
  );
}
