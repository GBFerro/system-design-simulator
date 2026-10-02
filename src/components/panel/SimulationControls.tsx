"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Gauge, Loader2 } from "lucide-react";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useSimulationStore } from "@/store/simulationStore";

const PRESETS = [
  { label: "Light", value: 1000 },
  { label: "Medium", value: 10000 },
  { label: "Heavy", value: 100000 },
  { label: "Stress", value: 500000 },
];

interface SimulationControlsProps {
  onAnalyze: () => void;
}

export function SimulationControls({ onAnalyze }: SimulationControlsProps) {
  const config = useSimulationStore((s) => s.config);
  const setConfig = useSimulationStore((s) => s.setConfig);
  const isRunning = useSimulationStore((s) => s.isRunning);
  // A live run owns the metrics: analyzing on top of it would overwrite them.
  const liveRun = useRuntimeStore((s) => s.playback !== "idle");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Steady-state analysis
        </p>
        <p className="text-[11px] text-zinc-400">
          Instant snapshot of the design at a fixed load, without running time.
        </p>
      </div>

      {/* Presets */}
      <div className="flex gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setConfig({ requestsPerSec: preset.value })}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              config.requestsPerSec === preset.value
                ? "bg-cyan-500/15 text-cyan-500"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs text-zinc-400">Requests/sec</label>
            <span className="font-mono text-xs text-cyan-500">
              {new Intl.NumberFormat("en-US").format(config.requestsPerSec)}
            </span>
          </div>
          <Slider
            value={[config.requestsPerSec]}
            onValueChange={(v) => setConfig({ requestsPerSec: Array.isArray(v) ? v[0] : v })}
            min={100}
            max={500000}
            step={100}
            className=""
          />
        </div>

        {/* Duration slider removed: the simulation engine performs a single-snapshot
            calculation (not a time-series simulation), so durationSec has no effect. */}
      </div>

      <Separator className="bg-zinc-800" />

      <Button
        onClick={onAnalyze}
        disabled={isRunning || liveRun}
        className="w-full gap-2 border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
        size="sm"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Analyzing…
          </>
        ) : (
          <>
            <Gauge className="h-3 w-3" />
            Analyze
          </>
        )}
      </Button>
      {liveRun && <p className="text-[11px] text-zinc-400">Stop the live simulation to analyze.</p>}
    </div>
  );
}
