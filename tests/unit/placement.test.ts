import type { Node } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasOverlayRects,
  CARD_FIT_MARGIN,
  DEFAULT_NODE_SIZE,
  freePositionNear,
  nodeRect,
  paddingAboveSheet,
  paddingClearOfCards,
  placeAtVisibleCenter,
  STAGE_CARD_SELECTOR,
  TEXT_NODE_SIZE,
  visibleCanvasCenter,
  type Rect,
} from "@/lib/placement";

describe("placement footprint", () => {
  it("DEFAULT_NODE_SIZE is 160 x 120", () => {
    expect(DEFAULT_NODE_SIZE).toEqual({ width: 160, height: 120 });
  });

  it("nodeRect falls back to DEFAULT_NODE_SIZE for an unmeasured node", () => {
    const n = { id: "a", position: { x: 5, y: 7 }, data: {} } as Node;
    expect(nodeRect(n)).toEqual({ x: 5, y: 7, width: 160, height: 120 });
  });

  it("nodeRect uses the note footprint for an unmeasured text node, the measured size when known", () => {
    const note = { id: "t", type: "text", position: { x: 1, y: 2 }, data: {} } as Node;
    expect(nodeRect(note)).toEqual({ x: 1, y: 2, ...TEXT_NODE_SIZE });
    expect(nodeRect({ ...note, measured: { width: 300, height: 90 } })).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 90,
    });
  });

  it("freePositionNear centers a default-size box on the point", () => {
    expect(freePositionNear({ x: 200, y: 200 }, [])).toEqual({ x: 120, y: 140 });
  });
});

const hits = (p: { x: number; y: number }, r: Rect) =>
  p.x < r.x + r.width &&
  r.x < p.x + DEFAULT_NODE_SIZE.width &&
  p.y < r.y + r.height &&
  r.y < p.y + DEFAULT_NODE_SIZE.height;

describe("freePositionNear blocked rects", () => {
  const center = { x: 200, y: 200 };

  it("with no blocked rects the result is today's", () => {
    const nodes = [{ id: "a", position: { x: 120, y: 140 }, data: {} } as Node];
    expect(freePositionNear(center, nodes, undefined, [])).toEqual(freePositionNear(center, nodes));
    expect(freePositionNear(center, [], undefined, [])).toEqual({ x: 120, y: 140 });
  });

  it("a blocked rect covering the center moves the box out of it", () => {
    const blocked: Rect = { x: 150, y: 150, width: 100, height: 100 };
    const p = freePositionNear(center, [], undefined, [blocked]);
    expect(p).not.toEqual({ x: 120, y: 140 });
    expect(hits(p, blocked)).toBe(false);
  });

  it("skips a blocked rect even where no node is", () => {
    // The first spiral cell to the right of the target is blocked too: the walk goes on past it
    const blocked: Rect[] = [
      { x: 150, y: 150, width: 100, height: 100 },
      { x: 300, y: 100, width: 200, height: 300 },
    ];
    const p = freePositionNear(center, [], undefined, blocked);
    for (const r of blocked) expect(hits(p, r)).toBe(false);
  });

  it("keeps a clear gap to the blocked rect (the handles reach past the box)", () => {
    const blocked: Rect = { x: 150, y: 150, width: 100, height: 100 };
    const p = freePositionNear(center, [], undefined, [blocked]);
    const gapX = Math.max(blocked.x - (p.x + 160), p.x - (blocked.x + blocked.width));
    const gapY = Math.max(blocked.y - (p.y + 120), p.y - (blocked.y + blocked.height));
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(24);
  });

  it("does not fall onto an occupied node while avoiding a blocked rect", () => {
    const nodes = [{ id: "a", position: { x: 120, y: 140 }, data: {} } as Node];
    const blocked: Rect = { x: 150, y: 150, width: 100, height: 100 };
    const p = freePositionNear(center, nodes, undefined, [blocked]);
    expect(hits(p, blocked)).toBe(false);
    expect(hits(p, { x: 120, y: 140, width: 160, height: 120 })).toBe(false);
  });
});

