"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { sparklinePath } from "@/lib/runtimeMetrics";

const W = 240;
const H = 44;

/**
 * Small single-series time chart (inline SVG, no deps — uPlot is Phase 5).
 * One measure per chart (no dual axes); zero baseline; 2 px line; hover shows
 * a crosshair and the value at that point in the header.
 */
export function TimeSeriesChart({
  title,
  values,
  times,
  color,
  format,
  testId,
  markers,
}: {
  title: string;
  values: number[];
  /** Simulated seconds, same length as `values`. */
  times: number[];
  color: string;
  format: (v: number) => string;
  testId?: string;
  /** Vertical markers at simulated times (fault start/end, Spec 08). */
  markers?: { t: number; kind: "start" | "end" }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { d, max, points } = sparklinePath(values, W, H, 2);
  const idx = hover !== null && hover < points.length ? hover : null;
  const shown = idx ?? values.length - 1;

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
    const step = points[1].x - points[0].x || 1;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round((x - points[0].x) / step))));
  };

  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  // Points are evenly spaced by index; the series is uniform in time, so
  // map a time linearly between the first and last point.
  const markerX = (t: number) =>
    points.length > 1 && span > 0
      ? points[0].x + ((t - times[0]) / span) * (points[points.length - 1].x - points[0].x)
      : null;
  const shownMarkers = (markers ?? [])
    .map((m) => ({ ...m, x: markerX(m.t) }))
    .filter((m): m is { t: number; kind: "start" | "end"; x: number } => m.x !== null)
    .filter((m) => m.x >= 0 && m.x <= W);

  return (
    <div className="rounded-lg bg-zinc-800/70 px-3 py-2" data-testid={testId}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="metric-label text-[10px]">{title}</p>
        <p className="font-mono text-[11px] tabular-nums text-zinc-200">
          {values.length > 0 ? format(values[shown]) : "—"}
          {idx !== null && times[idx] !== undefined && (
            <span className="ml-1 text-zinc-400">@ {times[idx].toFixed(1)}s</span>
          )}
        </p>
      </div>
      {d ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-11 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: peak ${format(max)} over the last ${span.toFixed(0)} simulated seconds`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="rgb(63 63 70)" strokeWidth={1} />
          {shownMarkers.map((m, i) => (
            <line
              key={`${m.kind}-${m.t}-${i}`}
              x1={m.x}
              x2={m.x}
              y1={0}
              y2={H}
              stroke={m.kind === "start" ? "#fb923c" : "#34d399"}
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {idx !== null && (
            <line
              x1={points[idx].x}
              x2={points[idx].x}
              y1={0}
              y2={H}
              stroke="rgb(161 161 170)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      ) : (
        <p className="py-2 text-[11px] leading-snug text-zinc-400">
          One snapshot so far — play the simulation to build a time series.
        </p>
      )}
      {d && (
        <div className="mt-0.5 flex justify-between text-[9px] leading-none text-zinc-400">
          <span>−{span.toFixed(0)}s</span>
          <span>max {format(max)}</span>
        </div>
      )}
    </div>
  );
}
