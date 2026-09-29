/**
 * Failure drill (Spec 09, phase 6): resolve a scripted fault against the
 * candidate's design, and measure how the system and the candidate did.
 * Pure: the UI (`components/interview/drillDriver.ts`) feeds it the compiled
 * canvas, the latest snapshot and the run's history.
 */
import { getComponentById } from "@/data/components";
import {
  GENERIC_DRILL_QA,
  type DrillStep,
  type DrillTarget,
  type ProblemInterviewData,
} from "@/data/interviewData";
import type { SimGraph } from "@/domain/graph/compile";
import { edgeTargets, getFaultType, nodeTargets } from "@/engine/faults/catalog";
import type { FaultSpec } from "@/engine/faults/types";
import type { TickSnapshot } from "@/engine/types";

/** Simulated seconds of fault-free warm-up before the first fault (the baseline). */
export const DRILL_WARMUP_SEC = 15;
/** The drill's SLO until Spec 11 defines real ones: p99 within the problem's SLA, ≤ 1% errors. */
export const DRILL_ERROR_SLO = 0.01;
/** Simulated seconds watched after a fault heals (recovery) before the next one. */
export const DRILL_RECOVERY_SEC = 20;
/** The SLO counts as recovered once it holds this long without breaking again. */
export const DRILL_SUSTAIN_SEC = 3;
/** "Mitigated": the SLO held over the last seconds of the fault window, fault still active. */
export const DRILL_MITIGATED_TAIL_SEC = 5;

export interface DrillSlo {
  p99Ms: number;
  errorRate: number;
}

export interface ResolvedDrillStep {
  spec: FaultSpec;
  question: string;
  answer: string;
  /** Set when the scripted target isn't in the design and a fallback fault is used. */
  note?: string;
}

const FALLBACK: DrillStep["fault"] = {
  type: "kill-instances",
  target: { kind: "busiest" },
  intensity: 1,
};

function busiestBy<T>(items: T[], load: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestLoad = -Infinity;
  for (const x of items) {
    const l = load(x);
    if (l > bestLoad) {
      best = x;
      bestLoad = l;
    }
  }
  return best;
}

/** Target of a fault in this design; undefined when nothing matches. */
function resolveTarget(
  fault: DrillStep["fault"],
  graph: SimGraph,
  snapshot: TickSnapshot | null,
): FaultSpec["target"] | undefined {
  const type = getFaultType(fault.type);
  if (!type) return undefined;
  const target: DrillTarget = fault.target;
  const nodeLoad = (id: string) => snapshot?.nodes[id]?.rpsIn ?? 0;
  if (target.kind === "global") return { kind: "global" };
  if (target.kind === "edge") {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const links = edgeTargets(type, graph).filter(
      (e) =>
        target.from.includes(byId.get(e.source)?.componentId ?? "") &&
        target.to.includes(byId.get(e.target)?.componentId ?? ""),
    );
    const e = busiestBy(links, (x) => snapshot?.edges[x.id]?.rps ?? 0);
    return e ? { kind: "edge", id: e.id } : undefined;
  }
  const eligible = nodeTargets(type, graph).filter((n) =>
    target.kind === "node"
      ? target.componentIds.includes(n.componentId)
      : !graph.entryIds.includes(n.id) && n.routing !== "lb",
  );
  const n = busiestBy(eligible, (x) => nodeLoad(x.id));
  return n ? { kind: "node", id: n.id } : undefined;
}

function describeTarget(target: DrillTarget): string {
  if (target.kind === "node")
    return target.componentIds.map((id) => getComponentById(id)?.label ?? id).join(" / ");
  if (target.kind === "edge") return "that connection";
  return "a matching component";
}

/**
 * The fault this step injects in the candidate's design, with the question
 * and reference answer to show. When the scripted target isn't in the
 * design, an instance of the busiest tier is killed instead (with a note).
 * Null when not even that applies (an empty design).
 */
export function resolveDrillStep(
  step: DrillStep,
  data: Pick<ProblemInterviewData, "followUpQuestions">,
  graph: SimGraph,
  snapshot: TickSnapshot | null,
): ResolvedDrillStep | null {
  const followUp = step.followUpId
    ? data.followUpQuestions.find((q) => q.id === step.followUpId)
    : undefined;
  const qa = followUp ?? GENERIC_DRILL_QA[step.fault.type];

  let fault = step.fault;
  let target = resolveTarget(fault, graph, snapshot);
  let note: string | undefined;
  let question = qa.question;
  let answer = qa.answer;
  if (!target) {
    fault = FALLBACK;
    target = resolveTarget(fault, graph, snapshot);
    if (!target) return null;
    note = `Your design has no ${describeTarget(step.fault.target)} for this fault, so the interviewer kills an instance of your busiest tier instead.`;
    question = GENERIC_DRILL_QA[FALLBACK.type].question;
    answer = GENERIC_DRILL_QA[FALLBACK.type].answer;
  }

  return {
    spec: {
      type: fault.type,
      target,
      ...(fault.intensity !== undefined ? { intensity: fault.intensity } : {}),
      durationSec: step.window,
    },
    question,
    answer,
    ...(note ? { note } : {}),
  };
}

