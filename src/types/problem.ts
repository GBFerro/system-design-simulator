import type { EdgeRule, Params } from "@/domain/components/types";

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
}

export interface ProblemHint {
  title: string;
  content: string;
}

export interface ReferenceSolution {
  /** `params` override the schema defaults (sized so the reference holds its peak, Spec 09). */
  nodes: Array<{ componentId: string; x: number; y: number; params?: Params }>;
  /** `async`/`rule` override the connect defaults (e.g. metrics shipped asynchronously). */
  edges: Array<{ source: string; target: string; async?: boolean; rule?: Partial<EdgeRule> }>;
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
