"use client";

import { useState } from "react";
import { useInternalNode, useStore } from "@xyflow/react";
import { X } from "lucide-react";
import { instancesOf } from "@/domain/components/registry";
import { instanceNodeId } from "@/lib/instances";
import { abbrev, fmtMs, fmtPct } from "@/lib/runtimeMetrics";
import { useIsMobile } from "@/hooks/useBreakpoint";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";
import { usePenStore } from "@/store/penStore";
import { useNodeRuntime, useRuntimeStore } from "@/store/runtimeStore";
import {
  NodeCharts,
  NodeMetricGrid,
  SmallStat,
  StatusIcon,
  useSelectedComponentId,
} from "@/components/panel/MetricsDisplay";

/**
 * The selected resource's numbers next to it on the canvas (Spec 07): what the
 * Sim tab shows globally (throughput, latency, error rate, availability) for
 * this node, then its utilization, extras and charts. Shown while a run or an
 * analysis exists and exactly one component is selected; placed beside the
 * node in screen space from ReactFlow's store, so it follows pan, zoom and
 * drags (an expanded node anchors to its first instance card). It sits at the
 * level of the ball overlay (z 4), above it: a NodeToolbar would live inside
 * the renderer, under the balls. Closed with ×, Escape or a click on the
 * canvas. Not on phones: the bottom sheet shows the same.
 */
export function NodeInsightCard() {
  const nodeId = useSelectedComponentId();
  const hasRun = useRuntimeStore((s) => s.latest !== null);
  const penActive = usePenStore((s) => s.mode !== "off");
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!nodeId || !hasRun || penActive || isMobile || dismissed === nodeId) return null;
  return <Card nodeId={nodeId} onClose={() => setDismissed(nodeId)} />;
}

function Card({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const m = useNodeRuntime(nodeId);
  const data = useCanvasStore(
    (s) => s.nodes.find((n) => n.id === nodeId)?.data as ComponentNodeData | undefined,
  );
  const expanded = useExpandedNodesStore((s) => s.expanded[nodeId] === true);
  if (!data) return null;
  const instances = instancesOf(data);
  const anchor = expanded && instances > 1 ? instanceNodeId(nodeId, 0) : nodeId;
  const served = m ? m.rpsIn * (1 - m.errorRate) : 0;

  return (
    <Anchored nodeId={anchor}>
      <section
        data-testid="node-insight-card"
        aria-label={`Metrics for ${data.label}`}
        className="nowheel nodrag nopan w-[300px] space-y-2.5 rounded-xl border border-zinc-700/80 bg-zinc-950/95 p-3 shadow-[var(--shadow-e2)] backdrop-blur"
      >
        <header className="flex items-center gap-1.5">
          {m && <StatusIcon status={m.status} />}
          <p className="truncate text-xs font-semibold text-zinc-100">{data.label}</p>
          {instances > 1 && (
            <span className="font-mono text-[10px] text-zinc-400">×{instances}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close metrics"
            title="Close (Esc)"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>

        {m ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-zinc-800/70 px-3 py-2" data-testid="node-throughput">
                <p className="metric-label text-[10px]">Throughput</p>
                <p className="metric-value mt-1 font-mono text-xl font-semibold leading-none text-zinc-50">
                  {abbrev(served)}
                  <span className="ml-1 text-[10px] font-normal text-zinc-500">req/s</span>
                </p>
                <p className="mt-1 text-[10px] text-zinc-400">of {abbrev(m.rpsIn)} in</p>
              </div>
              <div className="rounded-lg bg-zinc-800/70 px-3 py-2" data-testid="node-latency">
                <p className="metric-label text-[10px]">Latency p50</p>
                <p className="metric-value mt-1 font-mono text-xl font-semibold leading-none text-zinc-50">
                  {m.p50 < 10 ? m.p50.toFixed(1) : m.p50.toFixed(0)}
                  <span className="ml-1 text-[10px] font-normal text-zinc-500">ms</span>
                </p>
                <p className="mt-1 text-[10px] text-zinc-400">
                  p95 {fmtMs(m.p95)} · p99 {fmtMs(m.p99)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <SmallStat
                label="Error rate"
                value={fmtPct(m.errorRate)}
                tone={m.errorRate > 0.01 ? "bad" : undefined}
              />
              <SmallStat
                label="Availability"
                value={fmtPct(1 - m.errorRate, 3)}
                tone={m.errorRate > 0.01 ? "bad" : undefined}
              />
              <SmallStat
                label="Drops"
                value={`${abbrev(m.drops)}/s`}
                tone={m.drops > 0 ? "bad" : undefined}
              />
            </div>
            <NodeMetricGrid m={m} summarized />
            <NodeCharts nodeId={nodeId} />
          </>
        ) : (
          <p className="text-[11px] text-zinc-400">
            No traffic reached this node in the last run (not wired to an entry point?).
          </p>
        )}
      </section>
    </Anchored>
  );
}

/** Gap between the node's right edge and the card, screen px. */
const CARD_GAP = 14;

/** Positions its child beside the node's right edge, in the canvas's screen space. */
function Anchored({ nodeId, children }: { nodeId: string; children: React.ReactNode }) {
  const node = useInternalNode(nodeId);
  const [tx, ty, zoom] = useStore((s) => s.transform);
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? 0;
  return (
    <div
      className="absolute"
      style={{ left: (x + width) * zoom + tx + CARD_GAP, top: y * zoom + ty, zIndex: 5 }}
    >
      {children}
    </div>
  );
}
