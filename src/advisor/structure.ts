/**
 * Structure hints (Spec 12, ADV-03): no entry point, disconnected nodes and
 * single points of failure. Computed on the scorer's `ScoringGraph` (same
 * cleaned adjacency and reachable set), without the engine, so they agree
 * with the Score tab and cost O(nodes + edges).
 */
import type { Edge, Node } from "@xyflow/react";
import { instancesOf, routingFor } from "@/domain/components/registry";
import { buildScoringGraph } from "@/scoring/scorer";
import type { ComponentNodeData } from "@/store/canvasStore";
import { SEVERITY_RANK, type Finding } from "./types";

/**
 * Tiers where "one instance" isn't a single point of failure: the traffic
 * source itself, and managed services redundant by construction (DNS is
 * anycast over several name servers, a CDN serves from many edge locations,
 * object storage replicates across availability zones).
 */
const INHERENTLY_REDUNDANT = new Set(["client", "dns", "cdn", "object-storage"]);

/** A SQL primary is backed by a read replica that can be promoted. */
const STANDBY_FOR: Record<string, string> = { "sql-db": "read-replica" };

function isComponent(n: Node): n is Node<ComponentNodeData> {
  return (
    n.type !== "text" && typeof (n.data as { componentId?: unknown })?.componentId === "string"
  );
}

export function structureFindings(nodes: readonly Node[], edges: readonly Edge[]): Finding[] {
  const comps = nodes.filter(isComponent);
  if (comps.length === 0) return [];
  const byId = new Map(comps.map((n) => [n.id, n]));
  const label = (id: string) => byId.get(id)?.data.label ?? id;
  const graph = buildScoringGraph(comps, edges as Edge[]);
  const findings: Finding[] = [];

  const inDegree = new Map<string, number>(comps.map((n) => [n.id, 0]));
  for (const targets of graph.adjacency.values())
    for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  const entries = comps.filter(
    (n) => inDegree.get(n.id) === 0 && (graph.adjacency.get(n.id)?.length ?? 0) > 0,
  );

  if (entries.length === 0) {
    findings.push({
      id: "no-entry",
      severity: "critical",
      title: "No entry point",
      detail:
        "Nothing receives traffic: an entry point is a component with no incoming connections that calls the rest (usually a Client, DNS or load balancer). Connect one to your components — a design made only of cycles has none.",
      targetIds: comps.map((n) => n.id),
      source: "structure",
    });
    return findings;
  }

  for (const n of comps) {
    if (graph.reachable.has(n.id)) continue;
    findings.push({
      id: `disconnected:${n.id}`,
      severity: "warning",
      title: `${n.data.label} is disconnected`,
      detail:
        "No entry point reaches it, so it gets no traffic, adds no capacity and earns no score. Wire it into the request path or remove it.",
      targetIds: [n.id],
      source: "structure",
    });
  }

  // Sync request path: from the entries over sync edges, not past a queue
  // (consumers are decoupled from the user's request).
  const syncOut = new Map<string, string[]>();
  const parents = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (!parents.has(e.target)) parents.set(e.target, new Set());
    parents.get(e.target)!.add(e.source);
    const key = `${e.source}->${e.target}`;
    if (seen.has(key) || (e.data as { async?: unknown } | undefined)?.async === true) continue;
    seen.add(key);
    const list = syncOut.get(e.source);
    if (list) list.push(e.target);
    else syncOut.set(e.source, [e.target]);
  }
  const onPath = new Set(entries.map((n) => n.id));
  const queue = [...onPath];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (routingFor(byId.get(id)!.data.componentId) === "queue") continue;
    for (const next of syncOut.get(id) ?? []) {
      if (onPath.has(next)) continue;
      onPath.add(next);
      queue.push(next);
    }
  }

  const linked = (a: string, b: string) =>
    graph.adjacency.get(a)?.includes(b) || graph.adjacency.get(b)?.includes(a);
  const shareCaller = (a: string, b: string) => {
    const pa = parents.get(a);
    const pb = parents.get(b);
    if (!pa || !pb) return false;
    for (const p of pa) if (pb.has(p)) return true;
    return false;
  };
  /** Another copy in parallel (same type under a shared caller) or a standby wired to it. */
  const hasBackup = (n: Node<ComponentNodeData>) =>
    comps.some((m) => {
      if (m.id === n.id) return false;
      const standby = STANDBY_FOR[n.data.componentId] === m.data.componentId;
      const twin = m.data.componentId === n.data.componentId;
      return (
        (twin && shareCaller(n.id, m.id)) ||
        (standby && (linked(n.id, m.id) || shareCaller(n.id, m.id)))
      );
    });

  // Same notion of redundancy as the scorer: tiers that scale horizontally
  // (catalog `scalable`) are not flagged; stateful single-writer tiers
  // (SQL database, distributed lock) are, while they run one instance.
  for (const id of onPath) {
    const n = byId.get(id)!;
    if (n.data.scalable || INHERENTLY_REDUNDANT.has(n.data.componentId)) continue;
    if (instancesOf(n.data) > 1 || hasBackup(n)) continue;
    findings.push({
      id: `spof:${n.id}`,
      severity: "warning",
      title: `${label(n.id)} is a single point of failure`,
      detail:
        "It's on the request path with one instance and no replica: if it fails, every request that needs it fails. Add instances (a standby to fail over to) or a replica in parallel.",
      targetIds: [n.id],
      source: "structure",
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
