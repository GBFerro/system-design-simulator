"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import { useEdgeRuntime } from "@/store/runtimeStore";
import { EDGE_STATUS_COLOR, edgeStrokeWidth } from "@/lib/particles";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore, type CustomEdgeData } from "@/store/canvasStore";
import { PARAM, routingFor } from "@/domain/components/registry";
import type { Params } from "@/domain/components/types";
import { edgeCallsBadge, edgeRuleOf, isAsyncEdge } from "@/domain/graph/edgeRules";
import { planFor, type PlanEdge } from "@/domain/graph/callPlan";

const protocolBadge: Record<string, { text: string; color: string } | null> = {
  http: null,
  grpc: { text: "gRPC", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  websocket: { text: "WS", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  pubsub: { text: "pub/sub", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  tcp: { text: "TCP", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  custom: null,
};

/** What an edge's badges show, read from its source's call plan (AD-002: never re-derived here). */
interface PlanBadge {
  /** Effective step of each sync call over the edge: "2", "2∥" when parallel, "1,4". */
  steps: string | null;
  /** The calls' conditions, e.g. "writes · miss: Redis" (FLW-15). */
  conditions: string | null;
  /** What the plan corrected on this edge (FLW-29), for the warning's tooltip. */
  warning: string | null;
}

let planCache: {
  nodes: readonly Node[];
  edges: readonly Edge[];
  byEdge: Map<string, PlanBadge>;
} | null = null;

/**
 * Badges of every edge, from each node's call plan. Recomputed only when the
 * canvas changes (never on a tick); an unchanged badge keeps its object, so
 * only edges whose badge changed re-render.
 */
function planBadges(nodes: readonly Node[], edges: readonly Edge[]): Map<string, PlanBadge> {
  if (planCache && planCache.nodes === nodes && planCache.edges === edges) return planCache.byEdge;
  const prev = planCache?.byEdge;
  const data = new Map<string, { componentId: string; label: string; params?: Params }>();
  for (const n of nodes) {
    if (n.type === "text") continue;
    const d = n.data as { componentId?: string; label?: string; params?: Params };
    data.set(n.id, {
      componentId: d.componentId ?? "custom",
      label: d.label ?? n.id,
      params: d.params,
    });
  }
  const labelOf = (id: string) => data.get(id)?.label ?? id;
  const out = new Map<string, PlanEdge[]>();
  const conditions = new Map<string, string | null>();
  for (const e of edges) {
    if (e.source === e.target || !data.has(e.source) || !data.has(e.target)) continue;
    const rule = edgeRuleOf({ nodes, edges }, e);
    conditions.set(e.id, edgeCallsBadge(rule, labelOf));
    const list = out.get(e.source) ?? out.set(e.source, []).get(e.source)!;
    list.push({ id: e.id, target: e.target, async: isAsyncEdge(e), calls: rule.calls });
  }
  const byEdge = new Map<string, PlanBadge>();
  for (const [source, outs] of out) {
    const routing = routingFor(data.get(source)!.componentId);
    const plan = planFor(
      source,
      outs,
      (id) => typeof data.get(id)?.params?.[PARAM.hitRate] === "number",
      { routing, labelOf },
    );
    // Steps mean something only where a node makes several sync calls (an LB splits, a queue decouples).
    const sync = routing === "lb" || routing === "queue" ? [] : plan.steps.flat();
    for (const e of outs) {
      const mine = sync.filter((p) => p.edgeId === e.id).sort((a, b) => a.index - b.index);
      const label = (step: number) =>
        `${step}${sync.filter((q) => q.step === step).length > 1 ? "∥" : ""}`;
      const steps =
        sync.length >= 2 && mine.length > 0
          ? [...new Set(mine.map((p) => label(p.step)))].join(",")
          : null;
      const prefix = `${labelOf(source)} → ${labelOf(e.target)}:`;
      const warnings = plan.warnings.filter((w) => w.startsWith(prefix));
      const next: PlanBadge = {
        steps,
        conditions: conditions.get(e.id) ?? null,
        warning: warnings.length > 0 ? warnings.join(" ") : null,
      };
      const old = prev?.get(e.id);
      const same =
        old !== undefined &&
        old.steps === next.steps &&
        old.conditions === next.conditions &&
        old.warning === next.warning;
      byEdge.set(e.id, same ? old : next);
    }
  }
  planCache = { nodes, edges, byEdge };
  return byEdge;
}

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
  // A copy drawn to an expanded node's instance card reads its edge's metrics
  // and carries its share of the load (`instanceGraph.ts`).
  const copy = data as { instanceOf?: string; share?: number; hideLabel?: boolean } | undefined;
  const runtime = useEdgeRuntime(copy?.instanceOf ?? id);
  // Step and condition badges from the source's call plan (FLW-15/29/30). They
  // depend on the graph only, so a tick never resizes them.
  const plan = useCanvasStore((s) => planBadges(s.nodes, s.edges).get(copy?.instanceOf ?? id));
  const rps = runtime ? runtime.rps * (copy?.share ?? 1) : undefined;
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

  // Blast radius (Spec 08): a dashed orange trace on the fault's target
  // edge, a pulsing one on edges it degrades. Drawn under the edge stroke.
  const blast = runtime?.blast;
  const badge = protocol ? protocolBadge[protocol] : null;
  const ruleBadge = plan?.conditions ?? null;
  const showLabel =
    !copy?.hideLabel && (label || badge || ruleBadge || plan?.steps || plan?.warning);

  return (
    <g
      data-edge-status={runtime?.status}
      data-edge-rps={runtime ? Math.round(runtime.rps) : undefined}
      data-edge-blast={blast}
    >
      {blast && (
        <path
          d={edgePath}
          fill="none"
          stroke="#fb923c"
          strokeWidth={edgeStrokeWidth(rps) + 5}
          strokeLinecap="round"
          strokeOpacity={blast === "target" ? 0.75 : 0.5}
          strokeDasharray={blast === "target" ? "3 7" : undefined}
          className={blast === "affected" ? "blast-pulse" : undefined}
          aria-hidden
        />
      )}
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: flowing ? EDGE_STATUS_COLOR[runtime.status] : idleStroke,
          strokeOpacity: flowing ? 0.6 : 1,
          strokeWidth: edgeStrokeWidth(rps),
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
            data-edge-label={id}
          >
            {label && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 leading-none">
                {label}
              </span>
            )}
            {plan?.steps && (
              <span
                data-edge-step
                title={`Step ${plan.steps} of the caller's calls (∥ = in parallel with another call)`}
                className="max-w-[3rem] truncate whitespace-nowrap rounded border border-zinc-600 bg-zinc-900 px-1 py-0.5 font-mono text-[10px] leading-none text-zinc-300"
              >
                {plan.steps}
              </span>
            )}
            {ruleBadge && (
              <span
                data-edge-rule={edgeData.rule?.calls[0]?.kind}
                title={ruleBadge}
                className="max-w-[9rem] truncate whitespace-nowrap rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.5 text-[10px] font-medium leading-none text-cyan-300"
              >
                {ruleBadge}
              </span>
            )}
            {plan?.warning && (
              <span
                data-edge-plan-warning
                role="img"
                aria-label="The call plan corrected this edge"
                title={plan.warning}
                className="text-amber-400"
              >
                <TriangleAlert className="h-3 w-3" aria-hidden />
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
