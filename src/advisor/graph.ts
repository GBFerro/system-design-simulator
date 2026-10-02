/**
 * Graph edits for the advisor's quick fixes (Spec 12, ADV-02): building a
 * `GraphDiff` (new nodes placed by the spiral search of Spec 02, new edges
 * with the connect defaults of Spec 03) and applying it. Everything here is
 * pure: ids derive from the finding and the graph, never from randomness, so
 * a preview and the edit it previews are the same.
 */
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import { instancesOf, PARAM, resolvedParams, sanitizeParams } from "@/domain/components/registry";
import type { EdgeRule, Params } from "@/domain/components/types";
import {
  applyEdgeRulePatch,
  connectEdgeRule,
  defaultEdgeAsync,
  sanitizeEdgeRule,
  type RuleGraph,
} from "@/domain/graph/edgeRules";
import { componentNodeWithId } from "@/lib/nodeFactory";
import { freePositionNear, nodeRect } from "@/lib/placement";
import type { ComponentNodeData, CustomEdgeData } from "@/store/canvasStore";
import type { CanvasGraph, GraphDiff } from "./types";

export function emptyDiff(): GraphDiff {
  return { addNodes: [], addEdges: [], removeEdgeIds: [], nodeParams: {}, edgeRules: {} };
}

/** `base`, else `base-2`, `base-3`… — the first id no node or edge of `graph` uses. */
export function uniqueId(base: string, graph: CanvasGraph, taken: readonly string[] = []): string {
  const used = new Set([
    ...graph.nodes.map((n) => n.id),
    ...graph.edges.map((e) => e.id),
    ...taken,
  ]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

function center(node: Node): XYPosition {
  const r = nodeRect(node);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function ruleGraph(nodes: readonly Node[], edges: readonly Edge[]): RuleGraph<Edge> {
  const ids = new Map(
    nodes.map((n) => [n.id, (n.data as Partial<ComponentNodeData>).componentId] as const),
  );
  return { componentIdOf: (id) => ids.get(id), edges };
}

/** An edge's rule, normalized (edges saved before v2 get their connect default). */
export function ruleOf(graph: CanvasGraph, edge: Edge): EdgeRule {
  const data = (edge.data ?? {}) as CustomEdgeData;
  return sanitizeEdgeRule(
    data.rule,
    connectEdgeRule(edge.source, edge.target, ruleGraph(graph.nodes, graph.edges), data.protocol),
  );
}

/** A component node of `componentId`, its params = schema defaults + `params`. */
export function newComponentNode(
  componentId: string,
  id: string,
  position: XYPosition,
  params: Params = {},
): Node<ComponentNodeData> {
  const component = getComponentById(componentId);
  if (!component) throw new Error(`Unknown component "${componentId}"`);
  const node = componentNodeWithId(component, id, position);
  return {
    ...node,
    data: { ...node.data, params: sanitizeParams(componentId, { ...node.data.params, ...params }) },
  };
}

/**
 * An edge as `onConnect` creates it (label, protocol, async default, connect
 * rule), with `rule` merged over the connect default. `nodes` must include
 * nodes the diff adds.
 */
export function newEdge(
  nodes: readonly Node[],
  edges: readonly Edge[],
  id: string,
  source: string,
  target: string,
  rule: Partial<EdgeRule> = {},
  protocol: CustomEdgeData["protocol"] = "http",
): Edge {
  const graph = ruleGraph(nodes, edges);
  const fallback = connectEdgeRule(source, target, graph, protocol);
  const data: CustomEdgeData = {
    label: "",
    protocol,
    async: defaultEdgeAsync(graph.componentIdOf(source), graph.componentIdOf(target)),
    rule: applyEdgeRulePatch(fallback, rule, fallback),
  };
  return { id, source, target, type: "animated", data };
}

export interface InsertOptions {
  /** Base for the new node's id (made unique against the graph). */
  idBase: string;
  params?: Params;
  /** Rule of the edge into the new node; default: the replaced edge's rule. */
  inRule?: Partial<EdgeRule>;
  /** Rule of the edge out of it; default: the connect default. */
  outRule?: Partial<EdgeRule>;
}

/**
 * Insert a `componentId` node on `edge` (A → B): drop the edge, place the
 * node between A and B (spiraled clear of other nodes), wire A → new → B.
 */
export function insertBetween(
  graph: CanvasGraph,
  edge: Edge,
  componentId: string,
  { idBase, params, inRule, outRule }: InsertOptions,
): GraphDiff {
  const a = graph.nodes.find((n) => n.id === edge.source);
  const b = graph.nodes.find((n) => n.id === edge.target);
  const diff = emptyDiff();
  if (!a || !b) return diff;
  const ca = center(a);
  const cb = center(b);
  const position = freePositionNear({ x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 }, graph.nodes);
  const node = newComponentNode(componentId, uniqueId(idBase, graph), position, params);
  const nodes = [...graph.nodes, node];
  const edges = graph.edges.filter((e) => e.id !== edge.id);
  const { kind, callsPerRequest, fraction } = ruleOf(graph, edge);
  const protocol = ((edge.data ?? {}) as CustomEdgeData).protocol ?? "http";
  const inId = uniqueId(`e-${a.id}-${node.id}`, graph);
  const into = newEdge(
    nodes,
    edges,
    inId,
    a.id,
    node.id,
    inRule ?? { kind, callsPerRequest, fraction },
    protocol,
  );
  const out = newEdge(
    nodes,
    [...edges, into],
    uniqueId(`e-${node.id}-${b.id}`, graph, [inId]),
    node.id,
    b.id,
    outRule,
  );
  diff.addNodes.push(node);
  diff.addEdges.push(into, out);
  diff.removeEdgeIds.push(edge.id);
  return diff;
}

/** Apply a diff: patches validated by the schema / normalized, removals before additions. */
export function applyDiff(graph: CanvasGraph, diff: GraphDiff): CanvasGraph {
  const removed = new Set(diff.removeEdgeIds);
  const nodes = graph.nodes.map((n) => {
    const patch = diff.nodeParams[n.id];
    if (!patch || n.type !== "component") return n;
    const data = n.data as ComponentNodeData;
    return {
      ...n,
      data: {
        ...data,
        params: sanitizeParams(data.componentId, { ...resolvedParams(data), ...patch }),
      },
    };
  });
  const kept = graph.edges.filter((e) => !removed.has(e.id));
  const edges = kept.map((e) => {
    const patch = diff.edgeRules[e.id];
    if (!patch) return e;
    const current = ruleOf(graph, e);
    return { ...e, data: { ...e.data, rule: applyEdgeRulePatch(current, patch, current) } };
  });
  return { nodes: [...nodes, ...diff.addNodes], edges: [...edges, ...diff.addEdges] };
}

/** True when the diff would change nothing. */
export function isEmptyDiff(diff: GraphDiff): boolean {
  return (
    diff.addNodes.length === 0 &&
    diff.addEdges.length === 0 &&
    diff.removeEdgeIds.length === 0 &&
    Object.keys(diff.nodeParams).length === 0 &&
    Object.keys(diff.edgeRules).length === 0
  );
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Short text for a node a diff changes, drawn next to it in the preview ("×1 → ×3"). */
export function describeParamPatch(data: ComponentNodeData, patch: Params): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === PARAM.instances) parts.push(`×${instancesOf(data)} → ×${String(value)}`);
    else if (key === PARAM.limitRps && typeof value === "number")
      parts.push(`limit ${compact.format(value)} rps`);
    else if (key === PARAM.rateLimitEnabled) parts.push(value ? "throttling on" : "throttling off");
    else parts.push(`${key} → ${String(value)}`);
  }
  return parts.join(", ");
}
