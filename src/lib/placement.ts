import type { FitViewOptions, Node, XYPosition } from "@xyflow/react";

export interface Size {
  width: number;
  height: number;
}

interface Rect extends XYPosition, Size {}

/** Fallback footprint for nodes ReactFlow hasn't measured yet. */
export const DEFAULT_NODE_SIZE: Size = { width: 160, height: 72 };
const GAP = 24;
const MAX_RINGS = 40;

export function nodeRect(node: Node): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? DEFAULT_NODE_SIZE.width,
    height: node.measured?.height ?? node.height ?? DEFAULT_NODE_SIZE.height,
  };
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

/** Top-left position that centers a `size` box on `center`, spiraled clear of `nodes`. */
export function freePositionNear(
  center: XYPosition,
  nodes: Node[],
  size: Size = DEFAULT_NODE_SIZE,
): XYPosition {
  return findFreePosition(
    { x: center.x - size.width / 2, y: center.y - size.height / 2 },
    size,
    nodes.map(nodeRect),
  );
}

/** Flow-space center of the visible canvas (the window center is offset by the sidebars). */
export function visibleCanvasCenter(
  screenToFlowPosition: (p: XYPosition) => XYPosition,
): XYPosition {
  const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
  return screenToFlowPosition({
    x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
  });
}

/** Marks the mobile right panel: a bottom sheet laid over the lower part of the canvas. */
export const BOTTOM_SHEET_ATTR = "data-bottom-sheet";

/**
 * `fitView` padding for framing nodes from inside a panel: when `from` sits
 * in the mobile bottom sheet (`[data-bottom-sheet]`), the canvas strip above
 * the sheet; otherwise `fallback`. Every panel that frames nodes goes through
 * this, or on a phone it frames them under the sheet.
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
    : fallback;
}
