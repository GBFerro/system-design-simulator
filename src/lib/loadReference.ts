import { withReturns } from "@/domain/graph/returns";
import type { Node, Edge, XYPosition } from "@xyflow/react";
import { DEFAULT_NODE_SIZE, type Size } from "@/lib/placement";
import type { Problem } from "@/types/problem";
import { getComponentById } from "@/data/components";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { createComponentNode } from "@/lib/nodeFactory";
import {
  canvasRuleGraph,
  defaultEdgeRule,
  edgeRuleV2Of,
  newEdgeData,
  sanitizeEdgeRule,
} from "@/domain/graph/edgeRules";
import { sanitizeParams } from "@/domain/components/registry";

const GRID = 16;
/** Clearance kept between reference node boxes. */
const REFERENCE_GAP = 16;

const isClear = (a: XYPosition, b: XYPosition, size: Size, gap: number): boolean =>
  Math.abs(a.x - b.x) >= size.width + gap || Math.abs(a.y - b.y) >= size.height + gap;

/**
 * Spread a layout so no two `size` boxes come closer than `gap`: the smallest uniform
 * scale k >= 1 about the layout's top-left bound, snapped to the 16 px grid (k is raised
 * in small steps if snapping brings a pair back together). A layout that already fits is
 * returned unchanged. Pure; pairs at the very same position cannot be separated by
 * scaling and are ignored.
 */
export function spreadReferenceLayout(
  positions: readonly XYPosition[],
  size: Size,
  gap: number,
): XYPosition[] {
  const pairs: [number, number][] = [];
  let k = 1;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx === 0 && dy === 0) continue;
      pairs.push([i, j]);
      if (isClear(a, b, size, gap)) continue;
      const need = Math.min(
        dx > 0 ? (size.width + gap) / dx : Infinity,
        dy > 0 ? (size.height + gap) / dy : Infinity,
      );
      k = Math.max(k, need);
    }
  }
  if (k === 1) return positions.map((p) => ({ x: p.x, y: p.y }));

  const ox = Math.min(...positions.map((p) => p.x));
  const oy = Math.min(...positions.map((p) => p.y));
  const place = (scale: number) =>
    positions.map((p) => ({
      x: Math.round((ox + (p.x - ox) * scale) / GRID) * GRID,
      y: Math.round((oy + (p.y - oy) * scale) / GRID) * GRID,
    }));
  let out = place(k);
  for (let step = 0; step < 400; step++) {
    if (pairs.every(([i, j]) => isClear(out[i], out[j], size, gap))) break;
    // (pairs holds every separable pair, so a snap that squeezes a clear pair is caught too)
    k += 0.02;
    out = place(k);
  }
  return out;
}

/**
 * Build canvas nodes + edges for a problem's reference solution.
 *
 * Instance matching is EXACT on componentId (never prefix-based):
 * - Each reference node becomes a unique instance, tracked per componentId in order.
 * - Edge endpoints referencing a componentId with N instances are connected
 *   round-robin by occurrence order (independent counters for source/target
 *   roles so chains like A -> B -> C stay connected through the same instance).
 */
export function buildReferenceGraph(problem: Problem): {
  nodes: Node<ComponentNodeData>[];
  edges: Edge[];
} {
  // componentId -> node ids, in declaration order
  const instancesByComponent = new Map<string, string[]>();
  const refNodes: Node<ComponentNodeData>[] = [];

  const spread = spreadReferenceLayout(
    problem.referenceSolution.nodes,
    DEFAULT_NODE_SIZE,
    REFERENCE_GAP,
  );

  problem.referenceSolution.nodes.forEach((ref, index) => {
    const comp = getComponentById(ref.componentId);
    if (!comp) return;

    const nodeId = `${comp.id}-ref-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const list = instancesByComponent.get(ref.componentId) ?? [];
    list.push(nodeId);
    instancesByComponent.set(ref.componentId, list);

    const created = createComponentNode(comp, spread[index]);
    const params = ref.params
      ? sanitizeParams(comp.id, { ...created.data.params, ...ref.params })
      : created.data.params;
    refNodes.push({ ...created, id: nodeId, data: { ...created.data, params } });
  });

  // Round-robin counters, keyed by `${componentId}#${role}`
  const rrCounters = new Map<string, number>();
  const nextInstance = (componentId: string, role: "source" | "target"): string | undefined => {
    const instances = instancesByComponent.get(componentId);
    if (!instances || instances.length === 0) return undefined;
    const key = `${componentId}#${role}`;
    const count = rrCounters.get(key) ?? 0;
    rrCounters.set(key, count + 1);
    return instances[count % instances.length];
  };

  const refEdges: Edge[] = [];
  const asyncIds = new Set<string>();
  for (const ref of problem.referenceSolution.edges) {
    const sourceId = nextInstance(ref.source, "source");
    const targetId = nextInstance(ref.target, "target");
    if (sourceId && targetId) {
      const fallbackRule = defaultEdgeRule(ref.source, ref.target, "http");
      if (ref.async === true) asyncIds.add(`e-${sourceId}-${targetId}`);
      refEdges.push({
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "animated",
        // The reference states its async flag; its rules default by component ids alone.
        data: newEdgeData(sourceId, targetId, canvasRuleGraph(refNodes, refEdges), {
          rule: !ref.rule
            ? fallbackRule
            : "calls" in ref.rule
              ? sanitizeEdgeRule(
                  {
                    ...ref.rule,
                    // `missOf` is a componentId here: point it at that node (a
                    // reference uses each component once); unknown → dropped,
                    // and the compiler warns.
                    calls: ref.rule.calls.map(({ missOf, ...call }) => {
                      const node = missOf ? instancesByComponent.get(missOf)?.[0] : undefined;
                      return node ? { ...call, missOf: node } : call;
                    }),
                  },
                  fallbackRule,
                )
              : // (the v2 flat shape: one call)
                sanitizeEdgeRule({ ...edgeRuleV2Of(fallbackRule), ...ref.rule }, fallbackRule),
        }),
      });
    }
  }

  // Every call that is not async gets its response (RET-25).
  return { nodes: refNodes, edges: withReturns(refEdges, (e) => asyncIds.has(e.id)) };
}

/**
 * Open a problem's reference solution in a read-only canvas tab.
 * The user's current design stays untouched in its own tab.
 */
export function loadReferenceIntoTab(problem: Problem): void {
  const { nodes, edges } = buildReferenceGraph(problem);

  useCanvasStore.getState().addTab({
    id: `ref-${problem.id}`,
    label: `${problem.title} (Reference)`,
    nodes,
    edges,
    readOnly: true,
  });

  useAppStore.getState().showToast("Reference opened in new tab — your design is safe", "success");
}
