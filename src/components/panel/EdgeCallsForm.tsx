"use client";

import type { Edge, Node } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import { getParamSpec, PARAM, routingFor } from "@/domain/components/registry";
import type { EdgeCall, ParamValue } from "@/domain/components/types";
import { planFor, type CallPlan } from "@/domain/graph/callPlan";
import {
  EDGE_LINK_SPECS,
  MAX_EDGE_CALLS,
  edgeCallSpecsFor,
  edgeCallValues,
  isAsyncEdge,
  type CallFormContext,
  type EdgeRulePatch,
} from "@/domain/graph/edgeRules";
import {
  edgeRuleOf,
  useCanvasStore,
  useIsActiveTabReadOnly,
  type ComponentNodeData,
} from "@/store/canvasStore";
import { ParamsForm } from "./ParamsForm";
import { SECTION_TITLE } from "./styles";

/**
 * The calls an edge carries (request-flow, FLW-17): one block per call with
 * its condition, step and calls per request, plus the link's network fields.
 * Every edit goes through `updateEdgeRule` (one undo step, no-op on a
 * read-only tab, FLW-25), except the first explicit step of a node, which
 * also pins the node's other calls to the steps they run at now so their
 * visible order doesn't change: several edges, so `applyGraphEdit` (still one
 * undo step).
 */

type Graph = { nodes: readonly Node[]; edges: readonly Edge[] };

const componentIdOf = (graph: Graph, nodeId: string) =>
  (graph.nodes.find((n) => n.id === nodeId)?.data as ComponentNodeData | undefined)?.componentId;

function hasHitRate(graph: Graph, nodeId: string): boolean {
  const componentId = componentIdOf(graph, nodeId);
  return componentId !== undefined && getParamSpec(componentId, PARAM.hitRate) !== undefined;
}

function labelOf(graph: Graph, nodeId: string): string {
  const data = graph.nodes.find((n) => n.id === nodeId)?.data as { label?: unknown } | undefined;
  return typeof data?.label === "string" && data.label !== "" ? data.label : nodeId;
}

/** The call plan of `sourceId` over its outgoing edges in graph order (what the compiler builds). */
function sourcePlan(graph: Graph, sourceId: string): CallPlan {
  const componentId = componentIdOf(graph, sourceId);
  return planFor(
    sourceId,
    graph.edges
      .filter((e) => e.source === sourceId)
      .map((e) => ({
        id: e.id,
        target: e.target,
        async: isAsyncEdge(e),
        calls: edgeRuleOf(graph, e).calls,
      })),
    (id) => hasHitRate(graph, id),
    { routing: componentId ? routingFor(componentId) : undefined },
  );
}

/** Effective step of every call of the plan, keyed `edgeId#index`. */
function stepsOf(plan: CallPlan): Map<string, number> {
  const steps = new Map<string, number>();
  for (const p of [...plan.steps.flat(), ...plan.async])
    steps.set(`${p.edgeId}#${p.index}`, p.step);
  return steps;
}

/**
 * The graph with every call of `sourceId` pinned to the step it runs at now,
 * then call `index` of `edgeId` moved to `step`.
 */
function pinSteps(graph: Graph, sourceId: string, edgeId: string, index: number, step: number) {
  const steps = stepsOf(sourcePlan(graph, sourceId));
  return graph.edges.map((e) => {
    if (e.source !== sourceId) return e;
    const rule = edgeRuleOf(graph, e);
    const calls = rule.calls.map((c, i) => ({
      ...c,
      step: e.id === edgeId && i === index ? step : (steps.get(`${e.id}#${i}`) ?? c.step),
    }));
    return { ...e, data: { ...e.data, rule: { ...rule, calls } } };
  });
}

/**
 * What the call form (and the context menu) offers for a call of `edge`: the
 * caches its source calls synchronously over its other edges (FLW-08) and
 * whether the source itself has a hit rate (read-through, FLW-14).
 */
