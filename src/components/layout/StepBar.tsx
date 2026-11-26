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
  /** `vertical` stacks the steps (the stage layout's rail); the default is the row under the top bar. */
  orientation?: "horizontal" | "vertical";
  /** Vertical only: icons without text (the names stay for assistive tech). */
  collapsed?: boolean;
}

/**
 * The steps in order, the current one highlighted (WIZ-01). A step before the
 * current one is a button that goes back; one after it is not clickable, so
 * the only way ahead is Next (WIZ-05, WIZ-06). Below 768 px only the current
 * step's name, "n / total" and Back/Next remain (WIZ-13). In the stage layout
 * the rail holds it vertically, and collapsed to icons below 1280 px.
 */
export function StepBar({
  steps,
  current,
  onGo,
  onBack,
  onNext,
  trailing,
  label,
  orientation = "horizontal",
  collapsed = false,
}: StepBarProps) {
  const isMobile = useIsMobile();
  const last = steps.length - 1;
  const vertical = orientation === "vertical";
  const iconOnly = vertical && collapsed;
  const navButton =
    "flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const iconNav = iconOnly ? "justify-center !px-0 w-6" : "";
  const text = (t: string) => (iconOnly ? <span className="sr-only">{t}</span> : t);
  const controls = (
    <div
      className={`flex shrink-0 items-center gap-1.5 ${
        iconOnly ? "flex-col" : vertical ? "w-full [&>button]:flex-1 [&>button]:justify-center" : ""
      }`}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={current <= 0}
        className={`${navButton} ${iconNav} border-zinc-700 text-zinc-300 enabled:hover:bg-zinc-800`}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        {text("Back")}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={current >= last}
        className={`${navButton} ${iconNav} border-cyan-600/60 bg-cyan-600/20 text-cyan-300 enabled:hover:bg-cyan-600/30`}
      >
        {text("Next")}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );

  if (isMobile && !vertical) {
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
      {...(vertical ? { "data-orientation": "vertical" } : {})}
      {...(iconOnly ? { "data-collapsed": "" } : {})}
      className={
        vertical
          ? "flex flex-col gap-2"
          : "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/80 px-4"
      }
    >
      <ol className={vertical ? "flex flex-col gap-0.5" : "flex min-w-0 items-center gap-1"}>
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const reachable = i <= current;
          const hint = reachable
            ? iconOnly
              ? step.label
              : undefined
            : iconOnly
              ? `${step.label}: use Next to get here`
              : "Use Next to get here";
          return (
            <li key={step.id} className={`flex items-center ${vertical ? "w-full" : ""}`}>
              <button
                type="button"
                data-step={step.id}
                aria-current={active ? "step" : undefined}
                disabled={!reachable}
                onClick={() => onGo(i)}
                title={hint}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  vertical ? "w-full" : ""
                } ${iconOnly ? "justify-center !px-0" : ""} ${
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
                {text(step.label)}
              </button>
              {i < last && !vertical && (
                <ChevronRight className="mx-0.5 h-3 w-3 text-zinc-600" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      <div
        className={
          vertical
            ? `flex shrink-0 flex-col gap-3 ${iconOnly ? "items-center" : "items-stretch"}`
            : "flex shrink-0 items-center gap-3"
        }
      >
        {trailing}
        {controls}
      </div>
    </nav>
  );
}
