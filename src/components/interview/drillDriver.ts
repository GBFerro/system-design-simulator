/**
 * Runs the failure drill (Spec 09, phase 6) off the simulated clock: starts a
 * fresh run at the problem's peak, injects each scripted fault at its time
 * (resolved against the candidate's current design), follows it until it
 * heals, watches the recovery, and scores the step. Subscriptions live here,
 * not in a component, so the drill keeps going while panels unmount.
 */
import { INTERVIEW_DATA } from "@/data/interviewData";
import { getProblemById } from "@/data/problems";
import { compileGraph } from "@/domain/graph/compile";
import type { TickSnapshot } from "@/engine/types";
import type { Problem } from "@/types/problem";
import {
  DRILL_ERROR_SLO,
  DRILL_WARMUP_SEC,
  type DrillSlo,
  evaluateDrillStep,
  nextDrillAction,
  resolveDrillStep,
} from "@/interview/drill";
import { useCanvasStore } from "@/store/canvasStore";
import { useChaosStore } from "@/store/chaosStore";
import { useDrillStore, type IncidentPoint } from "@/store/drillStore";
import { useInterviewStore } from "@/store/interviewStore";
import { effectivePeak } from "@/interview/checks";
import { getLatestSnapshot, useRuntimeStore } from "@/store/runtimeStore";
import { problemSlo } from "@/slo/slo";
import {
  injectFault,
  playSimulation,
  resetSimulation,
  setTrafficPattern,
} from "@/components/traffic/simActions";

/** Points kept per incident chart. */
const INCIDENT_POINTS = 120;
/** Seconds before the fault shown on the incident chart. */
const INCIDENT_LEAD_SEC = 10;

let unsubs: (() => void)[] = [];
let busy = false;

function stopWatching(): void {
  for (const u of unsubs) u();
  unsubs = [];
  busy = false;
}

/** The problem's latency SLO (Spec 11), scoped to the matching nodes of the candidate's design. */
function drillSlo(problem: Problem): DrillSlo {
  const { latency } = problemSlo(problem.requirements);
  const scopeNodeIds = latency.scope
    ? useCanvasStore
        .getState()
        .nodes.filter((n) => (n.data as { componentId?: string }).componentId === latency.scope)
        .map((n) => n.id)
    : [];
  return {
    percentile: latency.percentile,
    thresholdMs: latency.thresholdMs,
    scopeNodeIds,
    errorRate: DRILL_ERROR_SLO,
  };
}

/** Start (or restart) the drill for a problem: fresh run, its peak load, first fault after the warm-up. */
export async function startDrill(problemId: string): Promise<void> {
  const problem = getProblemById(problemId);
  const data = INTERVIEW_DATA.find((d) => d.problemId === problemId);
  if (!problem || !data) return;
  stopWatching();
  resetSimulation();
  // The candidate's estimated peak (phase 2), kept within 2× of the reference.
  const loadRps = effectivePeak(useInterviewStore.getState().answers.estimates, problem);
  setTrafficPattern({ kind: "constant", rps: loadRps });
  useDrillStore.getState().begin({
    problemId,
    slo: drillSlo(problem),
    loadRps,
    steps: data.drill.length,
    firstAt: DRILL_WARMUP_SEC,
  });
  await playSimulation();
  if (useRuntimeStore.getState().playback === "idle") {
    useDrillStore.getState().abort("The simulation didn't start (no components on the canvas?).");
    return;
  }

  unsubs.push(
    useRuntimeStore.subscribe((s, prev) => {
      if (s.playback === "idle" && prev.playback !== "idle") {
        stopDrill("The simulation was reset.");
        return;
      }
      if (s.simTimeSec !== prev.simTimeSec) void tick();
    }),
    useInterviewStore.subscribe((s) => {
      if (s.mode !== "interview") stopDrill();
    }),
    // Any design edit (a new undo entry) while a fault is on counts as the candidate acting.
    useCanvasStore.subscribe((s, prev) => {
      if (s.history === prev.history) return;
      const d = useDrillStore.getState();
      const step = d.steps[d.current];
      if (d.status !== "running" || !step) return;
      if (
        (step.phase === "active" || step.phase === "recovering") &&
        step.firstActionT === undefined
      )
        d.updateStep(d.current, { firstActionT: useRuntimeStore.getState().simTimeSec });
    }),
  );
}

