"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { CircleCheck, CircleX, Flame, RotateCcw } from "lucide-react";
import { getComponentById } from "@/data/components";
import type { SloEvaluation } from "@/slo/budget";
import {
  downtimePerMonth,
  formatAvailability,
  formatBurn,
  formatWindow,
  overridesFor,
} from "@/slo/slo";
import {
  AVAILABILITY_RANGE,
  BURN_WINDOW_SEC,
  FAST_BURN_RATE,
  SLO_PERCENTILES,
  THRESHOLD_RANGE_MS,
  type Sli,
  type Slo,
  type SloPercentile,
} from "@/slo/types";
import { formatClock, formatMs } from "@/components/traffic/format";
import { useSloEvaluation } from "@/components/slo/useSloEvaluation";
import { useAppStore } from "@/store/appStore";
import { useChaosStore } from "@/store/chaosStore";
import { useInterviewStore } from "@/store/interviewStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { baseSloOf, useEffectiveSlo, useSloStore } from "@/store/sloStore";

const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wider text-zinc-400";
const INPUT =
  "w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/50 disabled:cursor-not-allowed disabled:opacity-60";

const AVAILABILITY_OPTIONS = [0.99, 0.995, 0.999, 0.9995, 0.9999, 0.99999];
const WINDOW_OPTIONS = [60, 120, 300];
const SLI_LABEL: Record<Sli, string> = { availability: "Availability", latency: "Latency" };

/**
 * SLO and error budget (Spec 11): the problem's targets (editable outside an
 * interview, SLO-01), the budget left over the window and the burn rate while
 * the simulation runs, with fault markers and the verdict (SLO-02).
 */
export function SloPanel() {
  const problemId = useAppStore((s) => s.selectedProblemId);
  const interview = useInterviewStore((s) => s.mode === "interview");
  const slo = useEffectiveSlo();

  if (!slo) {
    return (
      <section aria-label="SLO" className="space-y-2" data-testid="slo-panel">
        <p className={SECTION_TITLE}>SLO</p>
        <p className="text-[11px] text-zinc-400">Pick a problem to see its SLO.</p>
      </section>
    );
  }

  return (
    <section aria-label="SLO" className="space-y-4" data-testid="slo-panel">
      <SloTargets problemId={problemId} slo={slo} locked={interview} />
      <SloBudget slo={slo} />
      <details className="text-[11px] leading-snug text-zinc-400">
        <summary className="cursor-pointer select-none hover:text-zinc-200">
          How the budget is computed
        </summary>
        <div className="mt-1 space-y-1">
          <p>
            Two indicators, each with its own error budget over the window: a failed request uses
            the <em>availability</em> budget (1 − {formatAvailability(slo.availability)}), and a
            successful one slower than {formatMs(slo.latency.thresholdMs)} uses the <em>latency</em>{" "}
            budget (a p{slo.latency.percentile} target lets {100 - slo.latency.percentile}% of
            requests be slower).
          </p>
          <p>
            Burn rate = bad share over the last {BURN_WINDOW_SEC} s ÷ the budget share: at 1× the
            budget lasts exactly the window; at {FAST_BURN_RATE}× it&apos;s gone in a tenth of it.
            The SLO is violated once either budget is used up.
          </p>
        </div>
      </details>
    </section>
  );
}

/* ---------- targets (SLO-01) ---------- */

