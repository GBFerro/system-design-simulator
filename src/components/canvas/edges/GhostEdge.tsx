"use client";

import { memo } from "react";
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { edgeRuleBadge } from "@/domain/graph/edgeRules";
import type { CustomEdgeData } from "@/store/canvasStore";

/**
 * An edge an advisor quick fix would add (Spec 12, ADV-02), dashed violet
 * with its call rule, while the fix is previewed. A plain path (not
 * `.react-flow__edge-path`), so the particle layer never samples it.
 */
function GhostEdgeInner({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const badge = edgeRuleBadge((data as CustomEdgeData | undefined)?.rule);
  return (
    <g data-ghost-edge>
      <path
        d={path}
        fill="none"
        stroke="#a78bfa"
        strokeWidth={2}
        strokeDasharray="6 5"
        strokeOpacity={0.9}
      />
      {badge && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="pointer-events-none rounded border border-violet-400/40 bg-violet-950/80 px-1 py-0.5 text-[10px] font-medium leading-none text-violet-200"
          >
            {badge}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const GhostEdge = memo(GhostEdgeInner);
