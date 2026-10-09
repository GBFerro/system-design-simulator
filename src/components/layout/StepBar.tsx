"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/useBreakpoint";

export interface StepBarItem {
  /** Stable id (`data-step`). */
  id: string;
  label: string;
}

interface StepBarProps {
  steps: readonly StepBarItem[];
  /** Index of the current step. */
  current: number;
  /** Go to a step the user may reach: the current one or an earlier one. */
  onGo: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
  /** Extra controls at the right end (the interview's timer, Finish…). */
  trailing?: React.ReactNode;
  /** Label of the bar for assistive tech. */
  label?: string;
}

/**
 * The steps in order, the current one highlighted (WIZ-01). A step before the
 * current one is a button that goes back; one after it is not clickable, so
 * the only way ahead is Next (WIZ-05, WIZ-06). Below 768 px only the current
 * step's name, "n / total" and Back/Next remain (WIZ-13).
 */
export function StepBar({ steps, current, onGo, onBack, onNext, trailing, label }: StepBarProps) {
  const isMobile = useIsMobile();
  const last = steps.length - 1;
  const navButton =
    "flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const controls = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onBack}
        disabled={current <= 0}
        className={`${navButton} border-zinc-700 text-zinc-300 enabled:hover:bg-zinc-800`}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Back
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={current >= last}
        className={`${navButton} border-cyan-600/60 bg-cyan-600/20 text-cyan-300 enabled:hover:bg-cyan-600/30`}
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <nav
        aria-label={label ?? "Steps"}
        data-testid="step-bar"
        data-compact
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/80 px-4"
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span data-step-current className="truncate text-sm font-semibold text-zinc-100">
            {steps[current]?.label}
          </span>
          <span data-step-count className="font-mono text-xs text-zinc-400">
            {current + 1} / {steps.length}
          </span>
        </div>
        {controls}
      </nav>
    );
  }

  return (
    <nav
      aria-label={label ?? "Steps"}
      data-testid="step-bar"
      className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/80 px-4"
    >
      <ol className="flex min-w-0 items-center gap-1">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const reachable = i <= current;
          return (
            <li key={step.id} className="flex items-center">
              <button
                type="button"
                data-step={step.id}
                aria-current={active ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onGo(i)}
                title={reachable ? undefined : "Use Next to get here"}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-cyan-600/20 text-cyan-300"
                    : done
                      ? "text-zinc-300 hover:bg-zinc-800"
                      : "cursor-default text-zinc-400"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                    active
                      ? "bg-cyan-500 text-zinc-950"
                      : done
                        ? "bg-emerald-600/80 text-white"
                        : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {done ? <Check className="h-2.5 w-2.5" aria-hidden /> : i + 1}
                </span>
                {step.label}
              </button>
              {i < last && <ChevronRight className="mx-0.5 h-3 w-3 text-zinc-600" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <div className="flex shrink-0 items-center gap-3">
        {trailing}
        {controls}
      </div>
    </nav>
  );
}