function SloTargets({ problemId, slo, locked }: { problemId: string; slo: Slo; locked: boolean }) {
  const setOverrides = useSloStore((s) => s.setOverrides);
  const custom = useSloStore((s) => s.overrides[problemId] !== undefined);
  const base = baseSloOf(problemId);
  const ids = { pct: useId(), ms: useId(), avail: useId(), win: useId() };
  const scope = slo.latency.scope ? getComponentById(slo.latency.scope)?.label : undefined;

  const update = (next: Slo) => {
    if (!base) return;
    setOverrides(problemId, overridesFor(base, next));
  };
  const availabilityOptions = AVAILABILITY_OPTIONS.includes(slo.availability)
    ? AVAILABILITY_OPTIONS
    : [...AVAILABILITY_OPTIONS, slo.availability].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className={SECTION_TITLE}>SLO</p>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            custom && !locked ? "bg-cyan-500/15 text-cyan-300" : "bg-zinc-800 text-zinc-300"
          }`}
          data-testid="slo-source"
        >
          {locked ? "Interview: problem's SLO" : custom ? "Custom" : "Problem's SLO"}
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
        <label htmlFor={ids.pct} className="text-[11px] text-zinc-300">
          Latency
        </label>
        <div className="flex items-center gap-1.5">
          <select
            id={ids.pct}
            aria-label="Latency percentile"
            disabled={locked}
            value={slo.latency.percentile}
            onChange={(e) =>
              update({
                ...slo,
                latency: { ...slo.latency, percentile: Number(e.target.value) as SloPercentile },
              })
            }
            className={`${INPUT} w-auto`}
            data-testid="slo-percentile"
          >
            {SLO_PERCENTILES.map((p) => (
              <option key={p} value={p}>
                p{p}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-400">≤</span>
          <ThresholdInput
            key={slo.latency.thresholdMs}
            id={ids.ms}
            value={slo.latency.thresholdMs}
            disabled={locked}
            onCommit={(thresholdMs) => update({ ...slo, latency: { ...slo.latency, thresholdMs } })}
          />
          <span className="text-[11px] text-zinc-400">ms</span>
        </div>

        <label htmlFor={ids.avail} className="text-[11px] text-zinc-300">
          Availability
        </label>
        <select
          id={ids.avail}
          disabled={locked}
          value={slo.availability}
          onChange={(e) => update({ ...slo, availability: Number(e.target.value) })}
          className={INPUT}
          data-testid="slo-availability"
        >
          {availabilityOptions
            .filter((a) => a >= AVAILABILITY_RANGE.min && a <= AVAILABILITY_RANGE.max)
            .map((a) => (
              <option key={a} value={a}>
                {formatAvailability(a)} ({downtimePerMonth(a)} down)
              </option>
            ))}
        </select>

        <label htmlFor={ids.win} className="text-[11px] text-zinc-300">
          Window
        </label>
        <select
          id={ids.win}
          disabled={locked}
          value={slo.windowSec}
          onChange={(e) => update({ ...slo, windowSec: Number(e.target.value) })}
          className={INPUT}
          data-testid="slo-window"
        >
          {(WINDOW_OPTIONS.includes(slo.windowSec)
            ? WINDOW_OPTIONS
            : [...WINDOW_OPTIONS, slo.windowSec].sort((a, b) => a - b)
          ).map((w) => (
            <option key={w} value={w}>
              {w % 60 === 0 ? `${w / 60} min` : `${w} s`} simulated
            </option>
          ))}
        </select>
      </div>

      <p className="text-[11px] leading-snug text-zinc-400">
        {scope
          ? `Latency is the ${scope} hop's, as the problem states it.`
          : "Latency is end to end, over the synchronous path."}{" "}
        {locked
          ? "An interview is judged against the problem's SLO."
          : "Changes apply live and are saved with the design."}
      </p>

      {custom && !locked && (
        <button
          type="button"
          onClick={() => setOverrides(problemId, undefined)}
          className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
          data-testid="slo-reset"
        >
          <RotateCcw className="h-3 w-3" aria-hidden /> Back to the problem&apos;s SLO
        </button>
      )}
    </div>
  );
}

