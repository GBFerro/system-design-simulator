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
import type { ComponentNodeData } from "@/store/canvasStore";
import type { Measurements } from "@/types/scoring";
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

const components = (nodes: readonly Node[]) =>
  nodes.filter((n) => n.type !== "text") as Node<ComponentNodeData>[];

/** Deepest synchronous path of the problem's reference solution (undefined without one). */
export function referenceSyncDepth(problemId: string): number | undefined {
  const problem = getProblemById(problemId);
  if (!problem || problem.referenceSolution.nodes.length === 0) return undefined;
  const { nodes, edges } = buildReferenceGraph(problem);
  return syncPath(nodes, edges, buildScoringGraph(nodes, edges)).depth;
}

/**
 * Null when the problem is unknown or the canvas has no component. `drill`:
 * a finished interview drill's results, which replace the steady-state
 * faults in the availability check.
 */
export async function measureDesign(
  nodes: readonly Node[],
  edges: readonly Edge[],
  problemId: string,
  api: MeasureApi,
  drill?: { held: number; total: number },
): Promise<Measurements | null> {
  const problem = getProblemById(problemId);
  if (!problem || components(nodes).length === 0) return null;
  const graph = compileGraph(nodes, edges);
  const { readsPerSec, writesPerSec } = problem.requirements;
  const peakRps = readsPerSec + writesPerSec;
  // The problem's own read/write mix drives `reads`/`writes` edges.
  const config: SimConfig = peakRps > 0 ? { readRatio: readsPerSec / peakRps } : {};
  const [atPeak, atDoublePeak] = await Promise.all([
    api.analyze(graph, peakRps, config),
    api.analyze(graph, 2 * peakRps, config),
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
  };
}
