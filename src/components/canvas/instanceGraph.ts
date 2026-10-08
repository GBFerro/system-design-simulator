import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import { instancesOf } from "@/domain/components/registry";
import { instanceEdgeId, instanceLanes, instanceNodeId, isInstanceId } from "@/lib/instances";
import type { ComponentNodeData } from "@/store/canvasStore";

/**
 * Expanded nodes as ReactFlow elements (OBS-04): a node with N instances opens
 * into one card per instance (at most MAX, then one stacked card with the
 * rest), stacked down from where the node sits, and each of its edges into one
 * edge per card, so a load balancer's split shows as separate lines. Only what
 * ReactFlow renders changes: `canvasStore` keeps the single node, and the
 * cards' changes map back onto it (`toNodeChanges`/`toEdgeChanges`).
 */

/** Height of an instance card plus the gap to the next, flow px. */
export const INSTANCE_CARD_STEP = 84;

export interface InstanceCardData extends Record<string, unknown> {
  /** The node this card is an instance of. */
  nodeId: string;
  lane: number;
  lanes: number;
  instances: number;
  /** > 0 on the stacked card: how many instances it holds. */
  stacked: number;
  base: ComponentNodeData;
}

export interface InstanceEdgeData extends Record<string, unknown> {
  /** The edge this one is a copy of (its runtime metrics and rule). */
  instanceOf: string;
  /** Share of the edge's load this copy carries. */
  share: number;
  /** Only one copy shows the edge's label. */
  hideLabel: boolean;
}

/** Lanes per expanded component node (instances > 1). */
function expandedLanes(nodes: readonly Node[], expanded: Readonly<Record<string, true>>) {
  const lanes = new Map<string, { lanes: number; stacked: number; instances: number }>();
  for (const n of nodes) {
    if (!expanded[n.id] || n.type !== "component") continue;
    const instances = instancesOf(n.data as ComponentNodeData);
    if (instances <= 1) continue;
    lanes.set(n.id, { ...instanceLanes(instances), instances });
  }
  return lanes;
}

export function withInstances(
  nodes: Node[],
  edges: Edge[],
  expanded: Readonly<Record<string, true>>,
): { nodes: Node[]; edges: Edge[] } {
  const lanes = expandedLanes(nodes, expanded);
  if (lanes.size === 0) return { nodes, edges };

  const outNodes: Node[] = [];
  for (const n of nodes) {
    const l = lanes.get(n.id);
    if (!l) {
      outNodes.push(n);
      continue;
    }
    for (let lane = 0; lane < l.lanes; lane++) {
      const data: InstanceCardData = {
        nodeId: n.id,
        lane,
        lanes: l.lanes,
        instances: l.instances,
        stacked: l.stacked > 0 && lane === l.lanes - 1 ? l.stacked : 0,
        base: n.data as ComponentNodeData,
      };
      outNodes.push({
        id: instanceNodeId(n.id, lane),
        type: "instance",
        position: { x: n.position.x, y: n.position.y + lane * INSTANCE_CARD_STEP },
        selected: n.selected,
        connectable: false,
        deletable: false,
        data,
      });
    }
  }

  const outEdges: Edge[] = [];
  for (const e of edges) {
    const from = lanes.get(e.source);
    const to = lanes.get(e.target);
    if (!from && !to) {
      outEdges.push(e);
      continue;
    }
    const sources = from ? [...Array(from.lanes).keys()] : [-1];
    const targets = to ? [...Array(to.lanes).keys()] : [-1];
    let first = true;
    for (const i of sources) {
      for (const j of targets) {
        // Lanes carry their instances' share (the stacked card holds several).
        const share = laneShare(from, i) * laneShare(to, j);
        const data: InstanceEdgeData = { instanceOf: e.id, share, hideLabel: !first };
        outEdges.push({
          ...e,
          id: instanceEdgeId(e.id, i, j),
          source: i < 0 ? e.source : instanceNodeId(e.source, i),
          target: j < 0 ? e.target : instanceNodeId(e.target, j),
          deletable: false,
          data: { ...e.data, ...data },
        });
        first = false;
      }
    }
  }
  return { nodes: outNodes, edges: outEdges };
}

function laneShare(
  l: { lanes: number; stacked: number; instances: number } | undefined,
  lane: number,
): number {
  if (!l || lane < 0) return 1;
  const held = l.stacked > 0 && lane === l.lanes - 1 ? l.stacked : 1;
  return held / l.instances;
}

/**
 * Card changes mapped onto the node they stand for: selecting a card selects
 * the node, dragging one moves the node (the cards follow); their measured
 * sizes and anything else are dropped.
 */
export function toNodeChanges(changes: NodeChange[], nodes: readonly Node[]): NodeChange[] {
  const out: NodeChange[] = [];
  for (const c of changes) {
    if (!("id" in c) || !isInstanceId(c.id)) {
      out.push(c);
      continue;
    }
    const sep = c.id.lastIndexOf(":");
    const nodeId = c.id.slice("inst:".length, sep);
    const lane = Number(c.id.slice(sep + 1));
    if (c.type === "select") out.push({ ...c, id: nodeId });
    else if (c.type === "position" && c.position) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      out.push({
        ...c,
        id: nodeId,
        position: { x: c.position.x, y: c.position.y - lane * INSTANCE_CARD_STEP },
      });
    }
  }
  // One card dragged = one move; several selected cards of one node must not repeat it.
  return dedupeById(out);
}

/** Edge copies' selection maps onto the edge; other changes to copies are dropped. */
export function toEdgeChanges(changes: EdgeChange[]): EdgeChange[] {
  const out: EdgeChange[] = [];
  for (const c of changes) {
    if (!("id" in c) || !isInstanceId(c.id)) {
      out.push(c);
      continue;
    }
    if (c.type !== "select") continue;
    const rest = c.id.slice("inst:".length);
    const edgeId = rest.slice(0, rest.lastIndexOf(":", rest.lastIndexOf(":") - 1));
    out.push({ ...c, id: edgeId });
  }
  return dedupeById(out);
}

function dedupeById<C extends NodeChange | EdgeChange>(changes: C[]): C[] {
  const seen = new Set<string>();
  const out: C[] = [];
  for (let k = changes.length - 1; k >= 0; k--) {
    const c = changes[k];
    const key = "id" in c ? `${c.type}:${c.id}` : undefined;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.unshift(c);
  }
  return out;
}
