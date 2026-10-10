"use client";

import { memo, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ReturnHandles } from "./ReturnHandles";
import { ChevronUp, Server } from "lucide-react";
import { ICON_MAP } from "@/lib/icons";
import { abbrev, fmtMs } from "@/lib/runtimeMetrics";
import { MAX_INSTANCE_CARDS, downInstances } from "@/lib/instances";
import { useChaosStore } from "@/store/chaosStore";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";
import { useNodeRuntime } from "@/store/runtimeStore";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import type { InstanceCardData } from "../instanceGraph";
import { RUNTIME_STATUS_META, utilizationBarClass } from "./runtimeStatus";

type InstanceNodeType = Node<InstanceCardData, "instance">;

/**
 * One instance of an expanded node (OBS-04), or the stacked card holding the
 * rest. Its numbers are its share of the node's: the engine splits a node's
 * load evenly over its live instances, so each live one carries rpsIn / live
 * at the node's utilization and latency; a down one carries nothing. Fixed
 * size, so a tick never makes ReactFlow re-measure it.
 */
function InstanceNodeInner({ data, selected }: NodeProps<InstanceNodeType>) {
  const { nodeId, lane, instances, stacked, base } = data;
  const Icon = ICON_MAP[base.icon] ?? Server;
  const isCoarse = useIsCoarsePointer();
  const m = useNodeRuntime(nodeId);
  const faults = useChaosStore((s) => s.faults);
  const down = useMemo(
    () => downInstances(faults, nodeId, base.componentId, instances),
    [faults, nodeId, base.componentId, instances],
  );

  // Instances this card holds: its own, or the overflow on the stacked card.
  const held = stacked > 0 ? down.slice(MAX_INSTANCE_CARDS) : [down[lane]];
  const heldDown = held.filter(Boolean).length;
  const live = down.filter((d) => !d).length;
  const allDown = heldDown === held.length;
  const rps = m && live > 0 ? (m.rpsIn * (held.length - heldDown)) / live : 0;
  const meta = m ? RUNTIME_STATUS_META[allDown ? "down" : m.status] : null;
  const util = Math.max(0, m?.utilization ?? 0);

  return (
    <div
      data-testid="instance-card"
      data-instance-of={nodeId}
      data-lane={lane}
      data-down={allDown ? "true" : undefined}
      className={`relative flex h-[68px] w-[176px] flex-col justify-center gap-1 rounded-xl border bg-zinc-900 px-3 shadow-[var(--shadow-e2)] ${
        allDown
          ? "border-rose-500/60"
          : selected
            ? "border-cyan-500/80 ring-2 ring-cyan-500/30"
            : "border-zinc-700/70"
      }`}
    >
      {/* The stacked card reads as a pile of cards behind it */}
      {stacked > 0 && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 -z-10 translate-x-1.5 translate-y-1.5 rounded-xl border border-zinc-700/70 bg-zinc-900"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-20 translate-x-3 translate-y-3 rounded-xl border border-zinc-800 bg-zinc-900"
          />
        </>
      )}

      {lane === 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useExpandedNodesStore.getState().toggle(nodeId);
          }}
          aria-expanded
          aria-label={`Hide the ${instances} instances`}
          title="Collapse back into one node"
          className="nodrag nopan absolute -left-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center gap-px rounded-full bg-cyan-600 px-1 text-[8px] font-bold text-white transition-colors hover:bg-cyan-500"
        >
          ×{instances}
          <ChevronUp className="h-2 w-2" aria-hidden />
        </button>
      )}

      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="truncate text-[11px] font-medium text-zinc-200">
          {stacked > 0 ? `+${stacked} instances` : `${base.label} #${lane + 1}`}
        </span>
        {heldDown > 0 && (
          <span className="ml-auto shrink-0 rounded bg-rose-500/15 px-1 font-mono text-[9px] text-rose-300">
            {stacked > 0 ? `${heldDown} down` : "down"}
          </span>
        )}
      </div>

      {m && meta && (
        <div className="font-mono text-[9px] leading-none text-zinc-300">
          <div className="flex items-center gap-1">
            <span
              className={`flex shrink-0 items-center ${meta.text}`}
              role="img"
              aria-label={`Status: ${meta.label}`}
            >
              <meta.Icon className="h-2.5 w-2.5" aria-hidden />
            </span>
            <span title="Requests in (req/s), this card's share">{abbrev(rps)}/s</span>
            <span className="ml-auto text-zinc-400">
              p99 <span className="text-zinc-200">{allDown ? "—" : fmtMs(m.p99)}</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${utilizationBarClass(util)}`}
                style={{ width: `${allDown ? 0 : Math.min(100, util * 100)}%` }}
              />
            </div>
            <span className="w-7 text-right">{allDown ? "0%" : `${Math.round(util * 100)}%`}</span>
          </div>
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={`${isCoarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={`${isCoarse ? "!h-5 !w-5" : "!h-2 !w-2"} !rounded-full !border !border-zinc-600 !bg-zinc-400`}
      />
      <ReturnHandles connectable={false} coarse={isCoarse} />
    </div>
  );
}

export const InstanceNode = memo(InstanceNodeInner);
