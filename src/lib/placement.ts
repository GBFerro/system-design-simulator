import type { FitViewOptions, Node, XYPosition } from "@xyflow/react";
import { cardInsets, type PlainRect } from "@/lib/stageLayout";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends XYPosition, Size {}

/** Fallback footprint for nodes ReactFlow hasn't measured yet. */
export const DEFAULT_NODE_SIZE: Size = { width: 160, height: 120 };
/**
 * What an empty text note measures on the canvas: it is sized by its content (the placeholder
 * line, a 140 x 48 minimum), not like a component card.
 */
export const TEXT_NODE_SIZE: Size = { width: 272, height: 48 };
const GAP = 24;
const MAX_RINGS = 40;

/** Footprint of `node`: measured, else set, else the default for its type. */
export function nodeSize(node: Node): Size {
  const fallback = node.type === "text" ? TEXT_NODE_SIZE : DEFAULT_NODE_SIZE;
  return {
    width: node.measured?.width ?? node.width ?? fallback.width,
    height: node.measured?.height ?? node.height ?? fallback.height,
  };
}

export function nodeRect(node: Node): Rect {
  return { x: node.position.x, y: node.position.y, ...nodeSize(node) };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    b.x < a.x + a.width + GAP &&
    a.y < b.y + b.height + GAP &&
    b.y < a.y + a.height + GAP
  );
}

/**
 * Walk a square spiral outward from `target` (the desired top-left corner)
 * until a `size` box fits without touching any `occupied` rect. Falls back to
 * `target` if nothing is free within MAX_RINGS rings.
 */
export function findFreePosition(target: XYPosition, size: Size, occupied: Rect[]): XYPosition {
  const stepX = size.width + GAP;
  const stepY = size.height + GAP;
  const fits = (p: XYPosition) =>
    !occupied.some((r) => overlaps({ x: p.x, y: p.y, width: size.width, height: size.height }, r));

  if (fits(target)) return target;
  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    // Visit the ring's cells clockwise starting from the top-left corner
    for (let i = -ring; i <= ring; i++) {
      const candidates = [
        { dx: i, dy: -ring },
        { dx: ring, dy: i },
        { dx: -i, dy: ring },
        { dx: -ring, dy: -i },
      ];
      for (const { dx, dy } of candidates) {
        const p = { x: target.x + dx * stepX, y: target.y + dy * stepY };
        if (fits(p)) return p;
      }
    }
  }
  return target;
}

/**
 * Top-left position that centers a `size` box on `center`, spiraled clear of `nodes`
 * and of `blocked` (flow-space rects a node must not sit under, e.g. floating overlays).
 * A blocked rect is kept at the same GAP as a node, so a handle at the box's edge stays reachable.
 */