/** Stop the drill early (interview ended, simulation reset). */
export function stopDrill(reason?: string): void {
  stopWatching();
  const d = useDrillStore.getState();
  if (d.status === "running") {
    if (reason) d.abort(reason);
    else d.reset();
  }
}

async function tick(): Promise<void> {
  if (busy) return;
  const d = useDrillStore.getState();
  if (d.status !== "running" || !d.problemId || !d.slo) return;
  const i = d.current;
  const step = d.steps[i];
  const t = useRuntimeStore.getState().simTimeSec;
  const fault = step.faultId
    ? useChaosStore.getState().faults.find((f) => f.id === step.faultId)
    : undefined;
  const action = nextDrillAction(step, t, fault);

  if (action.kind === "inject") {
    busy = true;
    try {
      await injectStep(i, d.problemId);
    } finally {
      busy = false;
    }
  } else if (action.kind === "abort") {
    stopDrill(action.reason);
  } else if (action.kind === "healed") {
    d.updateStep(i, { phase: "recovering", endT: action.endT });
  } else if (action.kind === "evaluate" && step.startT !== undefined && step.endT !== undefined) {
    const history = useRuntimeStore.getState().history.toArray();
    const result = evaluateDrillStep(
      history,
      { startT: step.startT, endT: step.endT },
      d.slo,
      step.firstActionT,
    );
    d.updateStep(i, { phase: "done", result, incident: incidentOf(history, step.startT, t) });
    d.advance(t);
    if (useDrillStore.getState().status !== "running") stopWatching();
  }
}

async function injectStep(i: number, problemId: string): Promise<void> {
  const d = useDrillStore.getState();
  const data = INTERVIEW_DATA.find((x) => x.problemId === problemId)!;
  const { nodes, edges } = useCanvasStore.getState();
  const resolved = resolveDrillStep(
    data.drill[i],
    data,
    compileGraph(nodes, edges),
    getLatestSnapshot(),
  );
  const t = useRuntimeStore.getState().simTimeSec;
  if (!resolved) {
    d.updateStep(i, { phase: "skipped" });
    d.advance(t);
    return;
  }
  d.updateStep(i, { phase: "injecting", resolved });
  const id = await injectFault(resolved.spec);
  const rec = id ? useChaosStore.getState().faults.find((f) => f.id === id) : undefined;
  if (useDrillStore.getState().status !== "running") return;
  if (!id || !rec) {
    d.updateStep(i, { phase: "skipped" });
    d.advance(useRuntimeStore.getState().simTimeSec);
    return;
  }
  d.updateStep(i, {
    phase: "active",
    faultId: id,
    label: rec.label,
    startT: rec.startT,
    ...(rec.endT !== undefined ? { endT: rec.endT } : {}),
  });
}

/** p99/error series from just before the fault to now, downsampled for the chart. */
function incidentOf(
  history: readonly TickSnapshot[],
  startT: number,
  endT: number,
): IncidentPoint[] {
  const slice = history.filter((s) => s.t >= startT - INCIDENT_LEAD_SEC && s.t <= endT);
  const stride = Math.max(1, Math.ceil(slice.length / INCIDENT_POINTS));
  const out: IncidentPoint[] = [];
  for (let k = 0; k < slice.length; k += stride) {
    const s = slice[k];
    out.push({ t: s.t, p99: s.global.p99, errorRate: s.global.errorRate });
  }
  return out;
}
