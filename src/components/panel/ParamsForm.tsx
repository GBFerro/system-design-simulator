"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { parseParamInput, rangeText, toDisplay } from "@/domain/components/paramInput";
import type { ParamGroup, ParamSpec, ParamValue, Params } from "@/domain/components/types";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";

/**
 * Generic form for a list of `ParamSpec`s (Spec 03, CMP-01): the Props panel
 * of every component type and the edge rule editor are generated from their
 * specs — no per-type form is written by hand. Values are validated on
 * commit (blur / Enter / change); an invalid value falls back to the default.
 */

const GROUP_ORDER: (ParamGroup | "general")[] = [
  "general",
  "capacity",
  "latency",
  "resilience",
  "cost",
  "advanced",
];

const GROUP_LABEL: Record<ParamGroup | "general", string> = {
  general: "General",
  capacity: "Capacity",
  latency: "Latency",
  resilience: "Resilience",
  cost: "Cost",
  advanced: "Advanced",
};

const INPUT =
  "w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/50 disabled:cursor-not-allowed disabled:opacity-60";

interface FieldProps {
  spec: ParamSpec;
  value: ParamValue;
  onCommit: (key: string, value: ParamValue) => void;
  disabled?: boolean;
}

function NumberInput({
  spec,
  value,
  onCommit,
  disabled,
  id,
  describedBy,
  onRejected,
}: FieldProps & { id: string; describedBy?: string; onRejected: (msg: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = typeof value === "number" ? String(toDisplay(spec, value)) : "";
  const unit = spec.kind === "percent" ? "%" : spec.unit;

  const commit = () => {
    if (draft === null) return;
    const { value: next, rejected } = parseParamInput(spec, draft);
    setDraft(null);
    onRejected(rejected ? `Must be ${rangeText(spec)}; reset to the default.` : null);
    if (next !== value) onCommit(spec.key, next);
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-describedby={describedBy}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape" && draft !== null) {
            // First Escape reverts the edit; a second one reaches the menu/sheet
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className={`${INPUT} font-mono tabular-nums ${unit ? "pr-8" : ""}`}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-zinc-400">
          {unit}
        </span>
      )}
    </div>
  );
}

/** One labeled input for `spec`. Exported for the canvas context menu. */
export function ParamField({ spec, value, onCommit, disabled }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const coarse = useIsCoarsePointer();
  const [error, setError] = useState<string | null>(null);
  const describedBy = [spec.help && helpId, error && `${id}-error`].filter(Boolean).join(" ");

  let control;
  switch (spec.kind) {
    case "enum":
      control = (
        <select
          id={id}
          disabled={disabled}
          aria-describedby={describedBy || undefined}
          value={String(value)}
          onChange={(e) => onCommit(spec.key, e.target.value)}
          className={INPUT}
        >
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "boolean":
      control = (
        <button
          id={id}
          type="button"
          role="switch"
          aria-label={spec.label}
          aria-checked={value === true}
          aria-describedby={describedBy || undefined}
          disabled={disabled}
          onClick={() => onCommit(spec.key, value !== true)}
          className={`relative ml-auto flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            value === true ? "border-cyan-500/50 bg-cyan-600/40" : "border-zinc-700 bg-zinc-800"
          }`}
        >
          <span
            className={`absolute h-3.5 w-3.5 rounded-full transition-transform ${
              value === true ? "translate-x-[18px] bg-cyan-300" : "translate-x-[2px] bg-zinc-400"
            }`}
          />
        </button>
      );
      break;
    default:
      control = (
        <NumberInput
          spec={spec}
          value={value}
          onCommit={onCommit}
          disabled={disabled}
          id={id}
          describedBy={describedBy || undefined}
          onRejected={setError}
        />
      );
  }

  return (
    <div data-param={spec.key}>
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
        <label
          htmlFor={id}
          title={spec.help}
          className="flex min-w-0 items-center gap-1 text-xs text-zinc-400"
        >
          <span className="truncate">{spec.label}</span>
          {spec.help && !coarse && <Info aria-hidden className="h-3 w-3 shrink-0 text-zinc-500" />}
        </label>
        {control}
      </div>
      {spec.help && (
        <p
          id={helpId}
          className={coarse ? "mt-0.5 text-[11px] leading-snug text-zinc-400" : "sr-only"}
        >
          {spec.help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="status" className="mt-0.5 text-[11px] text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

interface ParamsFormProps {
  specs: readonly ParamSpec[];
  values: Params;
  onCommit: (key: string, value: ParamValue) => void;
  disabled?: boolean;
  /** Render group headings (component params); flat otherwise (edge rule). */
  grouped?: boolean;
}

export function ParamsForm({ specs, values, onCommit, disabled, grouped = true }: ParamsFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const visible = specs.filter((s) => !s.visibleIf || s.visibleIf(values));
  const field = (spec: ParamSpec) => (
    <ParamField
      key={spec.key}
      spec={spec}
      value={values[spec.key] ?? spec.default}
      onCommit={onCommit}
      disabled={disabled}
    />
  );

  if (!grouped) return <div className="space-y-2">{visible.map(field)}</div>;

  const byGroup = new Map<ParamGroup | "general", ParamSpec[]>();
  for (const spec of visible) {
    const group = spec.group ?? "general";
    byGroup.set(group, [...(byGroup.get(group) ?? []), spec]);
  }

  return (
    <div className="space-y-3">
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => {
        const items = byGroup.get(group)!;
        if (group === "advanced") {
          return (
            <div key={group} className="space-y-2">
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-300"
              >
                {advancedOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {GROUP_LABEL[group]} ({items.length})
              </button>
              {advancedOpen && <div className="space-y-2">{items.map(field)}</div>}
            </div>
          );
        }
        return (
          <div key={group} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {GROUP_LABEL[group]}
            </p>
            {items.map(field)}
          </div>
        );
      })}
    </div>
  );
}
