import { describe, expect, it } from "vitest";
import { BALL_RADIUS, drawParticles, type ParticleLayers } from "@/lib/drawParticles";
import { readThemeColors } from "@/lib/themeColors";

// Every token reads back as its own name, so a recorded style says which token chose it.
const NAMES = readThemeColors((n) => n.replace("--sf-", ""));

type Op =
  | { op: "beginPath" }
  | { op: "moveTo"; x: number; y: number }
  | { op: "arc"; x: number; y: number; r: number; from: number; to: number }
  | { op: "fill"; fillStyle: string }
  | {
      op: "stroke";
      strokeStyle: string;
      lineWidth: number;
      globalAlpha: number;
    };

/** A 2D context that records what is drawn and the style in force at each fill / stroke. */
function recorder() {
  const ops: Op[] = [];
  const ctx = {
    fillStyle: "unset",
    strokeStyle: "unset",
    lineWidth: -1,
    globalAlpha: 1,
    beginPath: () => ops.push({ op: "beginPath" }),
    moveTo: (x: number, y: number) => ops.push({ op: "moveTo", x, y }),
    arc: (x: number, y: number, r: number, from: number, to: number) =>
      ops.push({ op: "arc", x, y, r, from, to }),
    fill: () => ops.push({ op: "fill", fillStyle: String(ctx.fillStyle) }),
    stroke: () =>
      ops.push({
        op: "stroke",
        strokeStyle: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha,
      }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, ops };
}

const none: ParticleLayers = { requests: () => {}, responses: () => {}, bursts: () => {} };

/** The fills and strokes, in drawing order. */
const painted = (ops: Op[]) =>
  ops.filter(
    (o): o is Extract<Op, { op: "fill" | "stroke" }> => o.op === "fill" || o.op === "stroke",
  );

describe("drawParticles: request balls", () => {
  it("paints each status batch with its fill and the ink outline, ok first", () => {
    const { ctx, ops } = recorder();
    drawParticles(ctx, NAMES, {
      ...none,
      requests: (status, add) => add(status === "ok" ? 10 : status === "slow" ? 20 : 30, 5),
    });
    expect(painted(ops)).toEqual([
      { op: "fill", fillStyle: "panel" },
      { op: "stroke", strokeStyle: "ink", lineWidth: 1.5, globalAlpha: 1 },
      { op: "fill", fillStyle: "slow" },
      { op: "stroke", strokeStyle: "ink", lineWidth: 1.5, globalAlpha: 1 },
      { op: "fill", fillStyle: "err" },
      { op: "stroke", strokeStyle: "ink", lineWidth: 1.5, globalAlpha: 1 },
    ]);
  });

  it("draws a ball as a moveTo to its rightmost point then a full circle, and skips an empty batch", () => {
    const { ctx, ops } = recorder();
    drawParticles(ctx, NAMES, {
      ...none,
      requests: (status, add) => {
        if (status === "slow") add(7, 9);
      },
    });
    expect(ops).toEqual([
      { op: "beginPath" },
      { op: "beginPath" },
      { op: "moveTo", x: 7 + BALL_RADIUS, y: 9 },
      { op: "arc", x: 7, y: 9, r: BALL_RADIUS, from: 0, to: Math.PI * 2 },
      { op: "fill", fillStyle: "slow" },
      { op: "stroke", strokeStyle: "ink", lineWidth: 1.5, globalAlpha: 1 },
      // the error batch, then the two (empty) response batches
      { op: "beginPath" },
      { op: "beginPath" },
      { op: "beginPath" },
    ]);
  });
});

describe("drawParticles: responses", () => {
  it("rings an ok response in resp and a failed one in err, both with a panel core", () => {
    const { ctx, ops } = recorder();
    drawParticles(ctx, NAMES, {
      ...none,
      responses: (error, add) => add(error ? 2 : 1, 0),
    });
    expect(painted(ops)).toEqual([
      { op: "fill", fillStyle: "panel" },
      { op: "stroke", strokeStyle: "resp", lineWidth: 2, globalAlpha: 1 },
      { op: "fill", fillStyle: "panel" },
      { op: "stroke", strokeStyle: "err", lineWidth: 2, globalAlpha: 1 },
    ]);
  });

  it("draws only the outcome that has responses", () => {
    const { ctx, ops } = recorder();
    drawParticles(ctx, NAMES, {
      ...none,
      responses: (error, add) => {
        if (error) add(1, 1);
      },
    });
    expect(painted(ops)).toEqual([
      { op: "fill", fillStyle: "panel" },
      { op: "stroke", strokeStyle: "err", lineWidth: 2, globalAlpha: 1 },
    ]);
  });
});

describe("drawParticles: bursts and order", () => {
  it("strokes a fading err ring that grows with its age, and restores the alpha", () => {
    const { ctx, raw, ops } = recorder();
    drawParticles(ctx, NAMES, {
      ...none,
      bursts: (add) => {
        add(3, 4, 0.25);
        add(5, 6, 1);
      },
    });
    expect(ops.filter((o) => o.op === "arc")).toEqual([
      { op: "arc", x: 3, y: 4, r: BALL_RADIUS + 9 * 0.25, from: 0, to: Math.PI * 2 },
      { op: "arc", x: 5, y: 6, r: BALL_RADIUS + 9, from: 0, to: Math.PI * 2 },
    ]);
    expect(painted(ops)).toEqual([
      { op: "stroke", strokeStyle: "err", lineWidth: 1.5, globalAlpha: 0.75 },
      { op: "stroke", strokeStyle: "err", lineWidth: 1.5, globalAlpha: 0 },
    ]);
    expect(raw.globalAlpha).toBe(1);
  });

  it("draws requests, then responses, then bursts", () => {
    const { ctx, ops } = recorder();
    drawParticles(ctx, NAMES, {
      requests: (status, add) => {
        if (status === "ok") add(0, 0);
      },
      responses: (error, add) => {
        if (!error) add(0, 0);
      },
      bursts: (add) => add(0, 0, 0),
    });
    expect(painted(ops).map((o) => (o.op === "stroke" ? o.strokeStyle : o.fillStyle))).toEqual([
      "panel",
      "ink",
      "panel",
      "resp",
      "err",
    ]);
  });
});
