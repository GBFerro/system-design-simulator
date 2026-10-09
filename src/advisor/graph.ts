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
import type { Params } from "@/domain/components/types";
import {
  applyEdgeRulePatch,
  canvasRuleGraph,
  connectEdgeRule,
  edgeRuleOf,
  newEdgeData,
  type EdgeProtocol,
  type EdgeRulePatch,
} from "@/domain/graph/edgeRules";
import { makeReturnEdge, responseOf } from "@/domain/graph/returns";
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
 * An edge as `onConnect` creates it (`newEdgeData`), with `rule` merged over
 * the connect default. `nodes` must include nodes the diff adds.
 */
export function newEdge(
  nodes: readonly Node[],
  edges: readonly Edge[],
  id: string,
  source: string,
  target: string,
  rule: EdgeRulePatch = {},
  protocol: EdgeProtocol = "http",
): Edge {
  const graph = canvasRuleGraph(nodes, edges);
  const fallback = connectEdgeRule(source, target, graph, protocol);
  const data = newEdgeData(source, target, graph, {
    protocol,
    rule: applyEdgeRulePatch(fallback, rule, fallback),
  });
  return { id, source, target, type: "animated", data };
}

/** Is `edge` a synchronous call in `edges`? It has a response. */
export function isSyncRequest(edges: readonly Edge[], edge: Edge): boolean {
  return responseOf(edges).has(edge.id);
}

/** `edge` followed by its response when the call is synchronous (RET-26). */
export function withResponse(edge: Edge, sync: boolean): Edge[] {
  return sync ? [edge, makeReturnEdge(edge)] : [edge];
}

export interface InsertOptions {
  /** Base for the new node's id (made unique against the graph). */
  idBase: string;
  params?: Params;
  /** Rule of the edge into the new node; default: the replaced edge's rule. */
  inRule?: EdgeRulePatch;
  /** Rule of the edge out of it; default: the connect default. */
  outRule?: EdgeRulePatch;
  /**
   * The edge out of the new node keeps the replaced edge's id, protocol and
   * link (network latency, loss): a fault on that link stays on it. Used when
   * a fix wraps a link a fault is acting on (a circuit breaker on a slow link).
   */
  keepLinkOnOut?: boolean;
}

/**
 * Insert a `componentId` node on `edge` (A → B): drop the edge, place the
 * node between A and B (spiraled clear of other nodes), wire A → new → B.
 */
export function insertBetween(
  graph: CanvasGraph,
  edge: Edge,
  componentId: string,
  { idBase, params, inRule, outRule, keepLinkOnOut }: InsertOptions,
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
  // The halves are synchronous iff the link they replace was (RET-27).
  const sync = isSyncRequest(graph.edges, edge);
  const oldResponse = responseOf(graph.edges).get(edge.id);
  const edges = graph.edges.filter((e) => e.id !== edge.id && e.id !== oldResponse?.id);
  const { calls, networkLatencyMs, packetLoss } = edgeRuleOf(graph, edge);
  const protocol = ((edge.data ?? {}) as CustomEdgeData).protocol ?? "http";
  const inId = uniqueId(`e-${a.id}-${node.id}`, graph);
  const into = newEdge(nodes, edges, inId, a.id, node.id, inRule ?? { calls }, protocol);
  const out = newEdge(
    nodes,
    [...edges, into],
    keepLinkOnOut ? edge.id : uniqueId(`e-${node.id}-${b.id}`, graph, [inId]),
    node.id,
    b.id,
    { ...(keepLinkOnOut ? { networkLatencyMs, packetLoss } : {}), ...outRule },
    keepLinkOnOut ? protocol : "http",
  );
  const half = (e: Edge): Edge[] =>
    withResponse(sync ? e : { ...e, data: { ...e.data, async: true } }, sync);
  diff.addNodes.push(node);
  diff.addEdges.push(...half(into), ...half(out));
  diff.removeEdgeIds.push(edge.id);
  if (oldResponse) diff.removeEdgeIds.push(oldResponse.id);
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
    const current = edgeRuleOf(graph, e);
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
