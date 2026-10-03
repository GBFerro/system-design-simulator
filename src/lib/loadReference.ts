import type { Node, Edge } from "@xyflow/react";
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

  problem.referenceSolution.nodes.forEach((ref, index) => {
    const comp = getComponentById(ref.componentId);
    if (!comp) return;

    const nodeId = `${comp.id}-ref-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const list = instancesByComponent.get(ref.componentId) ?? [];
    list.push(nodeId);
    instancesByComponent.set(ref.componentId, list);

    const created = createComponentNode(comp, { x: ref.x, y: ref.y });
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
  for (const ref of problem.referenceSolution.edges) {
    const sourceId = nextInstance(ref.source, "source");
    const targetId = nextInstance(ref.target, "target");
    if (sourceId && targetId) {
      const fallbackRule = defaultEdgeRule(ref.source, ref.target, "http");
      refEdges.push({
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "animated",
        // The reference states its async flag; its rules default by component ids alone.
        data: newEdgeData(sourceId, targetId, canvasRuleGraph(refNodes, refEdges), {
          async: ref.async === true,
          rule: ref.rule
            ? // (reference rules are still written in the v2 flat shape)
              sanitizeEdgeRule({ ...edgeRuleV2Of(fallbackRule), ...ref.rule }, fallbackRule)
            : fallbackRule,
        }),
      });
    }
  }

  return { nodes: refNodes, edges: refEdges };
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
