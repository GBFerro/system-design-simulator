/**
 * The synchronous request path of a design, on the `ScoringGraph`: which
 * components a user request waits on (from the entries over sync edges, not
 * past a queue), its depth, and the single points of failure on it. Shared
 * by the scoring rules and the advisor's structure hints (Spec 12), so both
 * agree on what "on the request path" and "SPOF" mean.
 */
import type { Edge, Node } from "@xyflow/react";
import { instancesOf, routingFor } from "@/domain/components/registry";
import { MANAGED_MULTI_ZONE } from "@/domain/components/traits";
import { isAsyncEdge } from "@/domain/graph/edgeRules";
import { isReturnEdge } from "@/domain/graph/returns";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { ScoringGraph } from "@/types/scoring";

/** Tiers where "one instance" isn't a single point of failure (`domain/components/traits.ts`). */
export const INHERENTLY_REDUNDANT = MANAGED_MULTI_ZONE;

/** A SQL primary is backed by a read replica that can be promoted. */
const STANDBY_FOR: Record<string, string> = { "sql-db": "read-replica" };

export interface SyncPath {
  /** In-degree 0 with an outgoing edge. */
  entries: string[];
  /** Components a request waits on. */
  onPath: Set<string>;
  /** Longest chain of components on the path (entry included). */
  depth: number;
  /** Direct callers of each node (any edge). */
  parents: Map<string, Set<string>>;
}

export function syncPath(
  nodes: readonly Node<ComponentNodeData>[],
  edges: readonly Edge[],
  graph: ScoringGraph,
): SyncPath {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const targets of graph.adjacency.values())
    for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  const entries = nodes
    .filter((n) => inDegree.get(n.id) === 0 && (graph.adjacency.get(n.id)?.length ?? 0) > 0)
    .map((n) => n.id);

  const syncOut = new Map<string, string[]>();
  const parents = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const e of edges) {
    if (isReturnEdge(e)) continue;
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (!parents.has(e.target)) parents.set(e.target, new Set());
    parents.get(e.target)!.add(e.source);
    const key = `${e.source}->${e.target}`;
    if (seen.has(key) || isAsyncEdge(e)) continue;
    seen.add(key);
    const list = syncOut.get(e.source);
    if (list) list.push(e.target);
    else syncOut.set(e.source, [e.target]);
  }
  const next = (id: string) =>
    routingFor(byId.get(id)!.data.componentId) === "queue" ? [] : (syncOut.get(id) ?? []);

  const onPath = new Set(entries);
  const queue = [...entries];
  for (let head = 0; head < queue.length; head++) {
    for (const n of next(queue[head])) {
      if (onPath.has(n)) continue;
      onPath.add(n);
      queue.push(n);
    }
  }

  // Longest chain; a node already on the current chain closes a cycle and stops it.
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const longest = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    let best = 0;
    for (const n of next(id)) if (!visiting.has(n)) best = Math.max(best, longest(n));
    visiting.delete(id);
    memo.set(id, best + 1);
    return best + 1;
  };
  const depth = entries.reduce((d, id) => Math.max(d, longest(id)), 0);

  return { entries, onPath, depth, parents };
}

/**
 * Stateful single-writer tiers on the request path running one instance
 * with no copy in parallel (same type under a shared caller) and no standby
 * wired to them. Tiers that scale horizontally (catalog `scalable`) and
 * inherently redundant managed services are not SPOFs here — the same
 * notion the availability rule and the advisor use.
 */
export function findSpofs(
  nodes: readonly Node<ComponentNodeData>[],
  path: SyncPath,
  graph: ScoringGraph,
): Node<ComponentNodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linked = (a: string, b: string) =>
    graph.adjacency.get(a)?.includes(b) || graph.adjacency.get(b)?.includes(a);
  const shareCaller = (a: string, b: string) => {
    const pa = path.parents.get(a);
    const pb = path.parents.get(b);
    if (!pa || !pb) return false;
    for (const p of pa) if (pb.has(p)) return true;
    return false;
  };
  const hasBackup = (n: Node<ComponentNodeData>) =>
    nodes.some((m) => {
      if (m.id === n.id) return false;
      const standby = STANDBY_FOR[n.data.componentId] === m.data.componentId;
      const twin = m.data.componentId === n.data.componentId;
      return (
        (twin && shareCaller(n.id, m.id)) ||
        (standby && (linked(n.id, m.id) || shareCaller(n.id, m.id)))
      );
    });

  const out: Node<ComponentNodeData>[] = [];
  for (const id of path.onPath) {
    const n = byId.get(id)!;
    if (n.data.scalable || INHERENTLY_REDUNDANT.has(n.data.componentId)) continue;
    if (instancesOf(n.data) > 1 || hasBackup(n)) continue;
    out.push(n);
  }
  return out;
}
