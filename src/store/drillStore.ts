import { create } from "zustand";
import type { DrillSlo, DrillStepResult, ResolvedDrillStep } from "@/interview/drill";
import type { FaultId } from "@/engine/faults/types";

/**
 * Failure drill of the interview's phase 6 (Spec 09). NOT persisted: a drill
 * lives inside one simulation run, which a refresh loses anyway. Driven by
 * `components/interview/drillDriver.ts` from the simulated clock.
 */
export type DrillStatus = "idle" | "running" | "done" | "aborted";

export type DrillStepPhase =
  /** Waiting for its inject time. */
  | "pending"
  | "injecting"
  /** Fault active. */
  | "active"
  /** Fault healed; watching the recovery. */
  | "recovering"
  | "done"
  /** Nothing in the design to apply it to. */
  | "skipped";

export interface IncidentPoint {
  t: number;
  p99: number;
  errorRate: number;
}

export interface DrillStepState {
  phase: DrillStepPhase;
  /** Simulated time to inject at (Infinity until the previous step ends). */
  at: number;
  resolved?: ResolvedDrillStep;
  faultId?: FaultId;
  label?: string;
  startT?: number;
  /** Planned end while active; actual end once healed. */
  endT?: number;
  firstActionT?: number;
  result?: DrillStepResult;
  /** The step's p99/error series, kept for the incident chart. */
  incident?: IncidentPoint[];
  /** The candidate's written answer. */
  answerText: string;
}

interface DrillState {
  status: DrillStatus;
  problemId: string | null;
  slo: DrillSlo | null;
  loadRps: number;
  steps: DrillStepState[];
  current: number;
  /** Why the drill stopped early. */
  abortReason?: string;

  begin: (init: {
    problemId: string;
    slo: DrillSlo;
    loadRps: number;
    steps: number;
    firstAt: number;
  }) => void;
  updateStep: (index: number, patch: Partial<DrillStepState>) => void;
  /** Move to the next step (or finish) at simulated time `t`. */
  advance: (t: number) => void;
  setAnswer: (index: number, text: string) => void;
  abort: (reason: string) => void;
  reset: () => void;
}

const initial = {
  status: "idle" as DrillStatus,
  problemId: null,
  slo: null,
  loadRps: 0,
  steps: [] as DrillStepState[],
  current: 0,
  abortReason: undefined,
};

export const useDrillStore = create<DrillState>((set, get) => ({
  ...initial,

  begin: ({ problemId, slo, loadRps, steps, firstAt }) =>
    set({
      ...initial,
      status: "running",
      problemId,
      slo,
      loadRps,
      steps: Array.from({ length: steps }, (_, i) => ({
        phase: "pending",
        at: i === 0 ? firstAt : Infinity,
        answerText: "",
      })),
    }),

  updateStep: (index, patch) =>
    set((s) => ({ steps: s.steps.map((x, i) => (i === index ? { ...x, ...patch } : x)) })),

  advance: (t) => {
    const { current, steps } = get();
    const next = current + 1;
    if (next >= steps.length) {
      set({ status: "done" });
      return;
    }
    set({
      current: next,
      steps: steps.map((x, i) => (i === next ? { ...x, at: t } : x)),
    });
  },

  setAnswer: (index, text) =>
    set((s) => ({ steps: s.steps.map((x, i) => (i === index ? { ...x, answerText: text } : x)) })),

  abort: (reason) => set({ status: "aborted", abortReason: reason }),
  reset: () => set({ ...initial }),
}));
