/**
 * Edge styling for the flow overlay (Spec 07, OBS-04); the balls live in
 * `lib/flowBalls.ts`.
 * Pure functions — the canvas layer lives in `components/canvas/FlowParticles`.
 */
import type { RuntimeEdgeStatus } from "@/engine/types";

/** Edge stroke width (flow px) ∝ log of the load; the idle width with no load. */
export function edgeStrokeWidth(rps: number | undefined): number {
  if (rps === undefined || !Number.isFinite(rps) || rps <= 0) return 1.5;
  return Math.min(6, 1.5 + 0.6 * Math.log10(1 + rps));
}

/** Stroke / particle color per edge status (ok = cyan, slow = amber, error = rose). */
export const EDGE_STATUS_COLOR: Record<RuntimeEdgeStatus, string> = {
  ok: "#22d3ee",
  slow: "#f59e0b",
  error: "#f43f5e",
};

/** Ball fill per edge status: white on ok so it stands out on the cyan edge. */
export const BALL_COLOR: Record<RuntimeEdgeStatus, string> = {
  ok: "#f8fafc",
  slow: "#fbbf24",
  error: "#fb7185",
};

/** Outline of a solid ball and core of a hollow (async) one: the canvas background. */
export const BALL_OUTLINE = "#09090b";
