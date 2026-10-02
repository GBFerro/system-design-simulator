"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useRecentHistory, useRuntimeStore } from "@/store/runtimeStore";
import { useChaosStore } from "@/store/chaosStore";
import type { NodeRuntimeMetrics, TickSnapshot } from "@/engine/types";
import { abbrev, fmtMs, fmtPct } from "@/lib/runtimeMetrics";
import { RUNTIME_STATUS_META, utilizationBarClass } from "@/components/canvas/nodes/runtimeStatus";
import { TimeSeriesChart } from "./TimeSeriesChart";

/** Simulated seconds shown by the panel charts (the full buffer is 5 min). */
const PANEL_WINDOW_SEC = 300;
const PANEL_MAX_POINTS = 150;

/**
 * Sim tab metrics (Spec 07, OBS-01/02/03). Everything numeric comes from
 * `runtimeStore` (latest snapshot + history), fed by the Analyze button and
 * by the tick loop. Analysis-only notes (warnings, bottleneck count) still
 * come from `simulationStore.result`.
 */
export function MetricsDisplay() {
  const latest = useRuntimeStore((s) => s.latest);

  if (!latest) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700">
          <Activity className="h-4 w-4 text-zinc-500" />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-300">No simulation data</p>
          <p className="mt-1 max-w-[200px] text-xs text-zinc-500">
            Press <span className="text-cyan-500">Simulate</span> for live traffic or{" "}
            <span className="text-zinc-300">Analyze</span> for an instant snapshot
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="sim-metrics">
      <GlobalSummary snapshot={latest} />
      <GlobalCharts />
      <AnalysisNotes />
      <SelectedNodeMetrics snapshot={latest} />
      <NodeList snapshot={latest} />
    </div>
  );
}

/* ---------- OBS-02: global ---------- */

function GlobalSummary({ snapshot }: { snapshot: TickSnapshot }) {
  const g = snapshot.global;
  return (
    <>
      {/* Big tabular value, dimmed inline unit, muted uppercase label */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5" data-testid="global-throughput">
          <p className="metric-label text-[10px]">Throughput</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {abbrev(g.throughput)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">req/s</span>
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">of {abbrev(snapshot.offeredRps)} offered</p>
        </div>
        <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5" data-testid="global-latency">
          <p className="metric-label text-[10px]">Latency p50</p>
          <p className="metric-value mt-1 font-mono text-2xl font-semibold leading-none text-zinc-50">
            {g.p50 < 10 ? g.p50.toFixed(1) : g.p50.toFixed(0)}
            <span className="ml-1 align-baseline text-xs font-normal text-zinc-500">ms</span>
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">
            p95 {g.p95.toFixed(0)} · p99 {g.p99.toFixed(0)} ms
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SmallStat label="Goodput" value={`${abbrev(g.goodput)}/s`} />
        <SmallStat
          label="Error rate"
          value={fmtPct(g.errorRate)}
          tone={g.errorRate > 0.01 ? "bad" : undefined}
        />
        <SmallStat
          label="Availability"
          value={fmtPct(g.availability, 3)}
          tone={g.availability < 0.99 ? "bad" : undefined}
        />
      </div>
    </>
  );
}

function SmallStat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg bg-zinc-800/70 px-2.5 py-2">
      <p className="metric-label text-[10px]">{label}</p>
      <p
        className={`mt-1 font-mono text-sm tabular-nums ${tone === "bad" ? "text-rose-400" : "text-zinc-100"}`}
      >
        {value}
      </p>
    </div>
  );
}

/** Fault start/end times of the run, as chart markers (Spec 08). */
function useFaultMarkers(): { t: number; kind: "start" | "end" }[] {
  const faults = useChaosStore((s) => s.faults);
  return useMemo(
    () =>
      faults.flatMap((f) => [
        { t: f.startT, kind: "start" as const },
        ...(!f.active && f.endT !== undefined ? [{ t: f.endT, kind: "end" as const }] : []),
      ]),
    [faults],
  );
}

