"use client";

import { useState } from "react";
import { Clock, Flag, Loader2, Pause, Play, X } from "lucide-react";
import { useInterviewStore } from "@/store/interviewStore";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function InterviewBar() {
  const mode = useInterviewStore((s) => s.mode);
  const currentPhase = useInterviewStore((s) => s.currentPhase);
  const phases = useInterviewStore((s) => s.phases);
  const timerSeconds = useInterviewStore((s) => s.timerSeconds);
  const timerRunning = useInterviewStore((s) => s.timerRunning);
  const phaseStartTime = useInterviewStore((s) => s.phaseStartTime);
  const endInterview = useInterviewStore((s) => s.endInterview);
  const toggleTimer = useInterviewStore((s) => s.toggleTimer);
  const [finishing, setFinishing] = useState(false);

  if (mode !== "interview") return null;

  const phaseElapsed = timerSeconds - phaseStartTime;
  const targetSeconds = phases[currentPhase].targetMinutes * 60;
  const totalTarget = phases.reduce((sum, p) => sum + p.targetMinutes * 60, 0);

  // Phase timer color
  let phaseTimerColor = "text-emerald-400";
  if (phaseElapsed > targetSeconds * 2) {
    phaseTimerColor = "text-red-400";
  } else if (phaseElapsed > targetSeconds) {
    phaseTimerColor = "text-yellow-400";
  }

  // Total timer color
  let totalTimerColor = "text-zinc-300";
  if (timerSeconds > totalTarget * 2) {
    totalTimerColor = "text-red-400";
  } else if (timerSeconds > totalTarget) {
    totalTimerColor = "text-yellow-400";
  }

  return (
    // Two stacked rows below md so the controls are always on-screen;
    // a single row on md+ — no horizontal scrolling needed anywhere.
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 md:h-11 md:flex-row md:items-center md:justify-between md:gap-3 md:py-0">
      {/* Row 1 — phase info (the phases themselves are the step bar below the top bar) */}
      <div className="flex min-w-0 items-center justify-between gap-3 md:flex-1">
        {/* Phase info */}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-200">{phases[currentPhase].name}</p>
          <p className="hidden truncate text-[10px] text-zinc-400 sm:block">
            {phases[currentPhase].description}
          </p>
        </div>
      </div>

      {/* Row 2 — timers and controls */}
      <div className="flex items-center justify-between gap-2 md:justify-end md:gap-3">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          {/* Phase timer */}
          <div className="flex items-center gap-1.5">
            <Clock className="hidden h-3.5 w-3.5 text-zinc-500 sm:block" />
            <span
              className={`whitespace-nowrap font-mono text-[10px] sm:text-xs ${phaseTimerColor}`}
            >
              Phase: {formatTime(phaseElapsed)} / {formatTime(targetSeconds)}
            </span>
          </div>

          <div className="h-4 w-px bg-zinc-700" />

          {/* Total timer */}
          <span className={`whitespace-nowrap font-mono text-[10px] sm:text-xs ${totalTimerColor}`}>
            Total: {formatTime(timerSeconds)} / {formatTime(totalTarget)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <div className="hidden h-4 w-px bg-zinc-700 md:block" />

          {/* Pause/Play */}
          <button
            onClick={toggleTimer}
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={timerRunning ? "Pause timer" : "Resume timer"}
            aria-label={timerRunning ? "Pause timer" : "Resume timer"}
          >
            {timerRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>

          <div className="h-4 w-px bg-zinc-700" />

          {/* Finish: score everything and open the report (Spec 09) */}
          <button
            onClick={() => {
              if (finishing) return;
              setFinishing(true);
              void import("./finishInterview")
                .then((m) => m.finishInterview())
                .catch((err) => console.error("Finishing the interview failed", err))
                .finally(() => setFinishing(false));
            }}
            disabled={finishing}
            className="flex h-6 items-center gap-1 rounded-md bg-cyan-600 px-2 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
            title="Finish the interview and see the report"
          >
            {finishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flag className="h-3.5 w-3.5" />
            )}
            Finish
          </button>

          {/* End interview */}
          <button
            onClick={endInterview}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-rose-400"
            title="End interview"
          >
            <X className="h-3.5 w-3.5" />
            End
          </button>
        </div>
      </div>
    </div>
  );
}
