"use client";

import { useId } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { baseRateOf, rpsToSlider, sliderToRps } from "@/engine/traffic/patterns";
import { MAX_RPS, MIN_RPS } from "@/engine/traffic/types";
import { useRuntimeStore } from "@/store/runtimeStore";
import { formatClock, formatMs, formatPercent, formatRps } from "./format";
import { PatternEditor } from "./PatternEditor";
import { SpeedToggle } from "./SpeedToggle";
import { resetSimulation, setTrafficPattern, togglePlayback } from "./simActions";

const SLIDER_STEPS = 1000;

/** Simulated time since reset, mm:ss (TRF-01). */
function SimClock() {
  const running = useRuntimeStore((s) => s.playback === "running");
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  return (
    <span
      role="timer"
      className={`rounded-md bg-zinc-950 px-2 py-0.5 font-mono text-sm tabular-nums ${
        running ? "text-cyan-300" : "text-zinc-300"
      }`}
    >
      <span className="sr-only">Simulated time </span>
      <span data-testid="sim-clock">{formatClock(simTime)}</span>
    </span>
  );
}

/** Play/pause/reset and speed (TRF-01). */
function PlaybackBar() {
  const playback = useRuntimeStore((s) => s.playback);
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  const running = playback === "running";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={togglePlayback}
        className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
          running
            ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            : "bg-cyan-600 text-white hover:bg-cyan-500"
        }`}
        aria-label={running ? "Pause live traffic" : "Play live traffic"}
        title={running ? "Pause (P)" : "Play (P)"}
      >
        {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {running ? "Pause" : playback === "paused" ? "Resume" : "Play"}
      </button>
      <button
        type="button"
        onClick={resetSimulation}
        disabled={playback === "idle" && simTime === 0}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
        aria-label="Reset simulation"
        title="Reset to 00:00"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      <SpeedToggle label="Simulation speed" />
    </div>
  );
}

function Readout({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-md bg-zinc-800/60 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</dt>
      <dd className="truncate font-mono text-xs text-zinc-100" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Live global numbers of the running simulation. */
function LiveReadouts() {
  const playback = useRuntimeStore((s) => s.playback);
  const offered = useRuntimeStore((s) => s.latest?.offeredRps);
  const global = useRuntimeStore((s) => s.latest?.global);
  if (playback === "idle" || !global || offered === undefined) return null;
  return (
    <dl className="grid grid-cols-4 gap-1.5" aria-live="off">
      <Readout label="Load" value={formatRps(offered)} testId="live-offered" />
      <Readout label="Served" value={formatRps(global.throughput)} testId="live-throughput" />
      <Readout label="p99" value={formatMs(global.p99)} testId="live-p99" />
      <Readout label="Errors" value={formatPercent(global.errorRate)} testId="live-errors" />
    </dl>
  );
}

/** Log-scale RPS slider, 10 → 1M, live (TRF-02). Moving it makes the pattern constant. */
function RpsSlider() {
  const id = useId();
  const pattern = useRuntimeStore((s) => s.pattern);
  const rps = pattern.kind === "constant" ? pattern.rps : baseRateOf(pattern);
  const pos = Math.round(rpsToSlider(rps, MIN_RPS, MAX_RPS) * SLIDER_STEPS);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[11px] text-zinc-400">
          Requests/sec <span className="text-zinc-400">(log scale)</span>
        </label>
        <span className="font-mono text-xs text-cyan-400" data-testid="live-rps">
          {formatRps(rps)} rps
          {pattern.kind !== "constant" && <span className="text-zinc-400"> base</span>}
        </span>
      </div>
      <Slider
        id={id}
        value={[pos]}
        min={0}
        max={SLIDER_STEPS}
        step={1}
        aria-valuetext={`${Math.round(rps).toLocaleString("en-US")} requests per second`}
        onValueChange={([v]) =>
          setTrafficPattern({
            kind: "constant",
            rps: sliderToRps(v / SLIDER_STEPS, MIN_RPS, MAX_RPS),
          })
        }
      />
      <div className="flex justify-between font-mono text-[10px] text-zinc-400">
        <span>10</span>
        <span>1k</span>
        <span>100k</span>
        <span>1M</span>
      </div>
    </div>
  );
}

/**
 * Live traffic controls (Spec 06, TRF-01..03) for the Sim panel: playback,
 * speed, clock, live RPS and the load pattern editor.
 */
export function TrafficControls() {
  const pattern = useRuntimeStore((s) => s.pattern);
  const playback = useRuntimeStore((s) => s.playback);
  const patternTime = useRuntimeStore((s) => s.patternTimeSec);

  return (
    <section aria-label="Live traffic" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Live traffic</p>
        <SimClock />
      </div>
      <PlaybackBar />
      <LiveReadouts />
      <RpsSlider />
      <PatternEditor
        pattern={pattern}
        onChange={setTrafficPattern}
        playheadSec={playback === "idle" ? null : patternTime}
      />
    </section>
  );
}