function GlobalCharts() {
  const recent = useRecentHistory(PANEL_WINDOW_SEC, PANEL_MAX_POINTS);
  const markers = useFaultMarkers();
  const times = recent.map((s) => s.t);
  return (
    <div className="space-y-2">
      <TimeSeriesChart
        title="Throughput (req/s)"
        values={recent.map((s) => s.global.throughput)}
        times={times}
        color="#22d3ee"
        format={(v) => `${abbrev(v)}/s`}
        testId="chart-throughput"
        markers={markers}
      />
      <TimeSeriesChart
        title="Latency p99 (ms)"
        values={recent.map((s) => s.global.p99)}
        times={times}
        color="#a78bfa"
        format={fmtMs}
        testId="chart-p99"
        markers={markers}
      />
    </div>
  );
}

/** Engine warnings and bottlenecks from the last analysis (Analyze button). */
function AnalysisNotes() {
  const result = useSimulationStore((s) => s.result);
  if (!result) return null;
  return (
    <>
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
    </>
  );
}

/* ---------- OBS-01/03: per node ---------- */

/** id → label for component nodes, re-computed only when a label/id changes (not on drag). */
function useNodeLabels(): Map<string, string> {
  const signature = useCanvasStore((s) => {
    let sig = "";
    for (const n of s.nodes) {
      if (n.type === "text") continue;
      sig += `${n.id}\u0000${String((n.data as { label?: unknown }).label ?? n.id)}\u0001`;
    }
    return sig;
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of signature.split("\u0001")) {
      if (!entry) continue;
      const [id, label] = entry.split("\u0000");
      map.set(id, label);
    }
    return map;
  }, [signature]);
}

/** The single selected component node, if exactly one node is selected. */
function useSelectedComponentId(): string | null {
  return useCanvasStore((s) => {
    let found: string | null = null;
    for (const n of s.nodes) {
      if (!n.selected) continue;
      if (found !== null || n.type === "text") return null;
      found = n.id;
    }
    return found;
  });
}

