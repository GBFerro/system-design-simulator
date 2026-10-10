"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { ChevronDown, Server, TriangleAlert, OctagonAlert } from "lucide-react";
import { ICON_MAP } from "@/lib/icons";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import { NodeActionsToolbar } from "./NodeActionsToolbar";
import { NodeMetricsBadge } from "./NodeMetricsBadge";
import { ReturnHandles } from "./ReturnHandles";
import { RUNTIME_STATUS_META } from "./runtimeStatus";
import { useNodeBlast, useNodeStatus } from "@/store/runtimeStore";
import { useNodeFindingSeverity, useNodePreviewChange } from "@/store/advisorStore";
import { capacityPerInstanceOf, instancesOf } from "@/domain/components/registry";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";

type ComponentNode = Node<ComponentNodeData, "component">;

// Each category gets a crisp, tinted icon "chip" so node types are
// distinguishable at a glance — the identity lives in the chip, not a heavy
// border, keeping the canvas calm (Linear/Railway-style).
const CATEGORY_COLORS: Record<string, { chip: string; icon: string; ring: string }> = {
  networking: { chip: "bg-blue-500/10", icon: "text-blue-400", ring: "ring-blue-500/25" },
  compute: { chip: "bg-violet-500/10", icon: "text-violet-400", ring: "ring-violet-500/25" },
  storage: { chip: "bg-amber-500/10", icon: "text-amber-400", ring: "ring-amber-500/25" },
  messaging: { chip: "bg-emerald-500/10", icon: "text-emerald-400", ring: "ring-emerald-500/25" },
  infrastructure: { chip: "bg-cyan-500/10", icon: "text-cyan-400", ring: "ring-cyan-500/25" },
};

