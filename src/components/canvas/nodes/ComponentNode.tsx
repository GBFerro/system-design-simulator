"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { ChevronDown, TriangleAlert, OctagonAlert } from "lucide-react";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import type { RuntimeNodeStatus } from "@/engine/types";
import {
  formatHeadline,
  headlineMetricOf,
  isoArchetypeOf,
  isoTintOf,
  type IsoHeadline,
} from "@/lib/iso";
import { IsoModel, type IsoStatus } from "./IsoModel";
import { NodeActionsToolbar } from "./NodeActionsToolbar";
import { NodeMetricsBadge } from "./NodeMetricsBadge";
import { ReturnHandles } from "./ReturnHandles";
import { useNodeBlast, useNodeRuntime, useNodeStatus } from "@/store/runtimeStore";
import { useNodeFindingSeverity, useNodePreviewChange } from "@/store/advisorStore";
import { capacityPerInstanceOf, instancesOf } from "@/domain/components/registry";
import { technologyOf } from "@/domain/components/params";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";

type ComponentNode = Node<ComponentNodeData, "component">;

/**
 * The model's halo by runtime status. A node with no snapshot has no halo; the status icon in the
 * metrics badge still says it too (color AND icon).
 */
const ISO_STATUS: Record<RuntimeNodeStatus, IsoStatus> = {
  ok: "ok",
  warn: "slow",
  critical: "err",
  down: "err",
};

/** The one live figure of a node, under its name. Reads only this node's metrics. */
function NodeHeadline({ nodeId, field }: { nodeId: string; field: IsoHeadline }) {
  const m = useNodeRuntime(nodeId);
  return (
    <div
      data-node-headline={field}
      className="pointer-events-none absolute left-0 top-[106px] flex h-3.5 w-full items-center justify-center whitespace-nowrap font-mono text-[10px] leading-none text-zinc-300"
    >
      {m ? formatHeadline(field, m) : ""}
    </div>
  );
}

function ComponentNodeInner({ id, data, selected }: NodeProps<ComponentNode>) {
  const nodeData = data;
  const archetype = isoArchetypeOf(nodeData.componentId);
  const tint = isoTintOf(nodeData.componentId, nodeData.category);
  // Runtime metrics come from runtimeStore (Spec 07), never from node.data.
  // Only the status string is read here, so the node itself re-renders just
  // when its status changes; the numbers live in <NodeHeadline> and <NodeMetricsBadge>.
  const status = useNodeStatus(id);
  // Chaos (Spec 08): the fault's target gets its own outline; nodes it
  // degrades pulse. Advisor (Spec 12): a discreet marker for structure hints.
  const blast = useNodeBlast(id);
  const finding = useNodeFindingSeverity(id);
  const previewChange = useNodePreviewChange(id);
  const replicas = instancesOf(nodeData);
  const capacity = capacityPerInstanceOf(nodeData);
  // component-technologies (TEC-24): the real product's short name; none for generic
  const tech = technologyOf(nodeData.componentId, nodeData.params ?? {});

  const isCustom = nodeData.componentId === "custom";
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(nodeData.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const isCoarse = useIsCoarsePointer();
  const readOnly = useIsActiveTabReadOnly();

  // The details (capacity line, technology tag, metrics badge) are always rendered and fade in
  // with opacity: on hover and focus, or while selected. A coarse pointer has no hover, so only
  // selection reveals them there.
  const reveal = `transition-opacity duration-150 ${
    selected
      ? "opacity-100"
      : isCoarse
        ? "opacity-0"
        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
  }`;

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

  const handleClass = isCoarse ? "!h-5 !w-5" : "!h-2 !w-2";

  return (
    // A fixed 160 x 120 box (DEFAULT_NODE_SIZE): everything that changes with the label, the
    // technology, the instances, the status, hover or selection is absolutely positioned and may
    // overflow it, so the box never resizes (a re-measure would rewrite canvasStore).
    <div data-blast={blast} data-finding={finding} className="group relative h-[120px] w-[160px]">
      <NodeActionsToolbar nodeId={id} />

      {/* The isometric model, ~96 px, with the status halo and the selected ring */}
      <IsoModel
        archetype={archetype}
        tint={tint}
        status={status ? ISO_STATUS[status] : undefined}
        selected={selected}
        className="pointer-events-none absolute left-8 top-0 h-24 w-24"
      />

      {/* Blast radius: outline/pulse drawn outside the box, so the node never resizes */}
      {blast && (
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-1.5 rounded-[14px] border-2 ${
            blast === "target"
              ? "border-dashed border-[var(--sf-err)]"
              : "blast-pulse border-[var(--sf-err)]"
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

      {/* Name pill */}
      <div className="absolute left-1/2 top-[88px] flex h-[18px] max-w-[144px] -translate-x-1/2 items-center rounded-full border border-zinc-700 bg-zinc-900 px-2">
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
            className="nodrag w-[112px] bg-transparent text-[11px] font-medium text-zinc-100 outline-none"
          />
        ) : (
          <span
            title={nodeData.label}
            className={`truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-zinc-100 ${isCustom ? "cursor-text" : ""}`}
            onDoubleClick={handleDoubleClick}
            onClick={handleLabelClick}
          >
            {nodeData.label}
          </span>
        )}
      </div>

      {/* The headline metric: one live figure, empty without a snapshot */}
      <NodeHeadline nodeId={id} field={headlineMetricOf(archetype)} />

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
          className="nodrag nopan absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center gap-px rounded-full bg-cyan-600 px-1 text-[8px] font-bold text-white transition-colors hover:bg-cyan-500"
        >
          ×{replicas}
          <ChevronDown className="h-2 w-2" aria-hidden />
        </button>
      )}

      {/* Details under the box: capacity line, technology tag, metrics badge. They overflow the
          box (never resize it) and fade in on hover, focus and selection. */}
      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 flex w-[132px] -translate-x-1/2 flex-col items-center gap-0.5">
        <div className="flex items-center justify-center gap-1">
          <span className={`font-mono text-[9px] text-zinc-400 ${reveal}`}>
            {(capacity / 1000).toFixed(0)}k qps
          </span>
          {tech && (
            <span
              data-technology={tech.id}
              className={`whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-800 px-1.5 font-mono text-[9px] leading-[14px] text-zinc-300 ${reveal}`}
            >
              {tech.layer ? `${tech.short} · ${tech.layer}` : tech.short}
            </span>
          )}
        </div>
        {/* Runtime metrics (OBS-01): RPS in, utilization, p99, status icon */}
        <NodeMetricsBadge nodeId={id} showSparkline={isCoarse && !!selected} className={reveal} />
      </div>

      {/* Handles at the slab's mid-height; larger visual size on touch devices (44px hit area via CSS ::after) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ top: "54%" }}
        className={`${handleClass} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ top: "54%" }}
        className={`${handleClass} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
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