function SelectedNodeMetrics({ snapshot }: { snapshot: TickSnapshot }) {
  const id = useSelectedComponentId();
  const labels = useNodeLabels();
  if (!id) return null;
  const m = snapshot.nodes[id];
  const label = labels.get(id) ?? id;

  return (
    <section
      className="space-y-2 rounded-lg border border-cyan-500/20 bg-zinc-900 p-2.5"
      data-testid="selected-node-metrics"
      aria-label={`Metrics for ${label}`}
    >
      <div className="flex items-center gap-1.5">
        {m && <StatusIcon status={m.status} />}
        <p className="truncate text-xs font-semibold text-zinc-200">{label}</p>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-400">selected</span>
      </div>
      {m ? (
        <>
          <NodeMetricGrid m={m} />
          <NodeCharts nodeId={id} />
        </>
      ) : (
        <p className="text-[11px] text-zinc-400">
          No traffic reached this node in the last run (not wired to an entry point?).
        </p>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: NodeRuntimeMetrics["status"] }) {
  const meta = RUNTIME_STATUS_META[status];
  return (
    <span
      className={`flex shrink-0 items-center ${meta.text}`}
      role="img"
      aria-label={`Status: ${meta.label}`}
      title={`Status: ${meta.label}`}
    >
      <meta.Icon className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

function NodeMetricGrid({ m }: { m: NodeRuntimeMetrics }) {
  const util = Math.max(0, m.utilization);
  const cells: { label: string; value: string; bad?: boolean }[] = [
    { label: "RPS in", value: `${abbrev(m.rpsIn)}/s` },
    { label: "RPS out", value: `${abbrev(m.rpsOut)}/s` },
    { label: "Queue", value: abbrev(m.queueDepth) },
    { label: "p50", value: fmtMs(m.p50) },
    { label: "p95", value: fmtMs(m.p95) },
    { label: "p99", value: fmtMs(m.p99) },
    { label: "Errors", value: fmtPct(m.errorRate), bad: m.errorRate > 0.01 },
    { label: "Drops", value: `${abbrev(m.drops)}/s`, bad: m.drops > 0 },
  ];
  const x = m.extra;
  if (x?.hitRatio !== undefined) cells.push({ label: "Hit ratio", value: fmtPct(x.hitRatio) });
  if (x?.queueLagSec !== undefined)
    cells.push({ label: "Queue lag", value: fmtMs(x.queueLagSec * 1000), bad: x.queueLagSec > 1 });
  if (x?.poolUsage !== undefined)
    cells.push({ label: "Pool used", value: fmtPct(x.poolUsage, 0), bad: x.poolUsage >= 0.9 });
  if (x?.replicationLagMs !== undefined)
    cells.push({ label: "Repl. lag", value: fmtMs(x.replicationLagMs) });
  if (x?.breakerState !== undefined)
    cells.push({
      label: "Breaker",
      value: x.breakerState,
      bad: x.breakerState !== "closed",
    });

  return (
    <div className="space-y-2">
      <div title="Utilization (ρ)">
        <div className="mb-1 flex items-center justify-between">
          <p className="metric-label text-[10px]">Utilization</p>
          <p className="font-mono text-xs tabular-nums text-zinc-200">{(util * 100).toFixed(0)}%</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full ${utilizationBarClass(util)}`}
            style={{ width: `${Math.min(util * 100, 100)}%` }}
          />
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-2 gap-y-1.5" data-testid="node-metric-grid">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="metric-label text-[9px]">{c.label}</dt>
            <dd
              className={`font-mono text-xs tabular-nums ${c.bad ? "text-rose-400" : "text-zinc-200"}`}
            >
              {c.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function NodeCharts({ nodeId }: { nodeId: string }) {
  const recent = useRecentHistory(PANEL_WINDOW_SEC, PANEL_MAX_POINTS);
  const times = recent.map((s) => s.t);
  return (
    <div className="space-y-2">
      <TimeSeriesChart
        title="RPS in"
        values={recent.map((s) => s.nodes[nodeId]?.rpsIn ?? 0)}
        times={times}
        color="#22d3ee"
        format={(v) => `${abbrev(v)}/s`}
      />
      <TimeSeriesChart
        title="Hop p99"
        values={recent.map((s) => s.nodes[nodeId]?.p99 ?? 0)}
        times={times}
        color="#a78bfa"
        format={fmtMs}
      />
    </div>
  );
}

function NodeList({ snapshot }: { snapshot: TickSnapshot }) {
  const labels = useNodeLabels();
  const selectOnly = useCanvasStore((s) => s.selectOnly);
  const rows = Object.entries(snapshot.nodes).sort(([, a], [, b]) => b.utilization - a.utilization);

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Per-Node Metrics
      </p>
      {/* Plain overflow container: the base-ui ScrollArea viewport needs a
          definite height, so max-h on the root never actually scrolled. */}
      <div className="max-h-[300px] overflow-y-auto">
        <ul className="space-y-1.5">
          {rows.map(([id, m]) => {
            const util = Math.max(0, m.utilization);
            const meta = RUNTIME_STATUS_META[m.status];
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => selectOnly([id])}
                  className="w-full rounded-md bg-zinc-800 px-2.5 py-2 text-left transition-colors hover:bg-zinc-700/80"
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <StatusIcon status={m.status} />
                    <span className="truncate text-xs font-medium text-zinc-300">
                      {labels.get(id) ?? id}
                    </span>
                    {(m.status === "critical" || m.status === "down") && (
                      <span className={`ml-auto text-[11px] font-medium ${meta.text}`}>
                        {m.status === "down" ? "DOWN" : "BOTTLENECK"}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="metric-label text-[9px]">RPS in</p>
                      <p className="font-mono text-xs tabular-nums text-zinc-200">
                        {abbrev(m.rpsIn)}
                      </p>
                    </div>
                    <div>
                      <p className="metric-label text-[9px]">Util</p>
                      <div className="flex items-center gap-1">
                        <div className="h-1 w-8 overflow-hidden rounded-full bg-zinc-700">
                          <div
                            className={`h-full rounded-full ${utilizationBarClass(util)}`}
                            style={{ width: `${Math.min(util * 100, 100)}%` }}
                          />
                        </div>
                        <p className="font-mono text-xs text-zinc-200">
                          {(util * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="metric-label text-[9px]">p99</p>
                      <p className="font-mono text-xs tabular-nums text-zinc-200">{fmtMs(m.p99)}</p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