function ComponentNodeInner({ id, data, selected }: NodeProps<ComponentNode>) {
  const nodeData = data;
  const Icon = ICON_MAP[nodeData.icon] ?? Server;
  const colors = CATEGORY_COLORS[nodeData.category] ?? CATEGORY_COLORS.compute;
  // Runtime metrics come from runtimeStore (Spec 07), never from node.data.
  // Only the status string is read here, so the node itself re-renders just
  // when its status changes; the numbers live in <NodeMetricsBadge>.
  const status = useNodeStatus(id);
  const statusDot = status ? RUNTIME_STATUS_META[status].dot : "bg-zinc-600";
  const isBottleneck = status === "critical" || status === "down";
  // Chaos (Spec 08): the fault's target gets its own outline; nodes it
  // degrades pulse. Advisor (Spec 12): a discreet marker for structure hints.
  const blast = useNodeBlast(id);
  const finding = useNodeFindingSeverity(id);
  const previewChange = useNodePreviewChange(id);
  const replicas = instancesOf(nodeData);
  const capacity = capacityPerInstanceOf(nodeData);

  const isCustom = nodeData.componentId === "custom";
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(nodeData.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const isCoarse = useIsCoarsePointer();
  const readOnly = useIsActiveTabReadOnly();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitLabel = useCallback(() => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== nodeData.label) {
      updateNodeData(id, { label: trimmed });
    } else {
      setEditLabel(nodeData.label);
    }
    setEditing(false);
  }, [editLabel, nodeData.label, id, updateNodeData]);

  const handleDoubleClick = useCallback(() => {
    if (!isCustom) return;
    setEditLabel(nodeData.label);
    setEditing(true);
  }, [isCustom, nodeData.label]);

  // Touch devices have no double-click: a tap on the label of an
  // already-selected custom node enters rename mode.
  const handleLabelClick = useCallback(() => {
    if (!isCoarse || !selected || !isCustom || editing) return;
    setEditLabel(nodeData.label);
    setEditing(true);
  }, [isCoarse, selected, isCustom, editing, nodeData.label]);

  return (
    <div
      data-blast={blast}
      data-finding={finding}
      className={`
        group relative flex flex-col items-center gap-1 rounded-xl border bg-zinc-900 px-4 py-3
        shadow-[var(--shadow-e2)] transition-[border-color,box-shadow] duration-150
        ${
          isBottleneck
            ? "border-rose-500/60 ring-2 ring-rose-500/20"
            : selected
              ? "border-cyan-500/80 ring-2 ring-cyan-500/30"
              : "border-zinc-700/70 hover:border-zinc-600"
        }
      `}
    >
      <NodeActionsToolbar nodeId={id} />

      {/* Blast radius: outline/pulse drawn outside the box, so the node never resizes */}
      {blast && (
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-1.5 rounded-[14px] border-2 ${
            blast === "target"
              ? "border-dashed border-orange-400"
              : "blast-pulse border-orange-400/80"
          }`}
        />
      )}
      {blast && (
        <span className="sr-only">
          {blast === "target" ? "Fault target" : "Affected by the active faults"}
        </span>
      )}

      {/* Advisor quick-fix preview: what the fix changes here, outside the box */}
      {previewChange && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-1.5 rounded-[14px] border-2 border-dashed border-violet-400/80"
          />
          <span
            data-preview-change={previewChange}
            className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-violet-500 px-2 font-mono text-[10px] leading-4 text-white"
          >
            {previewChange}
          </span>
        </>
      )}

      {/* Advisor marker (structure hint) */}
      {finding && finding !== "info" && (
        <span
          className={`absolute -bottom-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 ring-1 ${
            finding === "critical"
              ? "text-rose-400 ring-rose-500/50"
              : "text-amber-400 ring-amber-500/50"
          }`}
          role="img"
          aria-label={finding === "critical" ? "Advisor: critical issue" : "Advisor: warning"}
          title="See the Advisor tab"
        >
          {finding === "critical" ? (
            <OctagonAlert className="h-2.5 w-2.5" aria-hidden />
          ) : (
            <TriangleAlert className="h-2.5 w-2.5" aria-hidden />
          )}
        </span>
      )}

      {/* Status indicator dot */}
      <div
        className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-900 ${statusDot}`}
        style={{ animation: status ? "status-pulse 2s infinite" : "none" }}
      />

      {/* Icon + Label row */}
      <div className="flex items-center gap-2">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${colors.chip} ${colors.icon} ${colors.ring}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        {editing ? (
          <input
            ref={inputRef}
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setEditLabel(nodeData.label);
                setEditing(false);
              }
            }}
            className="nodrag max-w-[80px] bg-transparent text-[11px] font-medium text-zinc-200 outline-none border-b border-cyan-500"
          />
        ) : (
          <span
            className={`max-w-[96px] whitespace-normal break-words text-center text-[11px] font-medium leading-tight text-zinc-200 ${isCustom ? "cursor-text" : ""}`}
            onDoubleClick={handleDoubleClick}
            onClick={handleLabelClick}
          >
            {nodeData.label}
          </span>
        )}
      </div>

      {/* Stats */}
      <span className="font-mono text-[9px] text-zinc-400">
        {(capacity / 1000).toFixed(0)}k qps
      </span>

      {/* Instances: the ×N badge opens the node into one card per instance (a view setting) */}
      {replicas > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useExpandedNodesStore.getState().toggle(id);
          }}
          aria-expanded={false}
          aria-label={`Show the ${replicas} instances`}
          title="Open into one card per instance, to see how traffic is split"
          className="nodrag nopan absolute -left-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center gap-px rounded-full bg-cyan-600 px-1 text-[8px] font-bold text-white transition-colors hover:bg-cyan-500"
        >
          ×{replicas}
          <ChevronDown className="h-2 w-2" aria-hidden />
        </button>
      )}

      {/* Runtime metrics (OBS-01): RPS in, utilization, p99, status icon */}
      <NodeMetricsBadge nodeId={id} showSparkline={isCoarse && !!selected} />

      {/* Handles — larger visual size on touch devices (44px hit area via CSS ::after) */}
      <Handle
        type="target"
        position={Position.Left}
        className={`${isCoarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`${isCoarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
      />
      <ReturnHandles connectable={!readOnly} coarse={isCoarse} />
    </div>
  );
}

function areComponentNodePropsEqual(
  prev: NodeProps<ComponentNode>,
  next: NodeProps<ComponentNode>,
): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data;
  const n = next.data;
  return (
    p.componentId === n.componentId &&
    p.label === n.label &&
    p.params === n.params &&
    p.category === n.category &&
    p.icon === n.icon
  );
}

export const ComponentNode = memo(ComponentNodeInner, areComponentNodePropsEqual);
