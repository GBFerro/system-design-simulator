"use client";

import { useState } from "react";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { formatClock } from "./format";
import { pauseSimulation, playSimulation, resetSimulation } from "./simActions";

/*
 * Pause/Resume/Stop labels. At 2xl the rest of the bar gains its labels too,
 * which leaves the problem selector under its 80 px minimum until ~1680 px
 * (smoke.spec.ts), so these collapse to icons in that band.
 */
const LIVE_LABEL = "hidden sm:inline 2xl:hidden min-[1680px]:inline";

/**
 * The top bar's Simulate button: starts the live run, then becomes
 * Pause/Resume + Stop with the simulated clock. Stop rewinds to 00:00 and
 * clears the metrics. The instant steady-state analysis lives in the Sim panel.
 */
export function PlaybackMini() {
  const playback = useRuntimeStore((s) => s.playback);
  // The engine loads on the first play: show it started before the worker answers.
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await playSimulation();
    } finally {
      setStarting(false);
    }
  };

  if (playback !== "idle")
    return <LiveRunControls running={playback === "running"} onResume={start} />;

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={starting}
      className="flex h-7 items-center gap-1.5 rounded-md bg-cyan-500 px-3 text-xs font-medium text-white transition-colors hover:bg-cyan-400 disabled:opacity-80"
      aria-label="Simulate"
      title="Start the live simulation (P)"
    >
      {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
      <span className="hidden sm:inline">Simulate</span>
    </button>
  );
}

function LiveRunControls({
  running,
  onResume,
}: {
  running: boolean;
  onResume: () => Promise<void>;
}) {
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  return (
    <div
      className="flex h-7 items-center rounded-md border border-zinc-700"
      role="group"
      aria-label="Live simulation"
    >
      <button
        type="button"
        onClick={running ? pauseSimulation : () => void onResume()}
        className={`flex h-full items-center gap-1.5 rounded-l-md px-2.5 text-xs font-medium transition-colors ${
          running
            ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            : "bg-cyan-500 text-white hover:bg-cyan-400"
        }`}
        aria-label={running ? "Pause live traffic" : "Resume live traffic"}
        title={running ? "Pause (P)" : "Resume (P)"}
      >
        {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        <span className={LIVE_LABEL}>{running ? "Pause" : "Resume"}</span>
      </button>
      <button
        type="button"
        onClick={resetSimulation}
        className="flex h-full items-center gap-1.5 border-l border-zinc-700 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-rose-300"
        aria-label="Stop simulation"
        title="Stop and reset to 00:00"
      >
        <Square className="h-3 w-3" />
        <span className={LIVE_LABEL}>Stop</span>
      </button>
      <span
        className={`hidden border-l border-zinc-700 px-2 font-mono text-[11px] tabular-nums sm:inline ${
          running ? "text-cyan-300" : "text-zinc-400"
        }`}
        aria-hidden="true"
      >
        {formatClock(simTime)}
      </span>
    </div>
  );
}
