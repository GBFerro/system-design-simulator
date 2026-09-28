"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useEdgeRuntime } from "@/store/runtimeStore";
import { EDGE_STATUS_COLOR, edgeStrokeWidth } from "@/lib/particles";
import { useAppStore } from "@/store/appStore";
import type { CustomEdgeData } from "@/store/canvasStore";
import { edgeRuleBadge } from "@/domain/graph/edgeRules";

const protocolBadge: Record<string, { text: string; color: string } | null> = {
  http: null,
  grpc: { text: "gRPC", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  websocket: { text: "WS", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  pubsub: { text: "pub/sub", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  tcp: { text: "TCP", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  custom: null,
};

function AnimatedEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  // Per-edge runtime metrics (Spec 07): thickness ∝ load, color by status.
  // Moving tokens are drawn by the single <FlowParticles> canvas, not here.
  const runtime = useEdgeRuntime(id);
  const flowing = runtime !== undefined && runtime.rps > 0;
  const isDark = useAppStore((s) => s.theme) === "dark";
  const idleStroke = isDark ? "rgba(150, 165, 195, 0.32)" : "rgba(90, 105, 130, 0.45)";
  const edgeData = (data ?? {}) as CustomEdgeData;
  const isAsync = edgeData.async === true;
  const protocol = edgeData.protocol;
  const label = edgeData.label;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const badge = protocol ? protocolBadge[protocol] : null;
  const ruleBadge = edgeRuleBadge(edgeData.rule);
  const showLabel = label || badge || ruleBadge;

  return (
    <g
      data-edge-status={runtime?.status}
      data-edge-rps={runtime ? Math.round(runtime.rps) : undefined}
    >
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: flowing ? EDGE_STATUS_COLOR[runtime.status] : idleStroke,
          strokeOpacity: flowing ? 0.6 : 1,
          strokeWidth: edgeStrokeWidth(runtime?.rps),
          ...(isAsync ? { strokeDasharray: "6 4" } : {}),
        }}
      />
      {/* Label + protocol badge */}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan flex items-center gap-1"
          >
            {label && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 leading-none">
                {label}
              </span>
            )}
            {ruleBadge && (
              <span
                data-edge-rule={edgeData.rule?.kind}
                className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.5 text-[10px] font-medium leading-none text-cyan-300"
              >
                {ruleBadge}
              </span>
            )}
            {badge && (
              <span
                className={`rounded border px-1 py-0.5 text-[9px] font-medium leading-none ${badge.color}`}
              >
                {badge.text}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeInner);