const el = (left: number, top: number, width: number, height: number) => ({
  getBoundingClientRect: () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }),
});
/** A stand-in for `document`: elements by selector, and the floating cards (`[data-stage-card]`). */
const fakeRoot = (
  found: Record<string, ReturnType<typeof el>>,
  cards: ReturnType<typeof el>[] = [],
) =>
  ({
    querySelector: (sel: string) => found[sel] ?? null,
    querySelectorAll: (sel: string) => (sel === STAGE_CARD_SELECTOR ? cards : []),
  }) as unknown as ParentNode;

describe("placeAtVisibleCenter", () => {
  afterEach(() => vi.unstubAllGlobals());
  const node = { id: "n", position: { x: 0, y: 0 }, data: {} } as Node;

  it("places at the visible canvas center, blocking the overlays on screen", () => {
    vi.stubGlobal(
      "document",
      fakeRoot({
        ".react-flow": el(100, 50, 800, 600),
        ".react-flow__minimap": el(300, 250, 140, 90),
      }),
    );
    const toFlow = (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 });
    const place = vi.fn();

    placeAtVisibleCenter(place, node, toFlow);

    expect(place).toHaveBeenCalledExactlyOnceWith(node, { x: 250, y: 175 }, [
      { x: 150, y: 125, width: 70, height: 45 },
    ]);
  });

  it("centers on the canvas minus the open cards, and blocks each card (criterion 23)", () => {
    // 1000 x 800 canvas at the origin; top bar 0..60, a left card to x 200, a right card from x 700
    const bar = el(0, 0, 1000, 60);
    const left = el(0, 80, 200, 400);
    const right = el(700, 80, 300, 700);
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 1000, 800) }, [bar, left, right]));
    const toFlow = (p: { x: number; y: number }) => p; // zoom 1, no pan
    const place = vi.fn();

    placeAtVisibleCenter(place, node, toFlow);

    // x: (200 + 700) / 2 = 450; y: (60 + 800) / 2 = 430
    expect(place).toHaveBeenCalledExactlyOnceWith(node, { x: 450, y: 430 }, [
      { x: 0, y: 0, width: 1000, height: 60 },
      { x: 0, y: 80, width: 200, height: 400 },
      { x: 700, y: 80, width: 300, height: 700 },
    ]);
  });

  it("centers above the dock (a bar at the bottom) and blocks it (slice 4)", () => {
    // 1000 x 800 canvas; the dock is a strip at the bottom, as wide as 600 of the 1000
    const dock = el(200, 700, 600, 84);
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 1000, 800) }, [dock]));
    const place = vi.fn();

    placeAtVisibleCenter(place, node, (p) => p);

    // y: (0 + 700) / 2 = 350, x the canvas's own (nothing covers a side)
    expect(place).toHaveBeenCalledExactlyOnceWith(node, { x: 500, y: 350 }, [
      { x: 200, y: 700, width: 600, height: 84 },
    ]);
  });

  it("a closed card (zero size) neither moves the center nor blocks anything", () => {
    vi.stubGlobal(
      "document",
      fakeRoot({ ".react-flow": el(0, 0, 1000, 800) }, [el(0, 0, 0, 0), el(700, 80, 0, 0)]),
    );
    const place = vi.fn();
    placeAtVisibleCenter(place, node, (p) => p);
    expect(place).toHaveBeenCalledExactlyOnceWith(node, { x: 500, y: 400 }, []);
  });

  it("falls back to the canvas center when the cards leave no room", () => {
    vi.stubGlobal(
      "document",
      fakeRoot({ ".react-flow": el(0, 0, 400, 300) }, [el(0, 0, 250, 300), el(150, 0, 250, 300)]),
    );
    const place = vi.fn();
    placeAtVisibleCenter(place, node, (p) => p);
    expect(place.mock.calls[0][1]).toEqual({ x: 200, y: 150 });
  });
});

describe("visibleCanvasCenter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the center of the canvas minus the open cards, converted to flow space", () => {
    vi.stubGlobal(
      "document",
      fakeRoot({ ".react-flow": el(100, 50, 800, 600) }, [el(116, 90, 210, 300)]),
    );
    const toFlow = (p: { x: number; y: number }) => ({ x: p.x - 100, y: p.y - 50 });
    // The card is a left strip ending at x 326: the visible x runs 326..900, centered at 613
    // (flow x 513); nothing covers the top or the bottom, so y stays at 50 + 300 (flow y 300).
    expect(visibleCanvasCenter(toFlow)).toEqual({ x: 513, y: 300 });
  });
});

