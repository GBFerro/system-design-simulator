/**
 * Measure the current canvas and score it (Spec 09): the Score button and
 * the end of an interview both go through here. The measuring code and the
 * engine load on demand; the analyses run in the engine worker.
 */
import type { Node } from "@xyflow/react";
import { getProblemById } from "@/data/problems";
import { effectivePeak } from "@/interview/checks";
import { scoreDesign } from "@/scoring/scorer";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useDrillStore } from "@/store/drillStore";
import { useInterviewStore } from "@/store/interviewStore";
import type { Measurements, ScoreResult } from "@/types/scoring";

/** In an interview, the candidate's estimated peak (clamped to ±2× the reference). */
function interviewPeak(problemId: string): number | undefined {
  const { mode, answers } = useInterviewStore.getState();
  const problem = getProblemById(problemId);
  return mode === "interview" && problem ? effectivePeak(answers.estimates, problem) : undefined;
}

/** A finished interview drill for this problem: faults whose SLO held. */
export function finishedDrill(problemId: string): { held: number; total: number } | undefined {
  const d = useDrillStore.getState();
  if (d.status !== "done" || d.problemId !== problemId) return undefined;
  const scored = d.steps.filter((s) => s.result);
  if (scored.length === 0) return undefined;
  return { held: scored.filter((s) => s.result!.mitigated).length, total: scored.length };
}

/**
 * Null when the canvas has no component. If the simulation can't run, the
 * design is still scored (measured checks 0, with the reason) and `measured`
 * is false.
 */
export async function measureAndScore(): Promise<{
  result: ScoreResult;
  measured: boolean;
} | null> {
  const { nodes, edges } = useCanvasStore.getState();
  const components = nodes.filter((n) => n.type !== "text") as Node<ComponentNodeData>[];
  if (components.length === 0) return null;
  const problemId = useAppStore.getState().selectedProblemId;

  let measurements: Measurements | undefined;
  try {
    const [{ measureDesign }, engine] = await Promise.all([
      import("@/scoring/measure"),
      import("@/engine/client"),
    ]);
    measurements =
      (await measureDesign(
        nodes,
        edges,
        problemId,
        { analyze: engine.analyzeGraph, analyzeUnderFault: engine.analyzeGraphUnderFault },
        { drill: finishedDrill(problemId), peakRps: interviewPeak(problemId) },
      )) ?? undefined;
  } catch (err) {
    console.error("Measuring the design failed", err);
    return { result: scoreDesign(components, edges), measured: false };
  }
  return { result: scoreDesign(components, edges, measurements), measured: true };
}
