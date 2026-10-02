/**
 * The final interview report (Spec 09): the measured design score, the
 * process score, time per phase, the phase answers against the reference and
 * the drill. Pure and JSON-safe: it's also what the attempt history stores.
 */
import type { ProblemInterviewData } from "@/data/interviewData";
import type { Problem } from "@/types/problem";
import type { ScoreResult } from "@/types/scoring";
import {
  checkApis,
  checkDataModel,
  checkEstimates,
  checkRequirements,
  processScore,
  type ApiCheck,
  type EstimateCheck,
  type ProcessItem,
  type RequirementsCheck,
} from "./checks";
import type { InterviewAnswers } from "@/store/interviewStore";
import type { SloEvaluation } from "@/slo/budget";
import { formatAvailability, formatWindow } from "@/slo/slo";
import type { Sli, Slo } from "@/slo/types";

export interface DrillSummaryStep {
  label: string;
  mitigated: boolean;
  /** Seconds from the fault to the candidate's first edit. */
  reactionSec?: number;
  /** Share of the step's error budget used (1 = all of it). */
  budgetUsed: number;
}

/** The problem's SLO over the interview's live run (Spec 11, SLO-02). */
export interface SloSummary {
  /** "p99 ≤ 100 ms · 99.99% availability · 5-minute window". */
  target: string;
  verdict: "met" | "violated";
  /** Simulated time the first error budget ran out, and which. */
  breachT?: number;
  breachSli?: Sli;
  /** Budget used over the window at the end of the run (1 = all of it). */
  budgetUsed: number;
  worstBurn: number;
  /** Simulated seconds the run covered. */
  runSec: number;
}

/** The report's SLO block; undefined when nothing ran live (no traffic over time). */
export function sloSummary(ev: SloEvaluation, slo: Slo): SloSummary | undefined {
  if (!ev.hasData) return undefined;
  const ms = slo.latency.thresholdMs;
  return {
    target: `p${slo.latency.percentile} ≤ ${ms < 10 ? ms : Math.round(ms)} ms · ${formatAvailability(slo.availability)} availability · ${formatWindow(slo.windowSec)} window`,
    verdict: ev.verdict,
    ...(ev.breach ? { breachT: ev.breach.t, breachSli: ev.breach.sli } : {}),
    budgetUsed: ev.budgetUsed,
    worstBurn: ev.worstBurn,
    runSec: ev.t,
  };
}

export interface InterviewReport {
  id: string;
  problemId: string;
  problemTitle: string;
  /** ISO date. */
  finishedAt: string;
  durationSec: number;
  score: Pick<ScoreResult, "total" | "verdict" | "categories">;
  /** Whether the design could be simulated (measured checks count). */
  measured: boolean;
  process: { total: number; items: ProcessItem[] };
  phases: { name: string; seconds: number; targetSeconds: number }[];
  requirements: RequirementsCheck;
  estimates: EstimateCheck[];
  apis: Pick<ApiCheck, "coverage"> & {
    matched: string[];
    wrongVerb: string[];
    missed: string[];
  };
  dataModel: {
    score: number;
    entities: {
      name: string;
      found: boolean;
      storeOk: boolean;
      partitionOk: boolean;
      store: string;
      /** The candidate's store, when they named the entity. */
      yourStore?: string;
      partitionKey?: string;
    }[];
  };
  drill?: DrillSummaryStep[];
  slo?: SloSummary;
}

export interface ReportInput {
  problem: Pick<Problem, "id" | "title" | "requirements">;
  data: Pick<ProblemInterviewData, "requirements" | "referenceAPIs" | "dataModel">;
  answers: InterviewAnswers;
  phases: { name: string; targetMinutes: number }[];
  phaseSeconds: readonly number[];
  score: ScoreResult;
  measured: boolean;
  drill?: DrillSummaryStep[];
  slo?: SloSummary;
  now: Date;
}

const endpoint = (a: { method: string; path: string }) => `${a.method} ${a.path}`;

export function buildReport(input: ReportInput): InterviewReport {
  const { problem, data, answers } = input;
  const requirements = checkRequirements(answers.requirements, data);
  const estimates = checkEstimates(answers.estimates, problem);
  const apis = checkApis(answers.apis, data.referenceAPIs);
  const model = checkDataModel(answers.entities, data.dataModel);
  const process = processScore({
    phaseSeconds: input.phaseSeconds,
    targetMinutes: input.phases.map((p) => p.targetMinutes),
    estimates,
    requirements,
    ...(input.drill ? { drillReactions: input.drill.map((s) => s.reactionSec) } : {}),
  });

  return {
    id: `${problem.id}-${input.now.getTime()}`,
    problemId: problem.id,
    problemTitle: problem.title,
    finishedAt: input.now.toISOString(),
    durationSec: input.phaseSeconds.reduce((a, b) => a + b, 0),
    score: {
      total: input.score.total,
      verdict: input.score.verdict,
      categories: input.score.categories,
    },
    measured: input.measured,
    process,
    phases: input.phases.map((p, i) => ({
      name: p.name,
      seconds: input.phaseSeconds[i] ?? 0,
      targetSeconds: p.targetMinutes * 60,
    })),
    requirements,
    estimates,
    apis: {
      coverage: apis.coverage,
      matched: apis.matched.map(endpoint),
      wrongVerb: apis.wrongVerb.map((w) => `${endpoint(w.reference)} (you: ${w.yours})`),
      missed: apis.missed.map(endpoint),
    },
    dataModel: {
      score: model.score,
      entities: model.entities.map((e) => ({
        name: e.reference.name,
        found: e.yours !== undefined,
        storeOk: e.storeOk,
        partitionOk: e.partitionOk,
        store: e.reference.type,
        ...(e.yours ? { yourStore: e.yours.store } : {}),
        ...(e.reference.partitionKey ? { partitionKey: e.reference.partitionKey } : {}),
      })),
    },
    ...(input.drill ? { drill: input.drill } : {}),
    ...(input.slo ? { slo: input.slo } : {}),
  };
}
