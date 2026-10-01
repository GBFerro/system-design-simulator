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

export interface DrillSummaryStep {
  label: string;
  mitigated: boolean;
  /** Seconds from the fault to the candidate's first edit. */
  reactionSec?: number;
  /** Share of the step's error budget used (1 = all of it). */
  budgetUsed: number;
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
  };
}
