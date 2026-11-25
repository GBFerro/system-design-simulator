import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BALL_FILL_TOKEN,
  BALL_OUTLINE_TOKEN,
  EDGE_HIGHLIGHT_COLOR,
  EDGE_STATUS_COLOR,
  EDGE_STATUS_TOKEN,
  RESPONSE_TOKEN,
  ballPaint,
  edgeStrokeWidth,
  responsePaint,
} from "@/lib/particles";
import { THEME_COLOR_TOKENS, readThemeColors } from "@/lib/themeColors";

// Every token reads back as its own name, so a paint value says which token chose it.
const NAMES = readThemeColors((n) => n.replace("--sf-", ""));

describe("ballPaint and responsePaint pin the exact token of each part", () => {
  it("request balls: ok is a panel fill, slow and error fill with their color, all inked outline", () => {
    expect(ballPaint("ok", NAMES)).toEqual({ fill: "panel", outline: "ink" });
    expect(ballPaint("slow", NAMES)).toEqual({ fill: "slow", outline: "ink" });
    expect(ballPaint("error", NAMES)).toEqual({ fill: "err", outline: "ink" });
  });

  it("response rings: a panel core, ringed in resp, or in err when the call failed", () => {
    expect(responsePaint(false, NAMES)).toEqual({ fill: "panel", ring: "resp" });
    expect(responsePaint(true, NAMES)).toEqual({ fill: "panel", ring: "err" });
  });
});

describe("EDGE_HIGHLIGHT_COLOR", () => {
  it("is the request color of the theme", () => {
    expect(EDGE_HIGHLIGHT_COLOR).toBe("var(--sf-req)");
  });
});

// Papel quente slice 1, criterion 6: the edge and ball colors are tokens, not literals.

const css = readFileSync(
  fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)),
  "utf8",
);
const STATUSES = ["ok", "slow", "error"] as const;

describe("edge and ball colors", () => {
  it("every edge status color is a var() of a token that globals.css defines", () => {
    for (const status of STATUSES) {
      const m = EDGE_STATUS_COLOR[status].match(/^var\((--sf-[\w-]+)\)$/);
      expect(m, status).not.toBeNull();
      expect(css, m![1]).toContain(`${m![1]}:`);
    }
  });

  it("the SVG color and the canvas token of a status name the same token", () => {
    for (const status of STATUSES) {
      expect(EDGE_STATUS_COLOR[status]).toBe(`var(--sf-${EDGE_STATUS_TOKEN[status]})`);
    }
  });

  it("ok is the request color, slow is slow, error is err", () => {
    expect(EDGE_STATUS_TOKEN).toEqual({ ok: "req", slow: "slow", error: "err" });
  });

  it("the ball tokens are theme colors the canvas can read", () => {
    const known: readonly string[] = THEME_COLOR_TOKENS;
    for (const status of STATUSES) expect(known).toContain(BALL_FILL_TOKEN[status]);
    expect(known).toContain(BALL_OUTLINE_TOKEN);
    expect(known).toContain(RESPONSE_TOKEN);
  });
});

describe("edgeStrokeWidth", () => {
  it("is the idle width with no load and grows with the load up to the cap", () => {
    expect(edgeStrokeWidth(undefined)).toBe(1.5);
    expect(edgeStrokeWidth(0)).toBe(1.5);
    expect(edgeStrokeWidth(1000)).toBeGreaterThan(edgeStrokeWidth(10));
    expect(edgeStrokeWidth(1e12)).toBe(6);
  });
});
