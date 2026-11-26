import { describe, expect, it } from "vitest";
import {
  cardInsets,
  stageCssVars,
  stageInsets,
  STAGE_TABS_HEIGHT,
  PALETTE_BOTTOM,
  PALETTE_WIDTH,
  PANEL_WIDTH_NARROW,
  PANEL_WIDTH_WIDE,
  pointOverCanvas,
  RAIL_ICON_WIDTH,
  RAIL_WIDTH,
  STAGE_SIDE,
  STAGE_TOP,
  stageMetrics,
} from "@/lib/stageLayout";

// Papel quente slice 3 (specs/2026-11-24-redesign-papel-quente.md, criteria 18, 19, 22): the
// numbers the stage cards are laid out with. What the browser draws from them is in
// tests/e2e/stage.spec.ts.

describe("the geometry at 1440x900 (criterion 18)", () => {
  it("keeps the mockup's numbers", () => {
    expect(STAGE_SIDE).toBe(16);
    expect(STAGE_TOP).toBe(84);
    expect(RAIL_WIDTH).toBe(210);
    expect(PANEL_WIDTH_WIDE).toBe(340);
  });

  it("the wide stage has the full rail, the 340 px panel and the top bar 16 px from the edges", () => {
    const m = stageMetrics({ medium: true, wide: true }, null);
    expect(m.railCollapsed).toBe(false);
    expect(m.railWidth).toBe(210);
    expect(m.panelWidth).toBe(340);
    expect(m.topbarInset).toBe(16);
    expect(m.side).toBe(16);
    expect(m.top).toBe(84);
  });
});

describe("below 1280 px (criterion 19)", () => {
  it("starts with the rail collapsed to an icon column of at most 56 px and a 300 px panel", () => {
    const m = stageMetrics({ medium: true, wide: false }, null);
    expect(m.railCollapsed).toBe(true);
    expect(m.railWidth).toBe(RAIL_ICON_WIDTH);
    expect(m.railWidth).toBeLessThanOrEqual(56);
    expect(m.panelWidth).toBe(PANEL_WIDTH_NARROW);
    expect(PANEL_WIDTH_NARROW).toBe(300);
  });

  it("lets the user expand the rail, to the full width", () => {
    const m = stageMetrics({ medium: true, wide: false }, false);
    expect(m.railCollapsed).toBe(false);
    expect(m.railWidth).toBe(RAIL_WIDTH);
  });

  it("lets the user collapse the rail on a wide screen", () => {
    const m = stageMetrics({ medium: true, wide: true }, true);
    expect(m.railCollapsed).toBe(true);
    expect(m.railWidth).toBe(RAIL_ICON_WIDTH);
    // the panel width follows the screen, not the rail
    expect(m.panelWidth).toBe(PANEL_WIDTH_WIDE);
  });

  it("tightens the top bar's inset under 1024 px, so the smoke spec's selector keeps its room", () => {
    expect(stageMetrics({ medium: false, wide: false }, null).topbarInset).toBe(8);
    expect(stageMetrics({ medium: true, wide: false }, null).topbarInset).toBe(16);
  });
});

describe("pointOverCanvas: a palette drop under a floating card is not a drop on the canvas", () => {
  const canvas = { left: 0, top: 0, right: 1000, bottom: 800 };
  const panel = { left: 700, top: 84, right: 984, bottom: 784 };
  const rail = { left: 16, top: 84, right: 226, bottom: 300 };

  it("accepts a point on the canvas that no card covers", () => {
    expect(pointOverCanvas({ x: 400, y: 400 }, canvas, [panel, rail])).toBe(true);
    expect(pointOverCanvas({ x: 400, y: 400 }, canvas, [])).toBe(true);
  });

  it("refuses a point under any of the cards", () => {
    expect(pointOverCanvas({ x: 800, y: 400 }, canvas, [panel, rail])).toBe(false);
    expect(pointOverCanvas({ x: 100, y: 100 }, canvas, [panel, rail])).toBe(false);
  });

  it("refuses a point outside the canvas, and any point when there is no canvas", () => {
    expect(pointOverCanvas({ x: 1200, y: 400 }, canvas, [])).toBe(false);
    expect(pointOverCanvas({ x: 400, y: 900 }, canvas, [])).toBe(false);
    expect(pointOverCanvas({ x: 400, y: 400 }, undefined, [])).toBe(false);
  });
});