/* ---------- step state machine ---------- */

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

/** What `nextDrillAction` needs to know about the current step. */
export interface DrillStepView {
  phase: DrillStepPhase;
  /** Simulated time to inject at (Infinity until the previous step ends). */
  at: number;
  endT?: number;
}

export type DrillAction =
  | { kind: "wait" }
  | { kind: "inject" }
  /** The fault healed at `endT`: start watching the recovery. */
  | { kind: "healed"; endT: number }
  /** Recovery window over: score the step and move on. */
  | { kind: "evaluate" }
  | { kind: "abort"; reason: string };

/**
 * The drill's next move at simulated time `t`, given the current step and
 * the run's record of its fault (undefined when the chaos store has none).
 * Pure: the driver only performs the action.
 */
export function nextDrillAction(
  step: DrillStepView,
  t: number,
  fault: { active: boolean; endT?: number } | undefined,
): DrillAction {
  switch (step.phase) {
    case "pending":
      return t >= step.at ? { kind: "inject" } : { kind: "wait" };
    case "active":
      if (!fault) return { kind: "abort", reason: "The fault disappeared (the run was reset)." };
      return fault.active ? { kind: "wait" } : { kind: "healed", endT: fault.endT ?? t };
    case "recovering":
      return step.endT !== undefined && t >= step.endT + DRILL_RECOVERY_SEC
        ? { kind: "evaluate" }
        : { kind: "wait" };
    default:
      return { kind: "wait" };
  }
}

/* ---------- evaluation ---------- */

export interface DrillStepResult {
  /** Fault window (simulated seconds). */
  startT: number;
  endT: number;
  /** SLO already broken just before the fault (the design fails without it). */
  brokenBefore: boolean;
  /** First time the SLO broke after the fault started. */
  firstBreachT?: number;
  /** First candidate edit to the design after the fault started. */
  firstActionT?: number;
  /** When the SLO held again (for DRILL_SUSTAIN_SEC) after breaking. */
  recoveredT?: number;
  /** Seconds with the SLO broken, fault window + recovery. */
  badSec: number;
  /** Failed requests over the error budget of the same period (1 = the whole budget). */
  budgetUsed: number;
  /** SLO held over the last DRILL_MITIGATED_TAIL_SEC of the fault window. */
  mitigated: boolean;
  worstP99Ms: number;
  worstErrorRate: number;
}

export function breaches(s: Pick<TickSnapshot, "global">, slo: DrillSlo): boolean {
  return s.global.p99 > slo.p99Ms || s.global.errorRate > slo.errorRate;
}

/**
 * Measure one step from the run's snapshots (oldest → newest): when the SLO
 * broke and recovered, the error budget it burned, and whether the design
 * (with the candidate's edits) held the SLO before the fault ended.
 */
export function evaluateDrillStep(
  history: readonly TickSnapshot[],
  window: { startT: number; endT: number },
  slo: DrillSlo,
  firstActionT?: number,
): DrillStepResult {
  const { startT, endT } = window;
  const evalEnd = endT + DRILL_RECOVERY_SEC;
  const before = history.filter((s) => s.t <= startT && s.t > startT - 2);
  const range = history.filter((s) => s.t > startT && s.t <= evalEnd);

  let firstBreachT: number | undefined;
  let recoveredT: number | undefined;
  let okSince: number | undefined;
  let badSec = 0;
  let failed = 0;
  let total = 0;
  let worstP99Ms = 0;
  let worstErrorRate = 0;
  let prevT = startT;
  for (const s of range) {
    const dt = Math.max(0, s.t - prevT);
    prevT = s.t;
    const bad = breaches(s, slo);
    if (bad) {
      badSec += dt;
      firstBreachT ??= s.t;
      okSince = undefined;
      recoveredT = undefined;
    } else if (firstBreachT !== undefined && recoveredT === undefined) {
      okSince ??= s.t;
      if (s.t - okSince >= DRILL_SUSTAIN_SEC) recoveredT = okSince;
    }
    failed += s.offeredRps * s.global.errorRate * dt;
    total += s.offeredRps * dt;
    worstP99Ms = Math.max(worstP99Ms, s.global.p99);
    worstErrorRate = Math.max(worstErrorRate, s.global.errorRate);
  }
  const tail = range.filter((s) => s.t > endT - DRILL_MITIGATED_TAIL_SEC && s.t <= endT);

  return {
    startT,
    endT,
    brokenBefore: before.length > 0 && before.every((s) => breaches(s, slo)),
    ...(firstBreachT !== undefined ? { firstBreachT } : {}),
    ...(firstActionT !== undefined ? { firstActionT } : {}),
    ...(recoveredT !== undefined ? { recoveredT } : {}),
    badSec,
    budgetUsed: total > 0 ? failed / (slo.errorRate * total) : 0,
    mitigated: tail.length > 0 && tail.every((s) => !breaches(s, slo)),
    worstP99Ms,
    worstErrorRate,
  };
}
