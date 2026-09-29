"use client";

import { useChaosStore } from "@/store/chaosStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { formatClock } from "@/components/traffic/format";
import type { FaultRecord } from "@/engine/faults/types";

/** Same span as the history buffer and the Sim panel charts (5 min simulated). */
const WINDOW_SEC = 300;
const MAX_LANES = 4;

/**
 * Fault timeline (Spec 08, CHS-04): one lane per fault of the run with its
 * start and end (open while active), over the last 5 simulated minutes.
 * Shown at the bottom of the canvas only while the run has faults.
 */
export function ChaosTimeline() {
  const faults = useChaosStore((s) => s.faults);
  const now = useRuntimeStore((s) => s.simTimeSec);
  if (faults.length === 0) return null;

  const t1 = Math.max(now, ...faults.map((f) => f.startT), 1);
  const t0 = Math.max(0, t1 - WINDOW_SEC);
  const span = Math.max(1e-9, t1 - t0);
  const x = (t: number) => `${((Math.min(Math.max(t, t0), t1) - t0) / span) * 100}%`;
  const lanes = faults.slice(-MAX_LANES);
  const hidden = faults.length - lanes.length;

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-14 right-4 z-10 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-2 shadow-lg backdrop-blur md:right-44"
      role="region"
      aria-label="Fault timeline"
      data-testid="chaos-timeline"
    >
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
        <span className="font-medium uppercase tracking-wider">
          Faults{hidden > 0 ? ` (+${hidden} earlier)` : ""}
        </span>
        <span className="font-mono">
          {formatClock(t0)} – {formatClock(t1)}
        </span>
      </div>
      <ul className="space-y-1">
        {lanes.map((f) => (
          <Lane key={f.id} fault={f} x={x} now={now} />
        ))}
      </ul>
    </div>
  );
}

function Lane({ fault, x, now }: { fault: FaultRecord; x: (t: number) => string; now: number }) {
  const end = fault.active ? Math.max(now, fault.startT) : (fault.endT ?? fault.startT);
  const left = x(fault.startT);
  const right = x(end);
  const range = `${formatClock(fault.startT)}–${fault.active ? "now" : formatClock(end)}`;
  return (
    <li className="flex items-center gap-2">
      <span
        className={`w-28 shrink-0 truncate text-[10px] ${fault.active ? "text-orange-200" : "text-zinc-400"}`}
        title={fault.label}
      >
        {fault.label}
      </span>
      <span
        className="relative h-3 flex-1 rounded-sm bg-zinc-800"
        aria-label={`${fault.label}: ${range}`}
        role="img"
      >
        <span
          className={`absolute inset-y-0 rounded-sm ${fault.active ? "bg-orange-500/70" : "bg-zinc-500/60"}`}
          style={{ left, width: `max(2px, calc(${right} - ${left}))` }}
        />
        {/* start / end markers */}
        <span className="absolute inset-y-[-2px] w-px bg-orange-300" style={{ left }} />
        {!fault.active && (
          <span className="absolute inset-y-[-2px] w-px bg-emerald-400" style={{ left: right }} />
        )}
      </span>
    </li>
  );
}
