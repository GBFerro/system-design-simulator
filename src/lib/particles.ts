/**
 * Edge styling for the flow overlay (Spec 07, OBS-04); the balls live in
 * `lib/flowBalls.ts`.
 * Pure functions — the canvas layer lives in `components/canvas/FlowParticles`.
 * Colors are theme tokens (`--sf-*`, see `lib/themeColors.ts`): SVG reads them as `var()`, the 2D
 * canvas reads the resolved values of the active theme.
 */
import type { RuntimeEdgeStatus } from "@/engine/types";
import { cssVar, type ThemeColors, type ThemeColorToken } from "@/lib/themeColors";

/** Edge stroke width (flow px) ∝ log of the load; the idle width with no load. */
export function edgeStrokeWidth(rps: number | undefined): number {
  if (rps === undefined || !Number.isFinite(rps) || rps <= 0) return 1.5;
  return Math.min(6, 1.5 + 0.6 * Math.log10(1 + rps));
}

/** Token of the stroke / particle color per edge status (ok = the request color, slow, error = err). */
export const EDGE_STATUS_TOKEN: Record<RuntimeEdgeStatus, ThemeColorToken> = {
  ok: "req",
  slow: "slow",
  error: "err",
};

/** The same colors as `var(--sf-…)` references, for SVG strokes and fills. */
export const EDGE_STATUS_COLOR: Record<RuntimeEdgeStatus, string> = {
  ok: cssVar(EDGE_STATUS_TOKEN.ok),
  slow: cssVar(EDGE_STATUS_TOKEN.slow),
  error: cssVar(EDGE_STATUS_TOKEN.error),
};

/** Ball fill per edge status: the panel on ok so it stands out on the request-colored edge. */
export const BALL_FILL_TOKEN: Record<RuntimeEdgeStatus, ThemeColorToken> = {
  ok: "panel",
  slow: "slow",
  error: "err",
};

/** Outline of a solid ball: ink, like the strokes of the rest of the identity. */
export const BALL_OUTLINE_TOKEN: ThemeColorToken = "ink";

/** Core of a hollow (response) ball: the panel. */
export const BALL_CORE_TOKEN: ThemeColorToken = "panel";

/** Ring color of a response (an ok one; a failed call's is err). */
export const RESPONSE_TOKEN: ThemeColorToken = "resp";

/** The Flow tab's highlight: the request color of the theme. */
export const EDGE_HIGHLIGHT_COLOR = cssVar("req");

/** Fill and outline of a request ball of this status, from the resolved theme colors. */
export function ballPaint(
  status: RuntimeEdgeStatus,
  colors: ThemeColors,
): { fill: string; outline: string } {
  return { fill: colors[BALL_FILL_TOKEN[status]], outline: colors[BALL_OUTLINE_TOKEN] };
}

/** Core and ring of a response ball (`error`: the call failed). */
export function responsePaint(error: boolean, colors: ThemeColors): { fill: string; ring: string } {
  return {
    fill: colors[BALL_CORE_TOKEN],
    ring: colors[error ? EDGE_STATUS_TOKEN.error : RESPONSE_TOKEN],
  };
}
