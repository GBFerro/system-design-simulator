"use client";

import { useId, useMemo, useState } from "react";
import { Bomb, HeartPulse, Play, Zap } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { compileGraph } from "@/domain/graph/compile";
import {
  CACHE_WARM_TAUS,
  edgeTargets,
  FAULT_CATALOG,
  FAULT_CATEGORIES,
  getFaultType,
  nodeTargets,
  type IntensitySpec,
} from "@/engine/faults/catalog";
import type { FaultRecord, FaultSpec, FaultType } from "@/engine/faults/types";
import { formatClock } from "@/components/traffic/format";
import { healFault, injectFault, togglePlayback } from "@/components/traffic/simActions";
import { topologySignature } from "@/lib/topology";
import { useCanvasStore } from "@/store/canvasStore";
import { useChaosStore } from "@/store/chaosStore";
import { useRuntimeStore } from "@/store/runtimeStore";

const inputClass =
  "h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50";

export function formatIntensity(v: number, spec: IntensitySpec): string {
  switch (spec.format) {
    case "percent":
      return `${Math.round(v * 100)}%`;
    case "multiplier":
      return `×${v}`;
    case "ms":
      return `+${v} ms`;
    case "sec":
      return `${v} s`;
    default:
      return String(v);
  }
}

/** The canvas compiled for target lists; recompiled only when the topology changes. */
function useCanvasGraph() {
  const signature = useCanvasStore((s) => topologySignature(s.nodes, s.edges));
  return useMemo(() => {
    const { nodes, edges } = useCanvasStore.getState();
    return signature === "" ? null : compileGraph(nodes, edges);
  }, [signature]);
}

/** The one selected node or edge, as a fault target key ("node:id" / "edge:id"). */
function useSelectedTargetKey(): string | null {
  return useCanvasStore((s) => {
    const nodes = s.nodes.filter((n) => n.selected);
    const edges = s.edges.filter((e) => e.selected);
    if (nodes.length === 1 && edges.length === 0) return `node:${nodes[0].id}`;
    if (edges.length === 1 && nodes.length === 0) return `edge:${edges[0].id}`;
    return null;
  });
}

/**
 * Chaos panel (Spec 08, CHS-01): pick a fault from the catalog, a target,
 * intensity and duration, inject it into the live run, and heal it. Faults
 * never edit the graph; they only exist while a simulation is loaded.
 */