export function freePositionNear(
  center: XYPosition,
  nodes: Node[],
  size: Size = DEFAULT_NODE_SIZE,
  blocked: readonly Rect[] = [],
): XYPosition {
  return findFreePosition({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, size, [
    ...nodes.map(nodeRect),
    ...blocked,
  ]);
}

/** The overlays of the canvas itself that a new node must not land under. */
const CANVAS_OVERLAY_SELECTORS = [".react-flow__minimap", ".react-flow__controls"] as const;
/** The floating cards of the stage layout (`StageCard`): the canvas runs under them. */
export const STAGE_CARD_SELECTOR = "[data-stage-card]";

type ScreenBox = Pick<DOMRect, "left" | "top" | "width" | "height">;

const hasSize = (box: ScreenBox) => box.width > 0 && box.height > 0;
/** A screen box as the left/top/right/bottom rect `stageLayout` works with. */
export const toPlain = (box: ScreenBox): PlainRect => ({
  left: box.left,
  top: box.top,
  right: box.left + box.width,
  bottom: box.top + box.height,
});

/** Screen boxes of the floating cards that are showing (a closed card is `display: none`: no size). */
export function openCards(root: ParentNode = document): PlainRect[] {
  return [...root.querySelectorAll(STAGE_CARD_SELECTOR)]
    .map((el) => el.getBoundingClientRect())
    .filter(hasSize)
    .map(toPlain);
}

/**
 * Flow-space rects of what is laid over the canvas on screen now (the minimap, the zoom controls,
 * the floating cards), for `placeNode`. One that is not rendered or is hidden (zero size) is left
 * out. The store stays DOM-free: this runs in the UI and the rects travel as plain data.
 */
export function canvasOverlayRects(
  screenToFlowPosition: (p: XYPosition) => XYPosition,
  root: ParentNode = document,
): Rect[] {
  const boxes: ScreenBox[] = [];
  for (const selector of CANVAS_OVERLAY_SELECTORS) {
    const box = root.querySelector(selector)?.getBoundingClientRect();
    if (box) boxes.push(box);
  }
  for (const card of root.querySelectorAll(STAGE_CARD_SELECTOR)) {
    boxes.push(card.getBoundingClientRect());
  }
  return boxes.filter(hasSize).map((box) => {
    const a = screenToFlowPosition({ x: box.left, y: box.top });
    const b = screenToFlowPosition({ x: box.left + box.width, y: box.top + box.height });
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  });
}

/**
 * Flow-space center of the part of the canvas in view: the canvas minus the floating cards open
 * over it (the window center is offset by them). With no room left it is the canvas center.
 */
export function visibleCanvasCenter(
  screenToFlowPosition: (p: XYPosition) => XYPosition,
): XYPosition {
  const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
  if (!rect) {
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }
  const canvas = toPlain(rect);
  const inset = cardInsets(canvas, openCards(document));
  const left = canvas.left + inset.left;
  const right = canvas.right - inset.right;
  const top = canvas.top + inset.top;
  const bottom = canvas.bottom - inset.bottom;
  const roomy = left < right && top < bottom;
  return screenToFlowPosition({
    x: roomy ? (left + right) / 2 : (canvas.left + canvas.right) / 2,
    y: roomy ? (top + bottom) / 2 : (canvas.top + canvas.bottom) / 2,
  });
}

/**
 * Tap-add: put `node` at the visible canvas center, clear of the other nodes and of the canvas
 * overlays. Every add-by-click path (palette, command palette, top bar) goes through this, so
 * the overlay rects are read in this one place.
 */
export function placeAtVisibleCenter(
  placeNode: (node: Node, center: XYPosition, blocked?: readonly Rect[]) => void,
  node: Node,
  screenToFlowPosition: (p: XYPosition) => XYPosition,
): void {
  placeNode(
    node,
    visibleCanvasCenter(screenToFlowPosition),
    canvasOverlayRects(screenToFlowPosition),
  );
}

/** Marks the mobile right panel: a bottom sheet laid over the lower part of the canvas. */
export const BOTTOM_SHEET_ATTR = "data-bottom-sheet";

/** Room kept between framed nodes and a floating card: the halo, the handles and the ×N button overflow the box. */
export const CARD_FIT_MARGIN = 24;

/**
 * `fitView` padding that keeps the framed nodes out from under the floating cards: pixels per side,
 * the cards' inset on that side plus `CARD_FIT_MARGIN`. With no card open, or no canvas to measure,
 * `fallback` (a ratio, as `fitView` reads a number). Read when the fit runs.
 */
export function paddingClearOfCards(fallback: number): NonNullable<FitViewOptions["padding"]> {
  if (typeof document === "undefined") return fallback;
  const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
  const cards = rect ? openCards(document) : [];
  if (!rect || cards.length === 0) return fallback;
  const inset = cardInsets(toPlain(rect), cards);
  const px = (n: number): `${number}px` => `${n + CARD_FIT_MARGIN}px`;
  return {
    top: px(inset.top),
    right: px(inset.right),
    bottom: px(inset.bottom),
    left: px(inset.left),
  };
}

/**
 * `fitView` padding for framing nodes from inside a panel: when `from` sits
 * in the mobile bottom sheet (`[data-bottom-sheet]`), the canvas strip above
 * the sheet; otherwise clear of the floating cards (`paddingClearOfCards`), or
 * `fallback` when none is open. Every panel that frames nodes goes through
 * this, or on a phone it frames them under the sheet and on a desktop under
 * the cards.
 */
export function paddingAboveSheet(
  from: Element | null | undefined,
  fallback: number,
): NonNullable<FitViewOptions["padding"]> {
  const sheet = from?.closest(`[${BOTTOM_SHEET_ATTR}]`)?.getBoundingClientRect();
  const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
  const covered = sheet && canvas ? Math.max(0, canvas.bottom - sheet.top) : 0;
  return covered > 0
    ? { top: "10%", left: "10%", right: "10%", bottom: `${Math.round(covered) + 16}px` }
    : paddingClearOfCards(fallback);
}
