"use client";

import { useSimulationStore } from "@/store/simulationStore";
import { useCanvasStore } from "@/store/canvasStore";
import { Activity } from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
  idle: "bg-zinc-600",
};

/** Compact K/M/B abbreviation for large counts (Grafana-style). */
function abbrev(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1) + "K";
  return String(Math.round(n));
}

export function MetricsDisplay() {
  const result = useSimulationStore((s) => s.result);
  const nodes = useCanvasStore((s) => s.nodes);

  if (!result || !(result.nodeMetrics instanceof Map)) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700">
          <Activity className="h-4 w-4 text-zinc-500" />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-300">No simulation data</p>
          <p className="mt-1 max-w-[200px] text-xs text-zinc-500">
            Configure load above and click <span className="text-cyan-500">Run Simulation</span> to
            see metrics
          </p>
        </div>
      </div>
    );
  }

  const sortedMetrics = [...result.nodeMetrics.values()].sort(
    (a, b) => b.utilization - a.utilization,
  );

  return (
    <div className="space-y-3">
      {/* Summary — big tabular value, dimmed inline unit, muted uppercase label */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">Throughput</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {abbrev(result.throughput)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">req/s</span>
          </p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5">
          <p className="metric-label text-[10px]">
            {result.latencyP50Ms !== undefined ? "Latency p50" : "Total Latency"}
          </p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {result.totalLatencyMs.toFixed(0)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">ms</span>
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">
            {result.latencyP95Ms !== undefined && result.latencyP99Ms !== undefined
              ? `p95 ${result.latencyP95Ms.toFixed(0)} · p99 ${result.latencyP99Ms.toFixed(0)} ms`
              : "longest path"}
          </p>
        </div>
      </div>

      {result.errorRate !== undefined && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-zinc-800/70 px-3 py-2">
            <p className="metric-label text-[10px]">Error rate</p>
            <p
              className={`mt-1 font-mono text-sm tabular-nums ${
                result.errorRate > 0.01 ? "text-rose-400" : "text-zinc-100"
              }`}
            >
              {(result.errorRate * 100).toFixed(
                result.errorRate > 0 && result.errorRate < 0.001 ? 3 : 1,
              )}
              %
            </p>
          </div>
          {result.availability !== undefined && (
            <div className="rounded-lg bg-zinc-800/70 px-3 py-2">
              <p className="metric-label text-[10px]">Availability</p>
              <p className="mt-1 font-mono text-sm tabular-nums text-zinc-100">
                {(result.availability * 100).toFixed(3)}%
              </p>
            </div>
          )}
        </div>
      )}

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/20 bg-amber-950/20 px-2.5 py-2">
          {result.warnings.map((w) => (
            <li key={w} className="text-[11px] leading-snug text-amber-300">
              {w}
            </li>
          ))}
        </ul>
      )}

      {result.bottleneckNodes.length > 0 && (
        <div className="rounded-md border border-rose-500/20 bg-rose-950/30 px-2.5 py-2">
          <p className="text-xs font-medium text-rose-400">
            {result.bottleneckNodes.length} Bottleneck{result.bottleneckNodes.length > 1 ? "s" : ""}{" "}
            Detected
          </p>
        </div>
      )}

      {/* Per-node metrics */}
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Per-Node Metrics
      </p>

      {/* Plain overflow container: the base-ui ScrollArea viewport needs a
          definite height, so max-h on the root never actually scrolled. */}
      <div className="max-h-[300px] overflow-y-auto">
        <div className="space-y-1.5">
          {sortedMetrics.map((m) => {
            const node = nodes.find((n) => n.id === m.nodeId);
            const label = ((node?.data as Record<string, unknown>)?.label as string) ?? m.nodeId;
            return (
              <div key={m.nodeId} className="rounded-md bg-zinc-800 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[m.status]}`} />
                  <span className="text-xs font-medium text-zinc-300">{label}</span>
                  {m.isBottleneck && (
                    <span
                      className="ml-auto text-[11px] font-medium text-rose-400"
                      style={{ animation: "status-pulse 2s infinite" }}
                    >
                      BOTTLENECK
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="metric-label text-[9px]">QPS</p>
                    <p className="font-mono text-xs tabular-nums text-zinc-200">
                      {abbrev(m.incomingQPS)}
                    </p>
                  </div>
                  <div>
                    <p className="metric-label text-[9px]">Util</p>
                    <div className="flex items-center gap-1">
                      <div className="h-1 w-8 overflow-hidden rounded-full bg-zinc-700">
                        <div
                          className={`h-full rounded-full ${
                            m.utilization > 0.8
                              ? "bg-rose-500"
                              : m.utilization > 0.5
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(m.utilization * 100, 100)}%` }}
                        />
                      </div>
                      <p
                        className={`font-mono text-xs ${
                          m.utilization > 0.8
                            ? "text-rose-400"
                            : m.utilization > 0.5
                              ? "text-amber-400"
                              : "text-emerald-400"
                        }`}
                      >
                        {(m.utilization * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="metric-label text-[9px]">Latency</p>
                    <p className="font-mono text-xs tabular-nums text-zinc-200">
                      {m.latencyMs.toFixed(0)}ms
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
