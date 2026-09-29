"use client";

import { useMemo } from "react";
import { patternHorizonSec, peakRate, rateAt, PATTERN_LABELS } from "@/engine/traffic/patterns";
import type { TrafficPattern } from "@/engine/traffic/types";
import { formatRps } from "./format";

const W = 240;
const H = 56;
const PAD = 2;
const POINTS = 160;

/**
 * Miniature λ(t) curve of a pattern (TRF-03), with a playhead at the
 * pattern's own clock while a run is going.
 */
export function PatternPreview({
  pattern,
  playheadSec,
}: {
  pattern: TrafficPattern;
  /** Seconds since the pattern was applied; hidden when null. */
  playheadSec: number | null;
}) {
  const horizon = patternHorizonSec(pattern);
  const peak = peakRate(pattern);

  const { line, area } = useMemo(() => {
    const top = peak > 0 ? peak * 1.1 : 1;
    const pts: string[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const t = (i / POINTS) * horizon;
      const x = PAD + (i / POINTS) * (W - 2 * PAD);
      const y = H - PAD - (rateAt(pattern, t) / top) * (H - 2 * PAD);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return {
      line: pts.join(" "),
      area: `${PAD},${H - PAD} ${pts.join(" ")} ${W - PAD},${H - PAD}`,
    };
  }, [pattern, horizon, peak]);

  const playX =
    playheadSec !== null && horizon > 0
      ? PAD + (Math.min(playheadSec, horizon) / horizon) * (W - 2 * PAD)
      : null;

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-14 w-full rounded-md border border-zinc-800 bg-zinc-950"
        role="img"
        aria-label={`${PATTERN_LABELS[pattern.kind]} load curve over ${Math.round(horizon)} seconds, peak ${formatRps(peak)} requests per second`}
      >
        <polygon points={area} className="fill-cyan-500/10" />
        <polyline
          points={line}
          fill="none"
          className="stroke-cyan-400"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {playX !== null && (
          <line
            x1={playX}
            x2={playX}
            y1={0}
            y2={H}
            className="stroke-amber-400"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            data-testid="pattern-playhead"
          />
        )}
      </svg>
      <figcaption className="flex justify-between font-mono text-[10px] text-zinc-400">
        <span>0 s</span>
        <span>peak {formatRps(peak)} rps</span>
        <span>{Math.round(horizon)} s</span>
      </figcaption>
    </figure>
  );
}