/** Threshold in ms: commits a valid value on blur or Enter, else snaps back. */
function ThresholdInput({
  id,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  // (keyed by the value: a new committed value remounts it with a fresh draft)
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v) && v >= THRESHOLD_RANGE_MS.min && v <= THRESHOLD_RANGE_MS.max) {
      if (v !== value) onCommit(v);
    } else setDraft(String(value));
  };
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={THRESHOLD_RANGE_MS.min}
      max={THRESHOLD_RANGE_MS.max}
      step="any"
      aria-label="Latency threshold (ms)"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${INPUT} w-20 font-mono`}
      data-testid="slo-threshold"
    />
  );
}

/* ---------- error budget (SLO-02) ---------- */

function SloBudget({ slo }: { slo: Slo }) {
  const playback = useRuntimeStore((s) => s.playback);
  const ev = useSloEvaluation(slo);

  if (!ev || !ev.hasData) {
    return (
      <div className="space-y-1.5" data-testid="slo-budget">
        <p className={SECTION_TITLE}>Error budget</p>
        <p className="rounded-md border border-zinc-700 bg-zinc-800/50 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">
          Play live traffic (Simulate tab, or <kbd className="font-mono">P</kbd>) to track the error
          budget over time; inject faults from the Chaos tab and watch it burn.
        </p>
      </div>
    );
  }

  const remaining = 1 - ev.budgetUsed;
  const fast = ev.burnRate >= FAST_BURN_RATE;
  return (
    <div className="space-y-2" data-testid="slo-budget">
      <p className={SECTION_TITLE}>Error budget</p>
      <Verdict ev={ev} running={playback === "running"} />

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-300">Left over the {formatWindow(slo.windowSec)} window</span>
          <span
            className={`font-mono ${remaining <= 0 ? "text-rose-300" : remaining < 0.5 ? "text-amber-300" : "text-zinc-200"}`}
            data-testid="slo-remaining"
          >
            {Math.round(Math.max(0, remaining) * 100)}%
          </span>
        </div>
        <div
          className="h-1.5 rounded-full bg-zinc-800"
          role="meter"
          aria-label="Error budget left"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.max(0, remaining) * 100)}
        >
          <div
            className={`h-1.5 rounded-full ${remaining <= 0 ? "bg-rose-500" : remaining < 0.5 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.max(0, Math.min(1, remaining)) * 100}%` }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-2 text-[11px]">
          {(["availability", "latency"] as const).map((sli) => (
            <div key={sli} className="flex justify-between gap-1">
              <dt className="text-zinc-400">{SLI_LABEL[sli]} used</dt>
              <dd
                className={`font-mono ${ev.consumed[sli] >= 1 ? "text-rose-300" : "text-zinc-300"}`}
              >
                {formatUsed(ev.consumed[sli])}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-300">Burn rate (last {BURN_WINDOW_SEC} s)</span>
        <span
          className={`flex items-center gap-1 font-mono ${fast ? "text-rose-300" : ev.burnRate > 1 ? "text-amber-300" : "text-zinc-200"}`}
          data-testid="slo-burn"
        >
          {fast && <Flame className="h-3 w-3" aria-label="Burning fast" />}
          {formatBurn(ev.burnRate)}
        </span>
      </div>

      <BurnChart ev={ev} />
    </div>
  );
}

function Verdict({ ev, running }: { ev: SloEvaluation; running: boolean }) {
  const violated = ev.verdict === "violated";
  return (
    <p
      className={`flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${
        violated
          ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      }`}
      data-testid="slo-verdict"
      data-verdict={ev.verdict}
    >
      {violated ? (
        <CircleX className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {violated && ev.breach ? (
          <>
            <strong>SLO violated</strong> at {formatClock(ev.breach.t)}:{" "}
            {SLI_LABEL[ev.breach.sli].toLowerCase()} budget used up.
          </>
        ) : (
          <>
            <strong>SLO met</strong>
            {running ? " so far" : ""} ({formatClock(ev.t)} simulated).
          </>
        )}
      </span>
    </p>
  );
}

/** Budget used: a percentage up to all of it, then how many budgets ("12×"). */
function formatUsed(used: number): string {
  return used <= 1 ? `${Math.round(used * 100)}%` : `${formatBurn(used)}`;
}

const CW = 240;
const CH = 56;

/** Burn rate over the run on a log scale, with 1× / 10× lines and the faults as bands. */
function BurnChart({ ev }: { ev: SloEvaluation }) {
  const faults = useChaosStore((s) => s.faults);
  const pts = ev.series;
  if (pts.length < 2) return null;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(1e-6, t1 - t0);
  const top = Math.log10(1 + Math.max(FAST_BURN_RATE * 3, ...pts.map((p) => p.burn)));
  const y = (burn: number) => CH - 1 - (Math.log10(1 + Math.max(0, burn)) / top) * (CH - 2);
  const x = (t: number) => ((t - t0) / span) * CW;
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.burn).toFixed(1)}`)
    .join(" ");
  const bands = faults
    .map((f) => ({ id: f.id, a: Math.max(t0, f.startT), b: Math.min(t1, f.endT ?? t1) }))
    .filter((f) => f.b > f.a);

  return (
    <div className="rounded-lg bg-zinc-800/70 px-3 py-2" data-testid="slo-burn-chart">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="metric-label text-[10px]">Burn rate</p>
        <p className="text-[10px] text-zinc-400">
          worst <span className="font-mono text-zinc-200">{formatBurn(ev.worstBurn)}</span>
        </p>
      </div>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="block h-14 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Burn rate over ${Math.round(span)} simulated seconds; worst ${formatBurn(ev.worstBurn)}${bands.length ? `, ${bands.length} fault${bands.length === 1 ? "" : "s"} marked` : ""}`}
      >
        {bands.map((f) => (
          <rect
            key={f.id}
            x={x(f.a)}
            y={0}
            width={Math.max(1, x(f.b) - x(f.a))}
            height={CH}
            fill="rgb(251 146 60 / 0.15)"
          />
        ))}
        {[1, FAST_BURN_RATE].map((v) => (
          <line
            key={v}
            x1={0}
            x2={CW}
            y1={y(v)}
            y2={y(v)}
            stroke={v === 1 ? "rgb(113 113 122)" : "rgb(244 63 94 / 0.6)"}
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={d}
          fill="none"
          stroke="#f472b6"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-0.5 flex justify-between text-[9px] leading-none text-zinc-400">
        <span>{formatClock(t0)}</span>
        <span>{formatClock(t1)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
        Dashed: <span className="text-zinc-300">1×</span> (budget lasts the window) and{" "}
        <span className="text-rose-300">{FAST_BURN_RATE}×</span> (fast burn)
        {bands.length > 0 && (
          <>
            {" "}
            · <span className="text-orange-300">shaded: faults</span>
          </>
        )}
        . Log scale.
      </p>
    </div>
  );
}