describe("paddingClearOfCards (criterion 23: fitView keeps nodes out from under the cards)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the fallback ratio when no card is open", () => {
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 1440, 900) }));
    expect(paddingClearOfCards(0.2)).toBe(0.2);
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 1440, 900) }, [el(0, 0, 0, 0)]));
    expect(paddingClearOfCards(0.2)).toBe(0.2);
  });

  it("is the fallback ratio with no canvas (server render)", () => {
    vi.stubGlobal("document", fakeRoot({}, [el(16, 16, 100, 100)]));
    expect(paddingClearOfCards(0.2)).toBe(0.2);
  });

  it("is pixels per side: each side's cards plus the fallback's own margin", () => {
    // 1440 x 900, and a 24 px margin between the nodes and a card
    expect(CARD_FIT_MARGIN).toBe(24);
    vi.stubGlobal(
      "document",
      fakeRoot({ ".react-flow": el(0, 0, 1440, 900) }, [
        el(16, 16, 1408, 51), // top bar: bottom edge at 67
        el(16, 84, 260, 242), // palette: right edge at 276
        el(1084, 84, 340, 800), // panel: left edge at 1084, so 356 from the right
      ]),
    );
    expect(paddingClearOfCards(0.2)).toEqual({
      top: "91px", // 67 + 24
      right: "380px", // 356 + 24
      bottom: "24px",
      left: "300px", // 276 + 24
    });
  });
});

describe("paddingAboveSheet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the strip above the mobile sheet, as before", () => {
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 390, 700) }));
    const from = { closest: () => el(0, 400, 390, 300) } as unknown as Element;
    expect(paddingAboveSheet(from, 0.6)).toEqual({
      top: "10%",
      left: "10%",
      right: "10%",
      bottom: "316px",
    });
  });

  it("with no sheet, frames clear of the floating cards", () => {
    vi.stubGlobal(
      "document",
      fakeRoot({ ".react-flow": el(0, 0, 1000, 800) }, [el(700, 0, 300, 800)]),
    );
    const from = { closest: () => null } as unknown as Element;
    const padding = paddingAboveSheet(from, 0.2) as { right: string };
    expect(padding.right).toBe("324px");
    // and without cards, the fallback
    vi.stubGlobal("document", fakeRoot({ ".react-flow": el(0, 0, 1000, 800) }));
    expect(paddingAboveSheet(from, 0.2)).toBe(0.2);
  });
});

describe("canvasOverlayRects", () => {
  const root = (found: Record<string, ReturnType<typeof el>>, cards?: ReturnType<typeof el>[]) =>
    fakeRoot(found, cards);
  // screen -> flow: shifted by (-100, -50), zoom 2
  const toFlow = (p: { x: number; y: number }) => ({ x: (p.x - 100) / 2, y: (p.y - 50) / 2 });

  it("reports the minimap and the zoom controls in flow coordinates", () => {
    const rects = canvasOverlayRects(
      toFlow,
      root({
        ".react-flow__minimap": el(300, 250, 140, 90),
        ".react-flow__controls": el(120, 450, 30, 100),
      }),
    );
    expect(rects).toEqual([
      { x: 100, y: 100, width: 70, height: 45 },
      { x: 10, y: 200, width: 15, height: 50 },
    ]);
  });

  it("reports every open floating card after the overlays, and skips a closed one", () => {
    const rects = canvasOverlayRects(
      toFlow,
      root({ ".react-flow__controls": el(120, 450, 30, 100) }, [
        el(300, 250, 140, 90),
        el(0, 0, 0, 0), // display: none
      ]),
    );
    expect(rects).toEqual([
      { x: 10, y: 200, width: 15, height: 50 },
      { x: 100, y: 100, width: 70, height: 45 },
    ]);
  });

  it("skips an overlay that is not rendered or is hidden (zero size)", () => {
    expect(canvasOverlayRects(toFlow, root({}))).toEqual([]);
    expect(
      canvasOverlayRects(toFlow, root({ ".react-flow__minimap": el(300, 250, 0, 0) })),
    ).toEqual([]);
  });
});
