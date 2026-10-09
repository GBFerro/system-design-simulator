/**
 * The steps of the guided layout (guided-ui, WIZ-*), pure: which tools a step
 * shows. Free mode walks Problem → Design → Simulate → Failures → Evaluate;
 * an interview walks its six phases (phases 1–4 fill the screen, 5–6 show the
 * canvas). Changing step only changes what is visible: it never edits the
 * graph or touches a live run (AD-004).
 */

/** The tabs of the right panel. */
export type RightTab =
  | "properties"
  | "simulation"
  | "flow"
  | "chaos"
  | "slo"
  | "score"
  | "advisor"
  | "cost"
  | "capacity"
  | "tradeoffs";

export const STEPS = ["problem", "design", "simulate", "failures", "evaluate"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  problem: "Problem",
  design: "Design",
  simulate: "Simulate",
  failures: "Failures",
  evaluate: "Evaluate",
};

/**
 * The right panel's tabs per step, first = the one that opens. Props is in every
 * step with a canvas because adjusting a node happens at any step. Problem has no
 * canvas: its tools (problem, requirements, Capacity, Learning Path) fill the screen.
 */
export const TOOLS_BY_STEP: Record<Step, readonly RightTab[]> = {
  problem: [],
  design: ["properties", "flow"],
  simulate: ["simulation", "flow", "properties"],
  failures: ["chaos", "slo", "properties"],
  evaluate: ["score", "advisor", "cost", "tradeoffs", "properties"],
};

/** What the Problem screen holds instead of the right panel. */
export const PROBLEM_SCREEN_TOOLS: readonly RightTab[] = ["capacity"];

export const canvasVisible = (step: Step): boolean => step !== "problem";
/** The palette is the Design step's tool; elsewhere the canvas stays editable by other means. */
export const paletteVisible = (step: Step): boolean => step === "design";

export function sanitizeStep(value: unknown): Step {
  return (STEPS as readonly unknown[]).includes(value) ? (value as Step) : "problem";
}

export const stepIndex = (step: Step): number => STEPS.indexOf(step);

/** Interview phases (0-based): 1–4 are full-screen forms, 5 is High-Level Design, 6 the Deep Dive. */
export const INTERVIEW_FORM_PHASES = 4;
export const INTERVIEW_DESIGN_PHASE = 4;
export const INTERVIEW_DEEP_DIVE_PHASE = 5;

export const interviewCanvasVisible = (phase: number): boolean => phase >= INTERVIEW_DESIGN_PHASE;
export const interviewPaletteVisible = (phase: number): boolean => phase === INTERVIEW_DESIGN_PHASE;

/** The tools of the interview's canvas phases: High-Level Design shows Design + Simulate's, the Deep Dive the drill panel (no tabs). */
export function interviewTools(phase: number): readonly RightTab[] {
  if (phase !== INTERVIEW_DESIGN_PHASE) return [];
  return [...new Set([...TOOLS_BY_STEP.design, ...TOOLS_BY_STEP.simulate])];
}
