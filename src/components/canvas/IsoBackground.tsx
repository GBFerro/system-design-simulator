"use client";

import { useStore } from "@xyflow/react";

/**
 * The canvas background of the isometric look (specs/2026-11-24-redesign-papel-quente.md, slice 2):
 * two families of lines at 30° and 150°, 26 px apart vertically, in `--grid-line`. Decorative
 * only: it pans and zooms with the viewport like React Flow's own `<Background>`, but nodes still
 * snap to the 16 px grid of `<ReactFlow snapGrid>`, which this pattern does not follow.
 */

/** The vertical distance between two parallel lines of a family. */
export const ISO_GRID_GAP = 26;

/** The tile's width: a line rising `ISO_GRID_GAP` over it is at 30° (tan 30° = 1/√3). */
const TILE_W = ISO_GRID_GAP * Math.sqrt(3);

export function IsoBackground({ id = "iso-grid" }: { id?: string }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const w = TILE_W * zoom;
  const h = ISO_GRID_GAP * zoom;
  const patternId = `${id}-pattern`;
  return (
    <svg
      aria-hidden
      data-iso-grid=""
      className="react-flow__background !bg-transparent"
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
    >
      <pattern
        id={patternId}
        x={tx % w}
        y={ty % h}
        width={w}
        height={h}
        patternUnits="userSpaceOnUse"
      >
        {/* The 150° line (down to the right), then the 30° line (up to the right) */}
        <path
          d={`M0 0 L${w} ${h} M0 ${h} L${w} 0`}
          fill="none"
          stroke="var(--grid-line)"
          strokeWidth={1}
        />
      </pattern>
      <rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
