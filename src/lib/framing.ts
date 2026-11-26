import { getViewportForBounds, type Viewport } from "@xyflow/react";
import { CARD_FIT_MARGIN, openCards, toPlain, type Rect } from "@/lib/placement";
import { cardInsets, type PlainRect } from "@/lib/stageLayout";

/**
 * Framing the canvas's view in the part the stage's floating cards leave (Papel quente slice 3).
 * React Flow's `fitView` centers on the whole canvas and shifts only as far as its padding demands,
 * which leaves a small design off the center of what the cards leave and, with the cards open on
 * both sides, off by their difference. The canvas frames itself with these instead.
 */

/**
 * The viewport that frames `bounds` (flow space) centered in the part of `canvas` the `cards`
 * leave: zoomed to fit within `minZoom`..`maxZoom`, `CARD_FIT_MARGIN` px from every edge of that
 * part. With no card over the canvas, or no room left, it is the canvas's own fit with the 20%
 * padding the canvas always had.
 */
export function framedViewport(
  bounds: Rect,
  canvas: PlainRect,
  cards: readonly PlainRect[],
  zoom: { minZoom: number; maxZoom: number },
): Viewport {
  const inset = cardInsets(canvas, cards);
  const width = canvas.right - canvas.left - inset.left - inset.right;
  const height = canvas.bottom - canvas.top - inset.top - inset.bottom;
  const covered = inset.top + inset.right + inset.bottom + inset.left > 0;
  const margins = 2 * CARD_FIT_MARGIN;
  if (!covered || width <= margins || height <= margins) {
    return getViewportForBounds(
      bounds,
      canvas.right - canvas.left,
      canvas.bottom - canvas.top,
      zoom.minZoom,
      zoom.maxZoom,
      0.2,
    );
  }
  // Fit inside the free part as if it were the whole canvas, then move it to where it is
  const view = getViewportForBounds(
    bounds,
    width,
    height,
    zoom.minZoom,
    zoom.maxZoom,
    `${CARD_FIT_MARGIN}px`,
  );
  return { x: view.x + inset.left, y: view.y + inset.top, zoom: view.zoom };
}

/** `framedViewport` for the canvas and the cards on screen now; null when no canvas is on screen. */
export function framedViewportNow(
  bounds: Rect,
  zoom: { minZoom: number; maxZoom: number },
): Viewport | null {
  const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
  return rect ? framedViewport(bounds, toPlain(rect), openCards(document), zoom) : null;
}
