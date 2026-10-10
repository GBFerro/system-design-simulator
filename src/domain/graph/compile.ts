import {
  PARAM,
  capacityPerInstanceOf,
  instancesOf,
  routingFor,
  sanitizeParams,
  serviceTimeMsOf,
} from "@/domain/components/registry";
import type { EdgeRule, Params, RoutingKind } from "@/domain/components/types";
import { planFor, type CallPlan } from "./callPlan";
import { defaultEdgeRule, sanitizeEdgeRule } from "./edgeRules";
import { asyncRequestIds, isReturnEdge, responseToOf } from "./returns";

/**
 * Graph compilation (Spec 04, "Compilação do grafo").
 *
 * Turns ReactFlow nodes/edges into a validated, plain-data `SimGraph` the
 * engine (and its worker) consumes. Never throws: every problem becomes a
 * warning. The result is structured-clone safe (no functions, no Maps).
 */

/** Explicit traffic source (Spec 03). When present it is THE entry point. */
export const CLIENT_COMPONENT_ID = "client";

export interface SimNode {
  id: string;
  componentId: string;
  label: string;
  routing: RoutingKind;
  /** Validated against the component schema (unknown keys dropped, invalid → default). */
  params: Params;
  instances: number;
  capacityPerInstance: number;
  serviceTimeMs: number;
  /**
   * Order and conditions of the node's calls (request-flow, `callPlan.ts`):
   * present on every node with a forward (non-back) outgoing edge. The engine
   * reads it and never reinterprets steps (AD-002).
   */
  plan?: CallPlan;
}

export interface SimEdge {
  id: string;
  source: string;
  target: string;
  /** Async edges carry load but are not on the user-facing latency path. */
  async: boolean;
  rule: EdgeRule;
  /**
   * Closes a cycle: the target comes at or before the source in `order`.
   * Back edges carry no flow (the existing Kahn cycle handling: traffic is
   * pushed only to nodes not yet processed).
   */
  back: boolean;
}

export interface SimGraph {
  nodes: SimNode[];
  edges: SimEdge[];
  /** Processing order: Kahn topological order, then cycle members, then nodes downstream of cycles. */
  order: string[];
  /** Nodes that receive the offered load. */
  entryIds: string[];
  /** Nodes on (or feeding back into) a cycle. */
  cycleIds: string[];
  warnings: string[];
}

interface RawNode {
  id?: unknown;
  type?: unknown;
  data?: unknown;
}

interface RawEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  data?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function compileNode(raw: RawNode): SimNode | null {
  if (typeof raw.id !== "string" || raw.id === "" || raw.type === "text") return null;
  const data = asRecord(raw.data);
  const componentId = data.componentId;
  if (typeof componentId !== "string" || componentId === "") return null;

  // Params are validated by the schema (invalid or missing → default); v1
  // top-level fields were converted by the persistence migration.
  const params = sanitizeParams(componentId, data.params);
  const carrier = { componentId, params };
  const instances = instancesOf(carrier);
  const capacityPerInstance = capacityPerInstanceOf(carrier);
  const serviceTimeMs = serviceTimeMsOf(carrier);
  params[PARAM.instances] = instances;
  params[PARAM.capacityPerInstance] = capacityPerInstance;
  params[PARAM.serviceTimeMs] = serviceTimeMs;

  return {
    id: raw.id,
    componentId,
    label: typeof data.label === "string" && data.label.trim() !== "" ? data.label : componentId,
    routing: routingFor(componentId),
    params,
    instances,
    capacityPerInstance,
    serviceTimeMs,
  };
}

function labelList(ids: string[], byId: Map<string, SimNode>, max = 5): string {
  const names = ids.slice(0, max).map((id) => byId.get(id)?.label ?? id);
  return names.join(", ") + (ids.length > max ? ` and ${ids.length - max} more` : "");
}

