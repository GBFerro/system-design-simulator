"use client";

import { Pause, Play } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { formatClock } from "./format";
import { togglePlayback } from "./simActions";

/** Compact live play/pause + clock for the top bar (the full controls live in the Sim panel). */
export function PlaybackMini() {
  const playback = useRuntimeStore((s) => s.playback);
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  const running = playback === "running";
  return (
    <div className="hidden h-7 items-center rounded-md border border-zinc-700 md:flex">
      <button
        type="button"
        onClick={togglePlayback}
        className={`flex h-full w-7 items-center justify-center rounded-l-md transition-colors hover:bg-zinc-800 ${
          running ? "text-amber-300" : "text-zinc-300 hover:text-zinc-100"
        }`}
        aria-label={running ? "Pause live traffic" : "Play live traffic"}
        title={running ? "Pause live traffic (P)" : "Play live traffic (P)"}
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span
        className={`px-1.5 font-mono text-[11px] tabular-nums ${running ? "text-cyan-300" : "text-zinc-400"}`}
        aria-hidden="true"
      >
        {formatClock(simTime)}
      </span>
    </div>
  );
}
