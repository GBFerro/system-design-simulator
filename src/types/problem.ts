import type { EdgeRuleV2, Params } from "@/domain/components/types";

export interface ProblemRequirements {
  readsPerSec: number;
  writesPerSec: number;
  storageGB: number;
  latencyMs: number;
  users: string; // e.g. "100M DAU"
  /**
   * The component the latency SLA is about, when it isn't the end-to-end
   * request (e.g. a rate limiter's decision time, a cache read). Scoring then
   * measures that component's hop p99 instead of the end-to-end one.
   */
  slaScope?: string;
  /**
   * Percentile the latency SLA is stated at (Spec 11): `latencyMs` is a p99
   * target unless the statement says otherwise (e.g. "start time < 1 s at p95").
   */
  latencyPercentile?: 50 | 95 | 99;
  /**
   * Availability target of the SLO (Spec 11), e.g. 0.999. Every built-in
   * problem declares one (`data.test.ts`); a custom problem gets 99.9%.
   */
  availability?: number;
  /**
   * Monthly budget in USD for the cost score (Spec 10, CST-05). Built-in
   * problems set it from their reference solution's cost at the peak × 1.3
   * (`data.test.ts` checks it); a custom problem may leave it out.
   */
  budgetMonthlyUsd?: number;
}

export interface ProblemHint {
  title: string;
  content: string;
}

export interface ReferenceSolution {
  /** `params` override the schema defaults (sized so the reference holds its peak, Spec 09). */
  nodes: Array<{ componentId: string; x: number; y: number; params?: Params }>;
  /** `async`/`rule` override the connect defaults (e.g. metrics shipped asynchronously). */
  edges: Array<{ source: string; target: string; async?: boolean; rule?: Partial<EdgeRuleV2> }>;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  description: string;
  requirements: ProblemRequirements;
  constraints: string[];
  hints: ProblemHint[];
  referenceSolution: ReferenceSolution;
  tags: string[];
}
