import { getViewportForBounds } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { framedViewport, framedViewportNow } from "@/lib/framing";
import { buildReferenceGraph } from "@/lib/loadReference";
import { CARD_FIT_MARGIN, DEFAULT_NODE_SIZE, STAGE_CARD_SELECTOR } from "@/lib/placement";

// Criterion 23 (specs/2026-11-24-redesign-papel-quente.md): after a fit, no node meets a floating
// card. What the browser draws is in tests/e2e/stage.spec.ts; these are the numbers.

const canvas = { left: 0, top: 0, right: 1440, bottom: 900 };
// the stage's cards at 1440 x 900
const topbar = { left: 16, top: 16, right: 1424, bottom: 67 };
const rail = { left: 16, top: 84, right: 226, bottom: 390 };
const palette = { left: 16, top: 402, right: 276, bottom: 644 };
const panel = { left: 1084, top: 84, right: 1424, bottom: 884 };
const cards = [topbar, rail, palette, panel];
const ZOOM = { minZoom: 0.2, maxZoom: 1 };

/** Where a flow-space box lands on screen under a viewport. */
const onScreen = (
  b: { x: number; y: number; width: number; height: number },
  v: { x: number; y: number; zoom: number },
) => ({
  left: b.x * v.zoom + v.x,
  top: b.y * v.zoom + v.y,
  right: (b.x + b.width) * v.zoom + v.x,
  bottom: (b.y + b.height) * v.zoom + v.y,
});
const meets = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("framedViewport", () => {
  it("is the canvas's own fit, with the 20% padding, when no card is over it", () => {
    const bounds = { x: 100, y: 50, width: 800, height: 400 };
    expect(framedViewport(bounds, canvas, [], ZOOM)).toEqual(
      getViewportForBounds(bounds, 1440, 900, 0.2, 1, 0.2),
    );
  });

  it("centers a small design in the part of the canvas the cards leave", () => {
    const bounds = { x: 0, y: 0, width: 160, height: 120 };
    const v = framedViewport(bounds, canvas, cards, ZOOM);
    expect(v.zoom).toBe(1);
    const box = onScreen(bounds, v);
    // the free part: x from the palette's edge (276) to the panel's (1084), y from the top bar (67) down
    expect((box.left + box.right) / 2).toBeCloseTo((276 + 1084) / 2, 5);
    expect((box.top + box.bottom) / 2).toBeCloseTo((67 + 900) / 2, 5);
  });

  it("zooms a wide design down to the free part, keeping the margin from every card", () => {
    // the widest reference is 1792 x 792 flow px
    const bounds = { x: 0, y: 0, width: 1792, height: 792 };
    const v = framedViewport(bounds, canvas, cards, ZOOM);
    const box = onScreen(bounds, v);
    expect(v.zoom).toBeLessThan(0.5); // the 0.5 default floor of the canvas would not fit it
    expect(v.zoom).toBeGreaterThanOrEqual(ZOOM.minZoom);
    expect(box.left).toBeGreaterThanOrEqual(276 + CARD_FIT_MARGIN - 0.001);
    expect(box.right).toBeLessThanOrEqual(1084 - CARD_FIT_MARGIN + 0.001);
    expect(box.top).toBeGreaterThanOrEqual(67 + CARD_FIT_MARGIN - 0.001);
    expect(box.bottom).toBeLessThanOrEqual(900 - CARD_FIT_MARGIN + 0.001);
    for (const card of cards) expect(meets(box, card)).toBe(false);
  });

  it("never zooms in past maxZoom, and never out past minZoom", () => {
    expect(framedViewport({ x: 0, y: 0, width: 10, height: 10 }, canvas, cards, ZOOM).zoom).toBe(1);
    expect(
      framedViewport({ x: 0, y: 0, width: 100000, height: 100 }, canvas, cards, ZOOM).zoom,
    ).toBe(0.2);
  });

  it("follows the cards that are open: a closed panel gives its room back", () => {
    const bounds = { x: 0, y: 0, width: 160, height: 120 };
    const open = onScreen(bounds, framedViewport(bounds, canvas, cards, ZOOM));
    const closed = onScreen(bounds, framedViewport(bounds, canvas, [topbar, rail, palette], ZOOM));
    expect((closed.left + closed.right) / 2).toBeCloseTo((276 + 1440) / 2, 5);
    expect(closed.left).toBeGreaterThan(open.left);
  });

  it("falls back to the canvas's own fit when the cards leave no room", () => {
    const squeezed = [
      { left: 0, top: 0, right: 900, bottom: 900 },
      { left: 600, top: 0, right: 1440, bottom: 900 },
    ];
    const bounds = { x: 0, y: 0, width: 160, height: 120 };
    expect(framedViewport(bounds, canvas, squeezed, ZOOM)).toEqual(
      getViewportForBounds(bounds, 1440, 900, 0.2, 1, 0.2),
    );
  });

  it("frames every reference of the catalog clear of the cards at 1440 x 900", () => {
    for (const problem of PROBLEMS) {
      const { nodes } = buildReferenceGraph(problem);
      const xs = nodes.map((n) => n.position.x);
      const ys = nodes.map((n) => n.position.y);
      const bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + DEFAULT_NODE_SIZE.width,
        height: Math.max(...ys) - Math.min(...ys) + DEFAULT_NODE_SIZE.height,
      };
      const v = framedViewport(bounds, canvas, cards, ZOOM);
      for (const n of nodes) {
        const box = onScreen({ x: n.position.x, y: n.position.y, ...DEFAULT_NODE_SIZE }, v);
        for (const card of cards) {
          expect(meets(box, card), `${problem.id}: ${n.id} under a card`).toBe(false);
        }
      }
    }
  });
});

describe("framedViewportNow", () => {
  afterEach(() => vi.unstubAllGlobals());
  const el = (left: number, top: number, width: number, height: number) => ({
    getBoundingClientRect: () => ({ left, top, width, height }),
  });

  it("reads the canvas and the open cards from the page", () => {
    const flow = el(0, 0, 1440, 900);
    const shown = [el(16, 16, 1408, 51), el(16, 84, 260, 242), el(1084, 84, 340, 800)];
    vi.stubGlobal("document", {
      querySelector: (sel: string) => (sel === ".react-flow" ? flow : null),
      querySelectorAll: (sel: string) => (sel === STAGE_CARD_SELECTOR ? shown : []),
    });
    const bounds = { x: 0, y: 0, width: 160, height: 120 };
    expect(framedViewportNow(bounds, ZOOM)).toEqual(
      framedViewport(bounds, canvas, [topbar, { ...rail, bottom: 326, right: 276 }, panel], ZOOM),
    );
  });

  it("is null with no canvas on screen", () => {
    vi.stubGlobal("document", { querySelector: () => null, querySelectorAll: () => [] });
    expect(framedViewportNow({ x: 0, y: 0, width: 1, height: 1 }, ZOOM)).toBeNull();
  });
});
