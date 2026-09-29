"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  PATTERN_KINDS,
  PATTERN_LABELS,
  baseRateOf,
  defaultPattern,
  sanitizePattern,
} from "@/engine/traffic/patterns";
import type { TrafficPattern, TrafficPatternKind } from "@/engine/traffic/types";
import { PatternPreview } from "./PatternPreview";

const inputClass =
  "h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 font-mono text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none";

/**
 * Number input that commits every valid value as you type (live), but lets
 * the field be empty or half-typed without snapping back until blur.
 */
function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  unit,
  scale = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Display multiplier (e.g. 100 to edit a 0–1 fraction as %). */
  scale?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * scale * 1000) / 1000);
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-[11px] text-zinc-400">
        {label}
        {unit && <span className="text-zinc-400"> ({unit})</span>}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min * scale}
        max={max !== undefined ? max * scale : undefined}
        step={step}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v)) onCommit(v / scale);
        }}
        onBlur={() => setDraft(null)}
        className={inputClass}
      />
    </div>
  );
}

/** Pattern selector with the fields of each kind and a λ(t) preview (TRF-03). */
export function PatternEditor({
  pattern,
  onChange,
  playheadSec,
}: {
  pattern: TrafficPattern;
  onChange: (p: TrafficPattern) => void;
  playheadSec: number | null;
}) {
  const selectId = useId();
  const set = (patch: Record<string, unknown>) =>
    onChange(sanitizePattern({ ...pattern, ...patch }));

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <label htmlFor={selectId} className="block text-[11px] text-zinc-400">
          Load pattern
        </label>
        <select
          id={selectId}
          value={pattern.kind}
          onChange={(e) =>
            onChange(defaultPattern(e.target.value as TrafficPatternKind, baseRateOf(pattern)))
          }
          className={inputClass}
        >
          {PATTERN_KINDS.map((k) => (
            <option key={k} value={k}>
              {PATTERN_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {pattern.kind === "constant" && (
        <NumberField
          label="Load"
          unit="rps"
          value={pattern.rps}
          step={100}
          onCommit={(v) => set({ rps: v })}
        />
      )}

      {pattern.kind === "ramp" && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="From"
            unit="rps"
            value={pattern.fromRps}
            step={100}
            onCommit={(v) => set({ fromRps: v })}
          />
          <NumberField
            label="To"
            unit="rps"
            value={pattern.toRps}
            step={100}
            onCommit={(v) => set({ toRps: v })}
          />
          <NumberField
            label="Over"
            unit="s"
            value={pattern.durationSec}
            min={1}
            onCommit={(v) => set({ durationSec: v })}
          />
        </div>
      )}

      {pattern.kind === "spike" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Base"
            unit="rps"
            value={pattern.baseRps}
            step={100}
            onCommit={(v) => set({ baseRps: v })}
          />
          <NumberField
            label="Multiplier"
            unit="×"
            value={pattern.multiplier}
            step={0.5}
            onCommit={(v) => set({ multiplier: v })}
          />
          <NumberField
            label="Starts at"
            unit="s"
            value={pattern.startSec}
            onCommit={(v) => set({ startSec: v })}
          />
          <NumberField
            label="Lasts"
            unit="s"
            value={pattern.durationSec}
            min={1}
            onCommit={(v) => set({ durationSec: v })}
          />
        </div>
      )}

      {pattern.kind === "diurnal" && (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Mean"
            unit="rps"
            value={pattern.meanRps}
            step={100}
            onCommit={(v) => set({ meanRps: v })}
          />
          <NumberField
            label="Swing"
            unit="%"
            value={pattern.amplitude}
            scale={100}
            max={1}
            step={5}
            onCommit={(v) => set({ amplitude: v })}
          />
          <NumberField
            label="Day ="
            unit="s"
            value={pattern.periodSec}
            min={1}
            step={10}
            onCommit={(v) => set({ periodSec: v })}
          />
        </div>
      )}

      {pattern.kind === "steps" && (
        <div className="space-y-1.5">
          {pattern.steps.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <NumberField
                label={`Step ${i + 1} at`}
                unit="s"
                value={s.atSec}
                onCommit={(v) =>
                  set({ steps: pattern.steps.map((x, j) => (j === i ? { ...x, atSec: v } : x)) })
                }
              />
              <NumberField
                label="Load"
                unit="rps"
                value={s.rps}
                step={100}
                onCommit={(v) =>
                  set({ steps: pattern.steps.map((x, j) => (j === i ? { ...x, rps: v } : x)) })
                }
              />
              <button
                type="button"
                onClick={() => set({ steps: pattern.steps.filter((_, j) => j !== i) })}
                disabled={pattern.steps.length <= 1}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-rose-400 disabled:opacity-40"
                aria-label={`Remove step ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {pattern.steps.length < 50 && (
            <button
              type="button"
              onClick={() => {
                const last = pattern.steps[pattern.steps.length - 1];
                set({
                  steps: [
                    ...pattern.steps,
                    { atSec: (last?.atSec ?? 0) + 30, rps: last?.rps ?? 1000 },
                  ],
                });
              }}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-cyan-400 transition-colors hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add step
            </button>
          )}
        </div>
      )}

      <PatternPreview pattern={pattern} playheadSec={playheadSec} />
    </div>
  );
}
