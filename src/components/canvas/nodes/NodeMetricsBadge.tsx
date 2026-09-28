"use client";

import { memo, useState } from "react";
import { useNodeRuntime, useRecentHistory } from "@/store/runtimeStore";
import { SPARKLINE_WINDOW_SEC, abbrev, fmtMs, sparklinePath } from "@/lib/runtimeMetrics";
import { RUNTIME_STATUS_META, utilizationBarClass } from "./runtimeStatus";

const SPARK_W = 132;
const SPARK_H = 30;

/**
 * OBS-01 badge under a component node: RPS in, utilization bar, p99, and the
 * status by color + icon. Subscribes only to this node's metrics, so a tick
 * re-renders just the badges whose numbers changed (never the node itself).
 * Hover (desktop) — or selecting the node on touch — opens a sparkline of the
 * last ~30 s of RPS in.
 */
function NodeMetricsBadgeInner({
  nodeId,
  showSparkline,
}: {
  nodeId: string;
  /** Touch devices have no hover: the node shows it while selected. */
  showSparkline: boolean;
}) {
  const m = useNodeRuntime(nodeId);
  const [hover, setHover] = useState(false);
  if (!m) return null;

  const meta = RUNTIME_STATUS_META[m.status];
  const util = Math.max(0, m.utilization);
  const open = hover || showSparkline;

  return (
    <div
      data-testid="node-metrics"
      data-rps-in={Math.round(m.rpsIn)}
      data-p99={m.p99}
      data-status={m.status}
      // Fixed size: changing numbers must never resize the node, or ReactFlow
      // would re-measure it and rewrite (re-persist) canvasStore on every tick.
      className="relative mt-0.5 h-[22px] w-[120px] shrink-0 whitespace-nowrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-1 font-mono text-[9px] leading-none text-zinc-300">
        <span
          className={`flex shrink-0 items-center ${meta.text}`}
          role="img"
          aria-label={`Status: ${meta.label}`}
          title={`Status: ${meta.label}`}
        >
          <meta.Icon className="h-2.5 w-2.5" aria-hidden />
        </span>
        <span title="Requests in (req/s)">{abbrev(m.rpsIn)}/s</span>
        <span className="ml-auto text-zinc-400" title="p99 latency of this hop">
          p99 <span className="text-zinc-200">{fmtMs(m.p99)}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1" title="Utilization (ρ)">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${utilizationBarClass(util)}`}
            style={{ width: `${Math.min(util * 100, 100)}%` }}
          />
        </div>
        <span className={`font-mono text-[9px] leading-none ${meta.text}`}>
          {(util * 100).toFixed(0)}%
        </span>
      </div>
      {open && <NodeSparkline nodeId={nodeId} />}
    </div>
  );
}

export const NodeMetricsBadge = memo(NodeMetricsBadgeInner);

/** Mounted only while open: it re-renders on every snapshot. */
function NodeSparkline({ nodeId }: { nodeId: string }) {
  const recent = useRecentHistory(SPARKLINE_WINDOW_SEC, 90);
  const values = recent.map((s) => s.nodes[nodeId]?.rpsIn ?? 0);
  const { d, max, points } = sparklinePath(values, SPARK_W, SPARK_H);
  const last = points[points.length - 1];

  return (
    <div
      data-testid="node-sparkline"
      className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-[148px] -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 shadow-lg"
    >
      <div className="mb-1 flex items-center justify-between text-[9px] leading-none text-zinc-400">
        <span>RPS in · last {SPARKLINE_WINDOW_SEC}s</span>
        <span className="font-mono text-zinc-300">{abbrev(max)}</span>
      </div>
      {d ? (
        <svg
          width={SPARK_W}
          height={SPARK_H}
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          role="img"
          aria-label={`RPS in over the last ${SPARKLINE_WINDOW_SEC} seconds, peak ${abbrev(max)} per second`}
        >
          <line
            x1={0}
            x2={SPARK_W}
            y1={SPARK_H - 0.5}
            y2={SPARK_H - 0.5}
            stroke="rgb(63 63 70)"
            strokeWidth={1}
          />
          <path
            d={d}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {last && <circle cx={last.x} cy={last.y} r={2.5} fill="#22d3ee" />}
        </svg>
      ) : (
        <p className="py-1 text-[9px] leading-snug text-zinc-400">
          Press play to build a time series.
        </p>
      )}
    </div>
  );
}
