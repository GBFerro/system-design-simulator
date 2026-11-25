/**
 * The 2D drawing of the flow overlay (OBS-04): request balls, response rings and failure bursts, on
 * a context the caller has already transformed to flow coordinates. Kept apart from the
 * `FlowParticles` component so what goes to which style (fill, outline, ring) is unit-tested with a
 * recording context. Where the balls are comes from the caller's `ParticleLayers`.
 */
import type { RuntimeEdgeStatus } from "@/engine/types";
import { EDGE_STATUS_TOKEN, ballPaint, responsePaint } from "@/lib/particles";
import type { ThemeColors } from "@/lib/themeColors";

export const BALL_RADIUS = 4.5;

/** The order request balls are batched and painted in. */
const REQUEST_STATUSES: readonly RuntimeEdgeStatus[] = ["ok", "slow", "error"];

/** Where the particles are, by layer. Each callback hands every ball of the batch to `add`. */
export interface ParticleLayers {
  /** The request balls whose edge has this status. */
  requests(status: RuntimeEdgeStatus, add: (x: number, y: number) => void): void;
  /** The response balls of this outcome (`error`: the call failed). */
  responses(error: boolean, add: (x: number, y: number) => void): void;
  /** The failure bursts, `age` as a fraction (0 to 1) of their life. */
  bursts(add: (x: number, y: number, age: number) => void): void;
}

type Ctx = CanvasRenderingContext2D;

/** Adds a ball to the open path: a circle, entered at its rightmost point. */
function addCircle(ctx: Ctx, x: number, y: number, radius: number) {
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

export function drawParticles(ctx: Ctx, colors: ThemeColors, layers: ParticleLayers): void {
  // Requests, batched by status: a solid ball with a dark outline.
  for (const status of REQUEST_STATUSES) {
    ctx.beginPath();
    let any = false;
    layers.requests(status, (x, y) => {
      addCircle(ctx, x, y, BALL_RADIUS);
      any = true;
    });
    if (!any) continue;
    const paint = ballPaint(status, colors);
    ctx.fillStyle = paint.fill;
    ctx.fill();
    ctx.strokeStyle = paint.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Responses, batched by outcome: a hollow ring walking its own line, callee → caller.
  for (const error of [false, true]) {
    ctx.beginPath();
    let any = false;
    layers.responses(error, (x, y) => {
      addCircle(ctx, x, y, BALL_RADIUS);
      any = true;
    });
    if (!any) continue;
    const paint = responsePaint(error, colors);
    ctx.fillStyle = paint.fill;
    ctx.fill();
    ctx.strokeStyle = paint.ring;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Failed requests: a fading ring where they died (the end of the edge they came in on).
  ctx.strokeStyle = colors[EDGE_STATUS_TOKEN.error];
  ctx.lineWidth = 1.5;
  layers.bursts((x, y, age) => {
    ctx.globalAlpha = 1 - age;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS + 9 * age, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
