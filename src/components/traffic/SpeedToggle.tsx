"use client";

import { SIM_SPEEDS } from "@/engine/traffic/types";
import { useRuntimeStore } from "@/store/runtimeStore";
import { setSimulationSpeed } from "./simActions";

const SIZE = {
  md: "h-8 min-w-9 px-2 text-xs",
  sm: "h-6 min-w-8 px-1.5 text-[11px]",
} as const;

/** Simulation speed (1×/5×/20×) as a pressed-button group; shared by the Sim panel and the drill. */
export function SpeedToggle({ label, size = "md" }: { label: string; size?: keyof typeof SIZE }) {
  const speed = useRuntimeStore((s) => s.speed);
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-zinc-800 p-0.5">
      {SIM_SPEEDS.map((x) => (
        <button
          key={x}
          type="button"
          onClick={() => setSimulationSpeed(x)}
          aria-pressed={speed === x}
          aria-label={`Speed ${x}×`}
          className={`${SIZE[size]} rounded font-mono transition-colors ${
            speed === x ? "bg-zinc-600 text-zinc-50" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {x}×
        </button>
      ))}
    </div>
  );
}
