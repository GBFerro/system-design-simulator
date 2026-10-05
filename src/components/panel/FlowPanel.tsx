"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { RefreshCw } from "lucide-react";
import type { GraphTrace } from "@/engine/core/trace";
import { NO_ENTRY_WARNING } from "@/engine/constants";
import { sequenceLayout } from "@/lib/sequenceLayout";
import { topologySignature } from "@/lib/topology";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { setFlowHighlight } from "@/store/flowHighlightStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { SequenceDiagram } from "./SequenceDiagram";
import { SECTION_TITLE } from "./styles";

/** Message without a snapshot (FLW-37): the structure only. */
export const NO_TIMINGS_MESSAGE = "Run the simulation or Analyze to see the timings";

/** The trace follows the run's load, but only when it moves by more than this factor (not every tick). */
const RPS_STEP = 1.25;

/** What the trace depends on: the structure, the params and the edge calls (never positions). */
function designKey(nodes: readonly Node[], edges: readonly Edge[]): string {
  let key = topologySignature(nodes, edges);
  for (const n of nodes) {
    if (n.type !== "text") key += JSON.stringify((n.data as ComponentNodeData).params);
  }
  for (const e of edges) key += JSON.stringify((e.data as { rule?: unknown } | undefined)?.rule);
  return key;
}

/**
 * The latest snapshot's offered load, followed without re-rendering on every
 * tick: it changes only when the load moves by more than `RPS_STEP`, or a
 * snapshot appears or goes away. Undefined without a snapshot.
 */
function useTraceRps(): number | undefined {
  const [rps, setRps] = useState<number | undefined>(
    () => useRuntimeStore.getState().latest?.offeredRps,
  );
  useEffect(
    () =>
      useRuntimeStore.subscribe((s) => {
        const next = s.latest?.offeredRps;
        setRps((prev) => {
          if (next === undefined || prev === undefined) return next;
          if (!(prev > 0) || !(next > 0)) return next;
          return Math.abs(Math.log(next / prev)) > Math.log(RPS_STEP) ? next : prev;
        });
      }),
    [],
  );
  return rps;
}

interface Traced {
  trace: GraphTrace;
  labels: Record<string, string>;
  /** Traced with a snapshot's load: the times mean something. */
  timed: boolean;
}

/**
 * The Flow tab (request-flow, FLW-33..41): one read or write request through
 * the design as a sequence diagram. The trace runs in the engine worker
 * (`traceCanvas`, lazy) at the latest snapshot's load, and is recomputed only
 * when the design, the class, the request number or the existence/level of
 * the load change — never on a tick. Read-only: it works on reference tabs.
 */
export function FlowPanel() {
  const key = useCanvasStore((s) => designKey(s.nodes, s.edges));
  const rps = useTraceRps();
  const [cls, setCls] = useState<"read" | "write">("read");
  const [index, setIndex] = useState(0);
  const [traced, setTraced] = useState<Traced | null>(null);
  const [failed, setFailed] = useState(false);
  // Traces asked for so far, on the section's `data-traces` (e2e: a tick must not trigger one).
  const section = useRef<HTMLElement>(null);
  const runs = useRef(0);

  useEffect(() => {
    let cancelled = false;
    runs.current++;
    section.current?.setAttribute("data-traces", String(runs.current));
    const { nodes, edges } = useCanvasStore.getState();
    const labels: Record<string, string> = {};
    for (const n of nodes) {
      if (n.type !== "text") labels[n.id] = (n.data as ComponentNodeData).label ?? n.id;
    }
    import("@/engine/client")
      .then(({ traceCanvas }) => traceCanvas(nodes, edges, { rps, cls, index }))
      .then((trace) => {
        if (cancelled) return;
        setTraced({ trace, labels, timed: rps !== undefined });
        setFailed(false);
      })
      .catch((err) => {
        console.error("Request trace failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, rps, cls, index]);

  // The highlight belongs to this tab: leave nothing lit behind.
  useEffect(() => () => setFlowHighlight(null), []);

  const layout = useMemo(
    () => (traced ? sequenceLayout(traced.trace, traced.labels) : null),
    [traced],
  );
  const noEntry =
    traced?.trace.events.length === 0 && traced.trace.warnings.includes(NO_ENTRY_WARNING);

  return (
    <section aria-label="Request flow" className="space-y-3" data-testid="flow-panel" ref={section}>
      <p className={SECTION_TITLE}>Request flow</p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Request class" className="flex rounded-md bg-zinc-800 p-0.5">
          {(["read", "write"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cls === c}
              onClick={() => setCls(c)}
              className={`rounded px-2.5 py-1 text-[11px] ${
                cls === c ? "bg-zinc-600 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {c === "read" ? "Read" : "Write"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          disabled={noEntry}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Another request
        </button>
        <span className="text-[11px] text-zinc-400" data-testid="flow-request">
          Request #{index + 1}
        </span>
      </div>

      {failed ? (
        <p className="text-[11px] text-red-400">The trace failed. See the console for details.</p>
      ) : !traced || !layout ? (
        <p className="text-[11px] text-zinc-400">Tracing…</p>
      ) : noEntry ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
          {NO_ENTRY_WARNING}
        </p>
      ) : (
        <>
          {traced.timed ? (
            <p className="text-[11px] text-zinc-300">
              End to end:{" "}
              <span
                className="font-mono text-zinc-100"
                data-testid="flow-total"
                data-total-ms={traced.trace.totalMs}
              >
                {formatTotal(traced.trace.totalMs)}
              </span>
              {!traced.trace.ok && <span className="ml-1 text-red-400">(the request failed)</span>}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-400" data-testid="flow-no-timings">
              {NO_TIMINGS_MESSAGE}
            </p>
          )}
          {layout.arrows.length === 0 ? (
            <p className="text-[11px] text-zinc-400">This request makes no calls.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950/40 py-1">
              <SequenceDiagram layout={layout} labels={traced.labels} timed={traced.timed} />
            </div>
          )}
          <p className="text-[11px] leading-snug text-zinc-400">
            Solid arrow: a call. Dashed: its response. Open head without a return: an async call.
            Hover or tap a step to find its edge on the canvas.
          </p>
        </>
      )}
    </section>
  );
}

function formatTotal(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}