describe("cardInsets: how much of the canvas's edges the floating cards cover (criteria 21, 23)", () => {
  // 1440 x 900, the stage's cards: top bar, rail, palette under it, panel
  const canvas = { left: 0, top: 0, right: 1440, bottom: 900 };
  const topbar = { left: 16, top: 16, right: 1424, bottom: 67 };
  const rail = { left: 16, top: 84, right: 226, bottom: 390 };
  const palette = { left: 16, top: 402, right: 276, bottom: 644 };
  const panel = { left: 1084, top: 84, right: 1424, bottom: 884 };

  it("is zero with no card", () => {
    expect(cardInsets(canvas, [])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("puts the top bar on the top edge, the rail and the palette on the left, the panel on the right", () => {
    expect(cardInsets(canvas, [topbar])).toEqual({ top: 67, right: 0, bottom: 0, left: 0 });
    expect(cardInsets(canvas, [rail])).toEqual({ top: 0, right: 0, bottom: 0, left: 226 });
    expect(cardInsets(canvas, [palette])).toEqual({ top: 0, right: 0, bottom: 0, left: 276 });
    expect(cardInsets(canvas, [panel])).toEqual({ top: 0, right: 356, bottom: 0, left: 0 });
  });

  it("takes the widest card of each side, from the canvas's own edge", () => {
    expect(cardInsets(canvas, [topbar, rail, palette, panel])).toEqual({
      top: 67,
      right: 356,
      bottom: 0,
      left: 276,
    });
    // a canvas that does not start at the window's origin (the interview bar is above it)
    const lower = { left: 0, top: 40, right: 1440, bottom: 940 };
    const moved = { ...topbar, top: 56, bottom: 107 };
    expect(cardInsets(lower, [moved]).top).toBe(67);
  });

  it("puts a wide card on the bottom edge when it is nearest to it (the dock of a later slice)", () => {
    const strip = { left: 200, top: 820, right: 1240, bottom: 884 };
    expect(cardInsets(canvas, [strip])).toEqual({ top: 0, right: 0, bottom: 80, left: 0 });
  });

  it("counts a card equally near two edges for the first of left, right, top, bottom", () => {
    const corner = { left: 16, top: 16, right: 126, bottom: 126 };
    expect(cardInsets(canvas, [corner])).toEqual({ top: 0, right: 0, bottom: 0, left: 126 });
    const lowerRight = { left: 1314, top: 774, right: 1424, bottom: 884 };
    expect(cardInsets(canvas, [lowerRight])).toEqual({ top: 0, right: 126, bottom: 0, left: 0 });
  });

  it("ignores a closed card (no size) and one outside the canvas", () => {
    const closed = { left: 0, top: 0, right: 0, bottom: 0 };
    const away = { left: 2000, top: 100, right: 2200, bottom: 300 };
    expect(cardInsets(canvas, [closed, away])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("stageInsets: what the stage's overlays keep clear of (criterion 23)", () => {
  const wide = stageMetrics({ medium: true, wide: true }, null);

  it("is the top bar, the rail and the panel at 1440 px", () => {
    expect(stageInsets(wide, { palette: false, panel: true })).toEqual({
      top: 84,
      left: 16 + 210,
      right: 16 + 340,
    });
  });

  it("an open palette widens the left side to its own width", () => {
    expect(stageInsets(wide, { palette: true, panel: true }).left).toBe(16 + 260);
  });

  it("a closed panel frees the right side", () => {
    expect(stageInsets(wide, { palette: false, panel: false }).right).toBe(0);
  });

  it("a collapsed rail is narrower than the palette, so the palette decides when it is open", () => {
    const narrow = stageMetrics({ medium: true, wide: false }, null);
    expect(stageInsets(narrow, { palette: false, panel: true }).left).toBe(16 + 56);
    expect(stageInsets(narrow, { palette: true, panel: true }).left).toBe(16 + 260);
    expect(stageInsets(narrow, { palette: true, panel: true }).right).toBe(16 + 300);
  });
});

describe("stageCssVars", () => {
  it("names the free area's insets and the tab bar's height for the canvas's overlays", () => {
    const insets = { top: 84, left: 226, right: 356 };
    expect(stageCssVars(insets, false)).toEqual({
      "--stage-inset-top": "84px",
      "--stage-inset-left": "226px",
      "--stage-inset-right": "356px",
      "--stage-tabs": "0px",
    });
    expect(stageCssVars(insets, true)["--stage-tabs"]).toBe(`${STAGE_TABS_HEIGHT}px`);
    expect(STAGE_TABS_HEIGHT).toBe(40);
  });
});

describe("the palette card", () => {
  it("sits left of the canvas and ends above the minimap's bottom-left zone", () => {
    expect(PALETTE_WIDTH).toBeGreaterThanOrEqual(240);
    expect(PALETTE_WIDTH).toBeLessThanOrEqual(300);
    // controls (to ~120 px), the minimap stacked above them (bottom 150 + 90 high)
    expect(PALETTE_BOTTOM).toBeGreaterThanOrEqual(250);
    expect(stageMetrics({ medium: true, wide: true }, null).paletteBottom).toBe(PALETTE_BOTTOM);
    expect(stageMetrics({ medium: true, wide: true }, null).paletteWidth).toBe(PALETTE_WIDTH);
  });
});
