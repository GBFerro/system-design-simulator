import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { Measurements, ScoreResult, ScoringGraph } from "@/types/scoring";
import { scoreScalability } from "./rules/scalability";
import { scoreAvailability } from "./rules/availability";
import { scoreLatency } from "./rules/latency";
import { scoreCost } from "./rules/cost";
import { scoreTradeoffs } from "./rules/tradeoffs";

function getVerdict(total: number): { verdict: string; verdictColor: string } {
  if (total >= 86) return { verdict: "Architect Level", verdictColor: "text-emerald-400" };
  if (total >= 71) return { verdict: "Excellent", verdictColor: "text-cyan-400" };
  if (total >= 51) return { verdict: "Good", verdictColor: "text-blue-400" };
  if (total >= 31) return { verdict: "Decent", verdictColor: "text-amber-400" };
  return { verdict: "Needs Work", verdictColor: "text-rose-400" };
}

/**
 * Build the connectivity context shared by all scoring rules: a cleaned
 * adjacency map (component nodes only, no self-loops, parallel edges deduped)
 * and the set of nodes reachable from entry points. Presence-based rules use
 * the reachable set so a pile of disconnected components doesn't score points.
 */
export function buildScoringGraph(nodes: Node<ComponentNodeData>[], edges: Edge[]): ScoringGraph {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adjacency.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  const seen = new Set<string>();
  let edgeCount = 0;
  for (const e of edges) {
    // Skip edges touching non-component nodes (text annotations) and self-loops
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target) || e.source === e.target) continue;
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edgeCount++;
    adjacency.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const reachable = new Set<string>();
  if (edgeCount === 0) {
    // No wiring at all: nothing is on a request path — except the trivial
    // single-node canvas, where the lone node is the whole system.
    if (nodes.length === 1) reachable.add(nodes[0].id);
  } else {
    // Entries: in-degree 0 with at least one outgoing edge
    const queue: string[] = [];
    for (const n of nodes) {
      if ((inDegree.get(n.id) ?? 0) === 0 && (adjacency.get(n.id)?.length ?? 0) > 0) {
        queue.push(n.id);
        reachable.add(n.id);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      for (const child of adjacency.get(id) ?? []) {
        if (!reachable.has(child)) {
          reachable.add(child);
          queue.push(child);
        }
      }
    }
  }

  return { adjacency, reachable };
}

/**
 * `m`: the design measured by `measureDesign` (Spec 09). Scalability,
 * availability, latency and part of cost are measured; without it those
 * checks score 0 and say the simulation didn't run.
 */
export function scoreDesign(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  m?: Measurements,
): ScoreResult {
  if (nodes.length === 0) {
    return {
      total: 0,
      categories: [],
      verdict: "Empty Canvas",
      verdictColor: "text-zinc-500",
      summary: "Add components to the canvas to get a score.",
    };
  }

  const graph = buildScoringGraph(nodes, edges);

  const categories = [
    scoreScalability(nodes, edges, graph, m),
    scoreAvailability(nodes, edges, graph, m),
    scoreLatency(nodes, edges, graph, m),
    scoreCost(nodes, edges, graph, m),
    scoreTradeoffs(nodes, edges, graph),
  ];

  // Clamp each category score to [0, maxScore]
  for (const c of categories) {
    c.score = Math.max(0, Math.min(c.score, c.maxScore));
  }

  const rawTotal = categories.reduce((sum, c) => sum + c.score, 0);
  const total = Math.max(0, Math.min(rawTotal, 100));
  const { verdict, verdictColor } = getVerdict(total);

  const totalFeedback = categories.flatMap((c) => c.feedback);
  const summary =
    totalFeedback.length === 0
      ? "Outstanding system design! All criteria met."
      : `${totalFeedback.length} suggestion${totalFeedback.length > 1 ? "s" : ""} for improvement.`;

  return { total, categories, verdict, verdictColor, summary };
}