export function ChaosPanel() {
  const playback = useRuntimeStore((s) => s.playback);
  const live = playback !== "idle";
  const graph = useCanvasGraph();
  const selectedKey = useSelectedTargetKey();

  const [type, setType] = useState<FaultType>("kill-node");
  const spec = getFaultType(type)!;
  /** The user's pick in the Target list, and the canvas selection it was made under. */
  const [pick, setPick] = useState<{ key: string; under: string | null }>({ key: "", under: null });
  const [intensity, setIntensity] = useState<number | null>(null);
  const [autoHeal, setAutoHeal] = useState(true);
  const [duration, setDuration] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const ids = { target: useId(), duration: useId(), intensity: useId(), heal: useId() };

  const options = useMemo(() => {
    if (!graph) return [];
    const out: { key: string; label: string }[] = [];
    if (spec.targets.includes("global")) out.push({ key: "global", label: "All traffic" });
    for (const n of nodeTargets(spec, graph)) out.push({ key: `node:${n.id}`, label: n.label });
    const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
    for (const e of edgeTargets(spec, graph))
      out.push({ key: `edge:${e.id}`, label: `${name(e.source)} → ${name(e.target)}` });
    return out;
  }, [graph, spec]);

  // A pick sticks while the canvas selection it was made under stays; a new
  // selection that is a valid target wins; otherwise the pick, else the first.
  const valid = (key: string) => options.some((o) => o.key === key);
  const targetKey =
    pick.under === selectedKey && valid(pick.key)
      ? pick.key
      : selectedKey && valid(selectedKey)
        ? selectedKey
        : valid(pick.key)
          ? pick.key
          : (options[0]?.key ?? "");

  const pickType = (t: FaultType) => {
    setType(t);
    setIntensity(null);
    setDuration("");
    setAutoHeal(true);
  };

  const value = intensity ?? spec.intensity?.default ?? 0;
  const defaultDuration = spec.defaultDurationSec;
  const durationSec = duration === "" ? defaultDuration : Number(duration);
  const validDuration =
    durationSec === undefined || (Number.isFinite(durationSec) && durationSec > 0);

  const inject = async () => {
    if (!targetKey) return;
    const [kind, ...rest] = targetKey.split(":");
    const fault: FaultSpec = {
      type,
      target:
        kind === "global"
          ? { kind: "global" }
          : { kind: kind as "node" | "edge", id: rest.join(":") },
      ...(spec.intensity ? { intensity: value } : {}),
      ...(autoHeal && durationSec !== undefined ? { durationSec } : {}),
      ...(!autoHeal ? { autoHeal: false } : {}),
    };
    setBusy(true);
    await injectFault(fault);
    setBusy(false);
  };

  return (
    <section aria-label="Chaos engineering" className="space-y-4" data-testid="chaos-panel">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Chaos</p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          Break the running system and watch the blast radius. Faults change the simulation only —
          never your design.
        </p>
      </div>

      {!live && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-950/20 px-2.5 py-2">
          <p className="flex-1 text-[11px] leading-snug text-amber-200">
            Faults act on a live run. Start the simulation first.
          </p>
          <button
            type="button"
            onClick={togglePlayback}
            className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-cyan-600 px-2.5 text-xs font-medium text-white hover:bg-cyan-500"
          >
            <Play className="h-3.5 w-3.5" /> Play
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {FAULT_CATEGORIES.map((cat) => (
          <div key={cat.id} role="group" aria-label={`${cat.label} faults`}>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">{cat.label}</p>
            <div className="grid grid-cols-2 gap-1">
              {FAULT_CATALOG.filter((f) => f.category === cat.id).map((f) => (
                <button
                  key={f.type}
                  type="button"
                  aria-pressed={type === f.type}
                  onClick={() => pickType(f.type)}
                  className={`min-h-8 rounded-md border px-2 py-1 text-left text-[11px] leading-tight transition-colors ${
                    type === f.type
                      ? "border-orange-500/60 bg-orange-500/10 text-orange-200"
                      : "border-zinc-700/70 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
        <p className="text-[11px] leading-snug text-zinc-300">{spec.description}</p>

        <div className="space-y-1">
          <label htmlFor={ids.target} className="block text-[11px] text-zinc-400">
            Target
          </label>
          <select
            id={ids.target}
            value={targetKey}
            onChange={(e) => setPick({ key: e.target.value, under: selectedKey })}
            disabled={options.length === 0}
            className={inputClass}
            data-testid="chaos-target"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {options.length === 0 && (
            <p className="text-[11px] text-zinc-400">
              {graph
                ? (spec.targetHint ?? "Nothing on the canvas can take this fault.")
                : "Add components first."}
            </p>
          )}
        </div>

        {spec.intensity && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={ids.intensity} className="text-[11px] text-zinc-400">
                {spec.intensity.label}
              </label>
              <span className="font-mono text-xs text-orange-300">
                {formatIntensity(value, spec.intensity)}
              </span>
            </div>
            <Slider
              id={ids.intensity}
              value={[value]}
              min={spec.intensity.min}
              max={spec.intensity.max}
              step={spec.intensity.step}
              aria-valuetext={formatIntensity(value, spec.intensity)}
              onValueChange={([v]) => setIntensity(v)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-zinc-300" htmlFor={ids.heal}>
            <input
              id={ids.heal}
              type="checkbox"
              checked={autoHeal}
              onChange={(e) => setAutoHeal(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Heal automatically
          </label>
          {autoHeal && defaultDuration !== undefined && (
            <div className="flex items-center gap-2">
              <label htmlFor={ids.duration} className="shrink-0 text-[11px] text-zinc-400">
                after
              </label>
              <input
                id={ids.duration}
                type="number"
                inputMode="decimal"
                min={1}
                step={5}
                placeholder={String(defaultDuration)}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={`${inputClass} font-mono`}
                aria-invalid={!validDuration || undefined}
              />
              <span className="text-[11px] text-zinc-400">s (simulated)</span>
            </div>
          )}
          {autoHeal && defaultDuration === undefined && (
            <p className="text-[11px] text-zinc-400">
              Ends by itself once the cache is warm again ({CACHE_WARM_TAUS}τ).
            </p>
          )}
          {!autoHeal && <p className="text-[11px] text-zinc-400">Stays until you heal it.</p>}
        </div>

        <button
          type="button"
          onClick={inject}
          disabled={!live || !targetKey || !validDuration || busy}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-rose-600 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="chaos-inject"
        >
          <Zap className="h-3.5 w-3.5" /> Inject fault
        </button>
      </div>

      <FaultList />
    </section>
  );
}

function FaultList() {
  const faults = useChaosStore((s) => s.faults);
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  const active = faults.filter((f) => f.active);
  const ended = faults.filter((f) => !f.active).reverse();
  if (faults.length === 0) return null;

  return (
    <div className="space-y-3">
      {active.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Active ({active.length})
          </p>
          <ul className="space-y-1.5" data-testid="chaos-active">
            {active.map((f) => (
              <FaultRow key={f.id} fault={f} now={simTime} />
            ))}
          </ul>
        </div>
      )}
      {ended.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            This run
          </p>
          <ul className="space-y-1">
            {ended.map((f) => (
              <li
                key={f.id}
                className="flex items-baseline justify-between gap-2 rounded-md bg-zinc-800/50 px-2 py-1.5"
              >
                <span className="min-w-0 truncate text-[11px] text-zinc-300" title={f.label}>
                  {f.label}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                  {formatClock(f.startT)}–{formatClock(f.endT ?? f.startT)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FaultRow({ fault, now }: { fault: FaultRecord; now: number }) {
  const remaining = fault.endT !== undefined ? Math.max(0, fault.endT - now) : undefined;
  return (
    <li className="rounded-md border border-orange-500/30 bg-orange-950/20 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <Bomb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium leading-snug text-orange-100">{fault.label}</p>
          <p className="font-mono text-[10px] text-zinc-400">
            since {formatClock(fault.startT)} ·{" "}
            {remaining !== undefined ? `heals in ${Math.ceil(remaining)}s` : "until healed"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => healFault(fault.id)}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 px-2 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/10"
          aria-label={`Heal ${fault.label}`}
        >
          <HeartPulse className="h-3.5 w-3.5" /> Heal
        </button>
      </div>
      {fault.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-5">
          {fault.notes.map((n) => (
            <li key={n} className="text-[10px] leading-snug text-zinc-400">
              {n}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
