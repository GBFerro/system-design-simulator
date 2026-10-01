/**
 * Measure a design for the Spec 09 rubric: `analyze()` at the problem's peak
 * and at twice it, and in steady state under each of the problem's drill
 * faults (resolved against this design like the drill does). Heavy (drill
 * scripts, reference solutions): load it with `import()` when scoring.
 *
 * The analyses go through `api`, so the UI runs them in the engine worker
 * and tests run them in-thread.
 */
import type { Edge, Node } from "@xyflow/react";
import { INTERVIEW_DATA } from "@/data/interviewData";
import { getProblemById } from "@/data/problems";
import { compileGraph, type SimGraph } from "@/domain/graph/compile";
import type { SteadyUnderFault } from "@/engine/faults/steady";
import type { FaultSpec } from "@/engine/faults/types";
import { steadyStateToSnapshot } from "@/engine/snapshot";
import type { SimConfig, SteadyState } from "@/engine/types";
import { resolveDrillStep } from "@/interview/drill";
import { buildReferenceGraph } from "@/lib/loadReference";
import { isComponentNode } from "@/lib/nodeFactory";
import type { Measurements } from "@/types/scoring";
import { SURGE_FACTOR } from "./budget";
import { syncPath } from "./paths";
import { buildScoringGraph } from "./scorer";

export interface MeasureApi {
  analyze(graph: SimGraph, rps: number, config: SimConfig): Promise<SteadyState> | SteadyState;
  analyzeUnderFault(
    graph: SimGraph,
    rps: number,
    fault: FaultSpec,
    config: SimConfig,
  ): Promise<SteadyUnderFault> | SteadyUnderFault;
}

const components = (nodes: readonly Node[]) => nodes.filter(isComponentNode);

/** Deepest synchronous path of the problem's reference solution (undefined without one). */
export function referenceSyncDepth(problemId: string): number | undefined {
  const problem = getProblemById(problemId);
  if (!problem || problem.referenceSolution.nodes.length === 0) return undefined;
  const { nodes, edges } = buildReferenceGraph(problem);
  return syncPath(nodes, edges, buildScoringGraph(nodes, edges)).depth;
}

export interface MeasureOptions {
  /** A finished interview drill's results; they replace the steady-state faults in availability. */
  drill?: { held: number; total: number };
  /** The load to measure at (an interview's estimated peak); default: the reference peak. */
  peakRps?: number;
}

/** Null when the problem is unknown or the canvas has no component. */
export async function measureDesign(
  nodes: readonly Node[],
  edges: readonly Edge[],
  problemId: string,
  api: MeasureApi,
  { drill, peakRps: override }: MeasureOptions = {},
): Promise<Measurements | null> {
  const problem = getProblemById(problemId);
  if (!problem || components(nodes).length === 0) return null;
  const graph = compileGraph(nodes, edges);
  const { readsPerSec, writesPerSec } = problem.requirements;
  const referencePeak = readsPerSec + writesPerSec;
  const peakRps = override !== undefined && override > 0 ? override : referencePeak;
  // The problem's own read/write mix drives `reads`/`writes` edges.
  const config: SimConfig = referencePeak > 0 ? { readRatio: readsPerSec / referencePeak } : {};
  const [atPeak, atDoublePeak] = await Promise.all([
    api.analyze(graph, peakRps, config),
    api.analyze(graph, SURGE_FACTOR * peakRps, config),
  ]);

  const script = INTERVIEW_DATA.find((d) => d.problemId === problemId);
  const snapshot = steadyStateToSnapshot(atPeak, 0, graph);
  // Steps that fall back to the same fault (the design lacks their targets) count once.
  const seen = new Set<string>();
  const faults = (script?.drill ?? [])
    .map((step) => (script ? resolveDrillStep(step, script, graph, snapshot) : null))
    .filter((r) => r !== null)
    .filter((r) => {
      const key = JSON.stringify(r.spec);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const underFaults: Measurements["underFaults"] = [];
  for (const r of await Promise.all(
    faults.map((f) => api.analyzeUnderFault(graph, peakRps, f.spec, config)),
  )) {
    if (r.ok) underFaults.push({ label: r.label, errorRate: r.steady.errorRate });
  }

  return {
    peakRps,
    sla: {
      p99Ms: problem.requirements.latencyMs,
      ...(problem.requirements.slaScope ? { scope: problem.requirements.slaScope } : {}),
    },
    atPeak,
    atDoublePeak,
    underFaults,
    ...(drill ? { drill } : {}),
    ...(() => {
      const depth = referenceSyncDepth(problemId);
      return depth !== undefined ? { referenceSyncDepth: depth } : {};
    })(),
    ...(() => {
      const budget = problem.requirements.budgetMonthlyUsd;
      if (budget === undefined || !(budget > 0)) return {};
      // A design measured above the reference peak (an interview's estimate) needs more.
      const scale = referencePeak > 0 ? Math.max(1, peakRps / referencePeak) : 1;
      return { budgetMonthlyUsd: budget * scale };
    })(),
  };
}
