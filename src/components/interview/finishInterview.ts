/**
 * End an interview with its report (Spec 09): measure and score the design,
 * grade the phase answers, add the process score and the drill, save the
 * attempt to the history (IndexedDB) and open the report. Loaded on demand
 * from the interview bar.
 */
import { INTERVIEW_DATA } from "@/data/interviewData";
import { getProblemById } from "@/data/problems";
import { buildReport, sloSummary, type DrillSummaryStep } from "@/interview/report";
import { evaluateSlo } from "@/slo/budget";
import { problemSlo } from "@/slo/slo";
import { useRuntimeStore } from "@/store/runtimeStore";
import { scoreDesign } from "@/scoring/scorer";
import { useAppStore } from "@/store/appStore";
import { useDrillStore } from "@/store/drillStore";
import { useInterviewStore } from "@/store/interviewStore";
import { saveAttempt, useReportStore } from "@/store/reportStore";
import { useSimulationStore } from "@/store/simulationStore";
import { measureAndScore } from "./scoreNow";
import { stopDrill } from "./drillDriver";

function drillSummary(problemId: string): DrillSummaryStep[] | undefined {
  const d = useDrillStore.getState();
  if (d.problemId !== problemId) return undefined;
  const steps = d.steps.filter((s) => s.result);
  if (steps.length === 0) return undefined;
  return steps.map((s) => {
    const r = s.result!;
    return {
      label: s.label ?? "Fault",
      mitigated: r.mitigated,
      ...(r.firstActionT !== undefined ? { reactionSec: r.firstActionT - r.startT } : {}),
      budgetUsed: r.budgetUsed,
    };
  });
}

export async function finishInterview(): Promise<void> {
  const interview = useInterviewStore.getState();
  const problemId = useAppStore.getState().selectedProblemId;
  const problem = getProblemById(problemId);
  const data = INTERVIEW_DATA.find((d) => d.problemId === problemId);
  const toast = useAppStore.getState().showToast;
  if (!problem || !data) {
    toast("This problem has no interview script; ending without a report", "info");
    interview.endInterview();
    return;
  }

  // The live run (drill included) against the problem's SLO, before scoring touches anything.
  const slo = problemSlo(problem.requirements);
  const sloResult = sloSummary(evaluateSlo(useRuntimeStore.getState().history.toArray(), slo), slo);

  const scored = await measureAndScore();
  const score = scored?.result ?? scoreDesign([], []);
  if (scored) useSimulationStore.getState().setScoreResult(score);

  const report = buildReport({
    problem,
    data,
    answers: interview.answers,
    phases: interview.phases,
    phaseSeconds: interview.phaseSecondsNow(),
    score,
    measured: scored?.measured ?? false,
    drill: drillSummary(problemId),
    ...(sloResult ? { slo: sloResult } : {}),
    now: new Date(),
  });

  let history = [report];
  try {
    history = await saveAttempt(report);
  } catch (err) {
    console.error("Saving the attempt failed", err);
    toast("Couldn't save this attempt to your history", "error");
  }
  useReportStore.getState().show(report, history);
  stopDrill();
  useInterviewStore.getState().endInterview();
  // What comes after the report is evaluating the design (WIZ-26).
  useAppStore.getState().setStep("evaluate");
}