export function compileGraph(rawNodes: readonly unknown[], rawEdges: readonly unknown[]): SimGraph {
  const warnings: string[] = [];

  /* ---- nodes ---- */
  const nodes: SimNode[] = [];
  const byId = new Map<string, SimNode>();
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    const node = compileNode(asRecord(raw) as RawNode);
    if (!node || byId.has(node.id)) continue;
    nodes.push(node);
    byId.set(node.id, node);
  }

  /* ---- responses are never calls: they leave the graph before the engine sees it ---- */
  const rawList = Array.isArray(rawEdges) ? rawEdges : [];
  // A call is async when nothing answers it (RET-06); the legacy flag still counts.
  const asyncIds = asyncRequestIds(
    rawList.flatMap((raw) => {
      const e = asRecord(raw);
      return typeof e.id === "string" ? [{ id: e.id, data: e.data }] : [];
    }),
  );
  const requestIds = new Set(
    rawList.filter((raw) => !isReturnEdge(asRecord(raw))).map((raw) => asRecord(raw).id),
  );
  const orphans = rawList.filter((raw) => {
    const to = responseToOf(asRecord(raw));
    return to !== undefined && !requestIds.has(to);
  }).length;
  if (orphans > 0) warnings.push(`Ignored ${orphans} response edge(s) without a request.`);

  /* ---- edges: drop dangling/text/self edges, dedupe parallel ones ---- */
  const edges: SimEdge[] = [];
  const byPair = new Map<string, SimEdge>();
  let selfLoops = 0;
  let duplicates = 0;
  for (const rawEdge of rawList) {
    const e = asRecord(rawEdge) as RawEdge;
    if (isReturnEdge(e)) continue;
    if (typeof e.source !== "string" || typeof e.target !== "string") continue;
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    // Edges touching non-component nodes (text annotations, deleted nodes) are ignored.
    if (!source || !target) continue;
    if (source.id === target.id) {
      selfLoops++;
      continue;
    }
    const data = asRecord(e.data);
    const isAsync = typeof e.id === "string" ? asyncIds.has(e.id) : data.async === true;
    const key = `${source.id}->${target.id}`;
    const existing = byPair.get(key);
    if (existing) {
      duplicates++;
      // One sync duplicate keeps the pair on the user-facing path.
      if (!isAsync) existing.async = false;
      continue;
    }
    const fallback = defaultEdgeRule(source.componentId, target.componentId, data.protocol);
    const edge: SimEdge = {
      id: typeof e.id === "string" && e.id !== "" ? e.id : `e-${key}`,
      source: source.id,
      target: target.id,
      async: isAsync,
      rule: sanitizeEdgeRule(data.rule, fallback),
      back: false,
    };
    byPair.set(key, edge);
    edges.push(edge);
  }
  if (selfLoops > 0) warnings.push(`Ignored ${selfLoops} self-loop edge(s).`);
  if (duplicates > 0) warnings.push(`Ignored ${duplicates} duplicate parallel edge(s).`);

  /* ---- adjacency ---- */
  const out = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    out.get(e.source)!.push(e.target);
    inDegree.set(e.target, inDegree.get(e.target)! + 1);
  }

  /* ---- order: Kahn, then cycle handling ---- */
  const order: string[] = [];
  const placed = new Set<string>();
  const remaining = new Map(inDegree);
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    order.push(id);
    placed.add(id);
    for (const child of out.get(id)!) {
      const deg = remaining.get(child)! - 1;
      remaining.set(child, deg);
      if (deg === 0) queue.push(child);
    }
  }

  let cycleIds: string[] = [];
  const unresolved = nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
  if (unresolved.length > 0) {
    // Peel zero-out-degree nodes inside the unresolved subgraph: survivors are
    // on (or feed back into) a cycle; peeled ones are merely downstream of it.
    const unresolvedSet = new Set(unresolved);
    const outDeg = new Map<string, number>();
    const preds = new Map<string, string[]>();
    for (const id of unresolved) {
      outDeg.set(id, 0);
      preds.set(id, []);
    }
    for (const id of unresolved) {
      for (const child of out.get(id)!) {
        if (!unresolvedSet.has(child)) continue;
        outDeg.set(id, outDeg.get(id)! + 1);
        preds.get(child)!.push(id);
      }
    }
    const peel = unresolved.filter((id) => outDeg.get(id) === 0);
    const peeled = new Set<string>();
    for (let head = 0; head < peel.length; head++) {
      const id = peel[head];
      peeled.add(id);
      for (const p of preds.get(id)!) {
        const deg = outDeg.get(p)! - 1;
        outDeg.set(p, deg);
        if (deg === 0) peel.push(p);
      }
    }
    cycleIds = unresolved.filter((id) => !peeled.has(id));
    const downstreamIds = unresolved.filter((id) => peeled.has(id));
    const cycleSet = new Set(cycleIds);

    // Cycle members in traffic-flow order: start from members fed by the
    // acyclic part, walk the cycle breadth-first; unfed members come last.
    const fedFromOutside = (id: string) =>
      edges.some((e) => e.target === id && placed.has(e.source));
    const seeds = [...cycleIds.filter(fedFromOutside), ...cycleIds];
    for (const seed of seeds) {
      if (placed.has(seed)) continue;
      const bfs = [seed];
      placed.add(seed);
      for (let head = 0; head < bfs.length; head++) {
        const id = bfs[head];
        order.push(id);
        for (const child of out.get(id)!) {
          if (cycleSet.has(child) && !placed.has(child)) {
            placed.add(child);
            bfs.push(child);
          }
        }
      }
    }

    // Downstream-of-cycle subgraph is acyclic by construction: Kahn over it.
    const dsSet = new Set(downstreamIds);
    const dsIn = new Map<string, number>();
    for (const id of downstreamIds) dsIn.set(id, 0);
    for (const id of downstreamIds) {
      for (const child of out.get(id)!) {
        if (dsSet.has(child)) dsIn.set(child, dsIn.get(child)! + 1);
      }
    }
    const dsQueue = downstreamIds.filter((id) => dsIn.get(id) === 0);
    for (let head = 0; head < dsQueue.length; head++) {
      const id = dsQueue[head];
      order.push(id);
      placed.add(id);
      for (const child of out.get(id)!) {
        if (!dsSet.has(child)) continue;
        const deg = dsIn.get(child)! - 1;
        dsIn.set(child, deg);
        if (deg === 0) dsQueue.push(child);
      }
    }

    if (cycleIds.length > 0) {
      warnings.push(
        `Cycle detected involving ${labelList(cycleIds, byId)}. Traffic flows once around it; the edge closing the loop carries no load.`,
      );
    }
  }

  const position = new Map(order.map((id, i) => [id, i]));
  for (const e of edges) e.back = position.get(e.target)! <= position.get(e.source)!;

  /* ---- call plans (back edges carry nothing, so they stay out) ---- */
  const forward = new Map<string, SimEdge[]>();
  for (const e of edges) {
    if (e.back) continue;
    const list = forward.get(e.source);
    if (list) list.push(e);
    else forward.set(e.source, [e]);
  }
  const hasHitRate = (id: string) => typeof byId.get(id)?.params[PARAM.hitRate] === "number";
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  for (const node of nodes) {
    const list = forward.get(node.id);
    if (!list) continue;
    node.plan = planFor(
      node.id,
      list.map((e) => ({ id: e.id, target: e.target, async: e.async, calls: e.rule.calls })),
      hasHitRate,
      { routing: node.routing, labelOf },
    );
    warnings.push(...node.plan.warnings);
  }

  /* ---- entry points ---- */
  const clients = nodes.filter((n) => n.componentId === CLIENT_COMPONENT_ID);
  let entryIds: string[];
  if (clients.length > 0) {
    entryIds = clients.map((n) => n.id);
    const idleClients = clients.filter((n) => out.get(n.id)!.length === 0).map((n) => n.id);
    if (idleClients.length > 0) {
      warnings.push(
        `${labelList(idleClients, byId)} has no outgoing edge: its traffic goes nowhere.`,
      );
    }
    const bypassed = nodes
      .filter(
        (n) =>
          n.componentId !== CLIENT_COMPONENT_ID &&
          inDegree.get(n.id) === 0 &&
          out.get(n.id)!.length > 0,
      )
      .map((n) => n.id);
    if (bypassed.length > 0) {
      warnings.push(
        `${labelList(bypassed, byId)} receive no traffic: with a Client on the canvas, only the Client generates load.`,
      );
    }
  } else {
    // In-degree 0 WITH outgoing edges: a fully disconnected node is never an entry.
    entryIds = nodes
      .filter((n) => inDegree.get(n.id) === 0 && out.get(n.id)!.length > 0)
      .map((n) => n.id);
  }

  const disconnected = nodes
    .filter(
      (n) =>
        inDegree.get(n.id) === 0 &&
        out.get(n.id)!.length === 0 &&
        n.componentId !== CLIENT_COMPONENT_ID,
    )
    .map((n) => n.id);
  if (nodes.length > 0 && edges.length === 0) {
    warnings.push("No connections: wire components together so traffic has a path to follow.");
  } else if (disconnected.length > 0) {
    warnings.push(`${labelList(disconnected, byId)} not connected: no traffic reaches it.`);
  }
  if (nodes.length > 0 && edges.length > 0 && entryIds.length === 0) {
    warnings.push(
      "No entry point: every component has an incoming edge. Add a Client or a component with only outgoing edges.",
    );
  }

  return { nodes, edges, order, entryIds, cycleIds, warnings };
}
