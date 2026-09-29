import type { Node, Edge } from "@xyflow/react";
import type { Problem } from "@/types/problem";
import { getComponentById } from "@/data/components";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { defaultParams } from "@/domain/components/registry";
import { defaultEdgeRule } from "@/domain/graph/edgeRules";

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

    refNodes.push({
      id: nodeId,
      type: "component",
      position: { x: ref.x, y: ref.y },
      data: {
        componentId: comp.id,
        label: comp.label,
        icon: comp.icon,
        category: comp.category,
        scalable: comp.scalable,
        params: defaultParams(comp.id),
      },
    });
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
      refEdges.push({
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "animated",
        data: {
          label: "",
          protocol: "http",
          async: false,
          rule: defaultEdgeRule(ref.source, ref.target, "http"),
        },
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
