import type { Node } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasOverlayRects,
  DEFAULT_NODE_SIZE,
  freePositionNear,
  nodeRect,
  placeAtVisibleCenter,
  TEXT_NODE_SIZE,
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

describe("placeAtVisibleCenter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("places at the visible canvas center, blocking the overlays on screen", () => {
    const box = (left: number, top: number, width: number, height: number) => ({
      getBoundingClientRect: () => ({ left, top, width, height }),
    });
    const found: Record<string, ReturnType<typeof box>> = {
      ".react-flow": box(100, 50, 800, 600),
      ".react-flow__minimap": box(300, 250, 140, 90),
    };
    vi.stubGlobal("document", { querySelector: (sel: string) => found[sel] ?? null });
    const toFlow = (p: { x: number; y: number }) => ({ x: p.x / 2, y: p.y / 2 });
    const place = vi.fn();
    const node = { id: "n", position: { x: 0, y: 0 }, data: {} } as Node;

    placeAtVisibleCenter(place, node, toFlow);

    expect(place).toHaveBeenCalledExactlyOnceWith(node, { x: 250, y: 175 }, [
      { x: 150, y: 125, width: 70, height: 45 },
    ]);
  });
});

describe("canvasOverlayRects", () => {
  const el = (left: number, top: number, width: number, height: number) => ({
    getBoundingClientRect: () => ({ left, top, width, height }),
  });
  const root = (found: Record<string, ReturnType<typeof el>>) =>
    ({ querySelector: (sel: string) => found[sel] ?? null }) as unknown as ParentNode;
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

  it("skips an overlay that is not rendered or is hidden (zero size)", () => {
    expect(canvasOverlayRects(toFlow, root({}))).toEqual([]);
    expect(
      canvasOverlayRects(toFlow, root({ ".react-flow__minimap": el(300, 250, 0, 0) })),
    ).toEqual([]);
  });
});
