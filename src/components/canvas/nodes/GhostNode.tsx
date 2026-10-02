"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Server } from "lucide-react";
import { ICON_MAP } from "@/lib/icons";
import type { ComponentNodeData } from "@/store/canvasStore";

type GhostNode = Node<ComponentNodeData, "ghost">;

/**
 * A node an advisor quick fix would add (Spec 12, ADV-02), drawn dashed over
 * the canvas while the fix is previewed. Not part of the graph: it can't be
 * selected, dragged or connected, and disappears when the preview ends.
 */
function GhostNodeInner({ data }: NodeProps<GhostNode>) {
  const Icon = ICON_MAP[data.icon] ?? Server;
  const instances = Number(data.params?.instances ?? 1);
  return (
    <div
      data-ghost-node={data.componentId}
      className="relative flex flex-col items-center gap-1 rounded-xl border border-dashed border-violet-400/80 bg-violet-950/40 px-4 py-3"
    >
      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-500 px-1.5 text-[9px] font-semibold uppercase leading-4 tracking-wide text-white">
        New
      </span>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span className="max-w-[96px] text-center text-[11px] font-medium leading-tight text-violet-100">
          {data.label}
        </span>
      </div>
      <span className="font-mono text-[9px] text-violet-200/80">
        {instances > 1 ? `×${instances}` : "1 instance"}
      </span>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
    </div>
  );
}

export const GhostNode = memo(GhostNodeInner);
