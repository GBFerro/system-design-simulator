"use client";

import { useId, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Clock,
  Flame,
  Loader2,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { INTERVIEW_DATA } from "@/data/interviewData";
import type { Problem } from "@/types/problem";
import { breaches } from "@/interview/drill";
import { effectivePeak } from "@/interview/checks";
import { useInterviewStore } from "@/store/interviewStore";
import { useDrillStore, type DrillStepState } from "@/store/drillStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { formatMs, formatPercent, formatRps } from "@/components/traffic/format";
import { SpeedToggle } from "@/components/traffic/SpeedToggle";
import { TimeSeriesChart, type ChartMarker } from "@/components/panel/TimeSeriesChart";
import { startDrill } from "./drillDriver";

/**
 * Phase 6 failure drill (Spec 09): the "interviewer" breaks the running
 * system with the problem's scripted faults; the candidate mitigates by
 * editing the canvas live and writes an answer. Each fault ends with the
 * reference answer and the incident: when the SLO broke, when the candidate
 * acted and when it recovered.
 */
export function DrillPanel({ problem }: { problem: Problem | undefined }) {
  const status = useDrillStore((s) => s.status);
  const drillProblem = useDrillStore((s) => s.problemId);
  const steps = useDrillStore((s) => s.steps);
  const abortReason = useDrillStore((s) => s.abortReason);
  const estimates = useInterviewStore((s) => s.answers.estimates);
  const data = problem ? INTERVIEW_DATA.find((d) => d.problemId === problem.id) : undefined;
  if (!problem || !data) return null;

  // Same load the drill runs at: the estimated peak, within 2× of the reference.
  const peak = effectivePeak(estimates, problem);
  const ours = drillProblem === problem.id;
  const running = ours && status === "running";

  return (
    <section aria-label="Failure drill" className="space-y-3" data-testid="drill-panel">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Flame className="h-3.5 w-3.5 text-orange-400" aria-hidden /> Failure drill
        </p>
        <p className="text-[11px] leading-snug text-zinc-400">
          Your design runs at your estimated peak while the interviewer breaks it{" "}
          {data.drill.length} times, without warning. Edit the canvas live to mitigate and answer
          each question.
        </p>
        <dl className="grid grid-cols-3 gap-1.5 pt-1">
          <Fact label="Load" value={`${formatRps(peak)} rps`} />
          <Fact label="SLO p99" value={`≤ ${problem.requirements.latencyMs} ms`} />
          <Fact label="SLO errors" value="≤ 1%" />
        </dl>
      </div>

      {(!ours || status === "idle") && (
        <button
          type="button"
          onClick={() => void startDrill(problem.id)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-orange-600 text-xs font-medium text-white hover:bg-orange-500"
          data-testid="drill-start"
        >
          <Play className="h-3.5 w-3.5" /> Start failure drill
        </button>
      )}

      {ours && status === "aborted" && (
        <div className="space-y-2 rounded-md border border-amber-500/25 bg-amber-950/20 px-2.5 py-2">
          <p className="text-[11px] text-amber-200">Drill stopped: {abortReason}</p>
          <RestartButton problemId={problem.id} />
        </div>
      )}

      {running && <LiveStatus />}

      {ours && status !== "idle" && (
        <ol className="space-y-2" data-testid="drill-steps">
          {steps.map((step, i) => (
            <StepCard key={i} index={i} step={step} total={steps.length} />
          ))}
        </ol>
      )}

      {ours && status === "done" && <Summary steps={steps} problemId={problem.id} />}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-zinc-800/70 px-2 py-1.5">
      <dt className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</dt>
      <dd className="truncate font-mono text-[11px] text-zinc-100">{value}</dd>
    </div>
  );
}

function RestartButton({ problemId }: { problemId: string }) {
  return (
    <button
      type="button"
      onClick={() => void startDrill(problemId)}
      className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 text-[11px] text-zinc-200 hover:bg-zinc-800"
    >
      <RotateCcw className="h-3.5 w-3.5" /> Restart drill
    </button>
  );
}

/** Live SLO state, clock and speed while the drill runs. */
function LiveStatus() {
  const global = useRuntimeStore((s) => s.latest?.global);
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  const slo = useDrillStore((s) => s.slo);
  const broken = global && slo ? breaches({ global }, slo) : false;
  return (
    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${broken ? "text-rose-400" : "text-emerald-400"}`}
          data-testid="drill-slo"
        >
          {broken ? (
            <CircleX className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <CircleCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          SLO {broken ? "broken" : "OK"}
        </span>
        <span className="font-mono text-[11px] text-zinc-300">
          p99 {formatMs(global?.p99 ?? 0)} · err {formatPercent(global?.errorRate ?? 0)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400">
          <Clock className="h-3 w-3" aria-hidden /> {simTime.toFixed(0)} s simulated
        </span>
        <SpeedToggle label="Drill speed" size="sm" />
      </div>
    </div>
  );
}

function StepCard({ index, step, total }: { index: number; step: DrillStepState; total: number }) {
  const simTime = useRuntimeStore((s) => s.simTimeSec);
  const setAnswer = useDrillStore((s) => s.setAnswer);
  const answerId = useId();
  const title = `Fault ${index + 1} of ${total}`;

  if (step.phase === "pending" || step.phase === "injecting") {
    const waiting = Number.isFinite(step.at) ? Math.max(0, step.at - simTime) : undefined;
    return (
      <li className="rounded-md border border-zinc-800 px-2.5 py-2 text-[11px] text-zinc-400">
        <span className="font-medium text-zinc-300">{title}</span> ·{" "}
        {step.phase === "injecting" ? (
          <Loader2 className="inline h-3 w-3 animate-spin" aria-label="Injecting" />
        ) : waiting !== undefined ? (
          `in ${Math.ceil(waiting)} s`
        ) : (
          "after the previous one"
        )}
      </li>
    );
  }
  if (step.phase === "skipped") {
    return (
      <li className="rounded-md border border-zinc-800 px-2.5 py-2 text-[11px] text-zinc-400">
        {title} · skipped: nothing in the design to apply it to.
      </li>
    );
  }

  const live = step.phase === "active" || step.phase === "recovering";
  return (
    <li
      className={`space-y-2 rounded-md border px-2.5 py-2 ${
        live ? "border-orange-500/40 bg-orange-950/20" : "border-zinc-800 bg-zinc-900/40"
      }`}
      data-drill-step={step.phase}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-orange-100">
          {title} · {step.label}
        </p>
        {step.phase === "active" && step.endT !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-zinc-400">
            heals in {Math.ceil(Math.max(0, step.endT - simTime))} s
          </span>
        )}
        {step.phase === "recovering" && (
          <span className="shrink-0 text-[10px] text-zinc-400">healed · watching recovery</span>
        )}
      </div>
      {step.resolved && (
        <>
          <p className="text-xs leading-snug text-zinc-100">{step.resolved.question}</p>
          {step.resolved.note && (
            <p className="flex gap-1 text-[10px] leading-snug text-amber-300">
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden /> {step.resolved.note}
            </p>
          )}
        </>
      )}
      <div className="space-y-1">
        <label htmlFor={answerId} className="block text-[10px] text-zinc-400">
          Your answer
        </label>
        <textarea
          id={answerId}
          value={step.answerText}
          onChange={(e) => setAnswer(index, e.target.value)}
          rows={live ? 3 : 2}
          readOnly={!live}
          placeholder={live ? "What's happening, and what do you change?" : undefined}
          className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
        />
      </div>
      {step.phase === "done" && step.result && <StepResult step={step} />}
    </li>
  );
}

function StepResult({ step }: { step: DrillStepState }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const r = step.result!;
  const rel = (t?: number) => (t === undefined ? "—" : `+${Math.round(t - r.startT)} s`);
  const markers: ChartMarker[] = [
    { t: r.startT, kind: "start" },
    { t: r.endT, kind: "end" },
    ...(r.firstActionT !== undefined ? [{ t: r.firstActionT, kind: "action" as const }] : []),
    ...(r.recoveredT !== undefined ? [{ t: r.recoveredT, kind: "recovered" as const }] : []),
  ];
  const incident = step.incident ?? [];
  const times = incident.map((p) => p.t);

  return (
    <div className="space-y-2" data-testid="drill-result">
      <p
        className={`flex items-center gap-1 text-[11px] font-medium ${r.mitigated ? "text-emerald-400" : "text-rose-400"}`}
      >
        {r.mitigated ? (
          <CircleCheck className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <CircleX className="h-3.5 w-3.5" aria-hidden />
        )}
        {r.mitigated ? "SLO held before the fault ended" : "SLO still broken when the fault ended"}
      </p>
      {r.brokenBefore && (
        <p className="text-[10px] leading-snug text-amber-300">
          The SLO was already broken before this fault: the design doesn&apos;t hold the peak load.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <Metric label="SLO broke" value={r.brokenBefore ? "before" : rel(r.firstBreachT)} />
        <Metric label="You acted" value={rel(r.firstActionT)} />
        <Metric
          label="Recovered"
          value={r.firstBreachT === undefined ? "never broke" : rel(r.recoveredT)}
        />
        <Metric label="Error budget" value={formatBudget(r.budgetUsed)} bad={r.budgetUsed > 1} />
        <Metric label="Worst p99" value={formatMs(r.worstP99Ms)} />
        <Metric label="Worst errors" value={formatPercent(r.worstErrorRate)} />
      </dl>
      {incident.length > 1 && (
        <>
          <TimeSeriesChart
            title="Incident p99"
            values={incident.map((p) => p.p99)}
            times={times}
            color="#a78bfa"
            format={formatMs}
            markers={markers}
          />
          <TimeSeriesChart
            title="Incident error rate"
            values={incident.map((p) => p.errorRate)}
            times={times}
            color="#fb7185"
            format={formatPercent}
            markers={markers}
          />
          <p className="text-[10px] text-zinc-400">
            Markers: <span className="text-orange-400">fault</span> ·{" "}
            <span className="text-cyan-400">your first edit</span> ·{" "}
            <span className="text-lime-400">recovered</span> ·{" "}
            <span className="text-emerald-400">healed</span>
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => setShowAnswer((v) => !v)}
        aria-expanded={showAnswer}
        className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
      >
        {showAnswer ? "Hide" : "Show"} reference answer
      </button>
      {showAnswer && step.resolved && (
        <p className="rounded-md bg-zinc-800/70 px-2 py-1.5 text-[11px] leading-snug text-zinc-300">
          {step.resolved.answer}
        </p>
      )}
    </div>
  );
}

/** Share of the step's error budget burned: "40%", or "3.2×" once it's blown. */
function formatBudget(used: number): string {
  return used <= 1
    ? `${Math.round(used * 100)}%`
    : `${used < 10 ? used.toFixed(1) : Math.round(used)}×`;
}

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`font-mono ${bad ? "text-rose-400" : "text-zinc-200"}`}>{value}</dd>
    </div>
  );
}

function Summary({ steps, problemId }: { steps: DrillStepState[]; problemId: string }) {
  const done = steps.filter((s) => s.result);
  const mitigated = done.filter((s) => s.result!.mitigated).length;
  const reactions = done
    .map((s) =>
      s.result!.firstActionT !== undefined ? s.result!.firstActionT - s.result!.startT : undefined,
    )
    .filter((x): x is number => x !== undefined);
  const avgReaction = reactions.length
    ? reactions.reduce((a, b) => a + b, 0) / reactions.length
    : undefined;
  return (
    <div
      className="space-y-2 rounded-md border border-zinc-700 bg-zinc-800/50 px-2.5 py-2"
      data-testid="drill-summary"
    >
      <p className="text-xs font-semibold text-zinc-100">Drill complete</p>
      <p className="text-[11px] text-zinc-300">
        SLO held in {mitigated} of {done.length} faults
        {avgReaction !== undefined
          ? ` · you reacted after ${Math.round(avgReaction)} s on average`
          : ""}
        .
      </p>
      <RestartButton problemId={problemId} />
    </div>
  );
}