export function callFormContext(graph: Graph, edge: Edge): CallFormContext {
  return {
    caches: graph.edges
      .filter(
        (e) =>
          e.source === edge.source &&
          e.id !== edge.id &&
          !isAsyncEdge(e) &&
          hasHitRate(graph, e.target),
      )
      .map((e) => ({ id: e.target, label: labelOf(graph, e.target) })),
    readThrough: hasHitRate(graph, edge.source),
  };
}

export function EdgeCallsForm({ edge }: { edge: Edge }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateEdgeRule = useCanvasStore((s) => s.updateEdgeRule);
  const applyGraphEdit = useCanvasStore((s) => s.applyGraphEdit);
  const readOnly = useIsActiveTabReadOnly();

  const graph: Graph = { nodes, edges };
  const rule = edgeRuleOf(graph, edge);
  const plan = sourcePlan(graph, edge.source);
  const steps = stepsOf(plan);
  const sourceComponent = componentIdOf(graph, edge.source);
  const stepsApply = !sourceComponent || !["lb", "queue"].includes(routingFor(sourceComponent));
  const anyExplicitStep = edges.some(
    (e) => e.source === edge.source && edgeRuleOf(graph, e).calls.some((c) => c.step !== undefined),
  );

  const ctx = callFormContext(graph, edge);

  const setCalls = (calls: EdgeCall[]) => updateEdgeRule(edge.id, { calls });

  const commitCall = (index: number, key: string, value: ParamValue) => {
    if (key === "step") {
      const step = Number(value);
      if (!anyExplicitStep) {
        // First explicit step of the node: pin the others where they run now.
        applyGraphEdit((g) => ({
          nodes: g.nodes,
          edges: pinSteps(g, edge.source, edge.id, index, step),
        }));
        return;
      }
      setCalls(rule.calls.map((c, i) => (i === index ? { ...c, step } : c)));
      return;
    }
    setCalls(
      rule.calls.map((c, i) => {
        if (i !== index) return c;
        const next: EdgeCall = { ...c, [key]: value };
        if (key === "kind" && value === "after_miss" && !next.missOf) {
          next.missOf = ctx.caches[0]?.id;
        }
        return next;
      }),
    );
  };

  return (
    <div className="space-y-2" data-testid="edge-calls">
      <p className={SECTION_TITLE}>Calls</p>
      {rule.calls.map((call, i) => {
        const specs = edgeCallSpecsFor(ctx, call).filter((s) => stepsApply || s.key !== "step");
        return (
          <fieldset
            key={i}
            aria-label={`Call ${i + 1}`}
            className="space-y-2 rounded-md border border-zinc-800 p-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">Call {i + 1}</span>
              <button
                type="button"
                disabled={readOnly || rule.calls.length <= 1}
                onClick={() => setCalls(rule.calls.filter((_, j) => j !== i))}
                aria-label={`Remove call ${i + 1}`}
                title={rule.calls.length <= 1 ? "An edge keeps at least one call" : "Remove call"}
                className="flex items-center gap-1 rounded px-1 text-[11px] text-zinc-400 transition-colors enabled:hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            </div>
            <ParamsForm
              specs={specs}
              values={edgeCallValues(call, steps.get(`${edge.id}#${i}`) ?? call.step ?? 1)}
              grouped={false}
              disabled={readOnly}
              onCommit={(key, value) => commitCall(i, key, value)}
            />
          </fieldset>
        );
      })}
      <button
        type="button"
        disabled={readOnly || rule.calls.length >= MAX_EDGE_CALLS}
        onClick={() => setCalls([...rule.calls, { kind: "always", callsPerRequest: 1 }])}
        title={
          rule.calls.length >= MAX_EDGE_CALLS
            ? `An edge carries at most ${MAX_EDGE_CALLS} calls`
            : "Add a call over this edge"
        }
        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition-colors enabled:hover:border-cyan-600 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        Add call
      </button>
      <p className={SECTION_TITLE}>Link</p>
      <ParamsForm
        specs={EDGE_LINK_SPECS}
        values={{ networkLatencyMs: rule.networkLatencyMs, packetLoss: rule.packetLoss }}
        grouped={false}
        disabled={readOnly}
        onCommit={(key, value) => updateEdgeRule(edge.id, { [key]: value } as EdgeRulePatch)}
      />
    </div>
  );
}
