"use client";

import { BookOpen, ChevronsLeft, ChevronsRight } from "lucide-react";
import { StepBar, type StepBarItem } from "./StepBar";

interface StageRailProps {
  /** The picked problem's title (the top bar's selector changes it). */
  problemTitle: string | undefined;
  /** Icons only (at most 56 px wide). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  steps: readonly StepBarItem[];
  current: number;
  onGo: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
  /** Label of the step bar for assistive tech. */
  label?: string;
}

/**
 * The stage layout's left card: the problem you are working on and the steps, stacked. The
 * problem is chosen in the top bar; here it only reminds you of it.
 */
export function StageRail({
  problemTitle,
  collapsed,
  onToggleCollapsed,
  steps,
  current,
  onGo,
  onBack,
  onNext,
  label,
}: StageRailProps) {
  const title = problemTitle ?? "No problem picked";
  const Toggle = collapsed ? ChevronsRight : ChevronsLeft;
  return (
    <div className={`flex flex-col gap-2 ${collapsed ? "items-center p-1.5" : "p-2.5"}`}>
      <div
        className={`flex w-full items-center gap-2 ${collapsed ? "flex-col" : "justify-between"}`}
      >
        <div
          data-testid="rail-problem"
          title={title}
          className="flex min-w-0 items-center gap-1.5 text-zinc-300"
        >
          <BookOpen className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          {collapsed ? (
            <span className="sr-only">{title}</span>
          ) : (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                Problem
              </p>
              <p className="line-clamp-2 text-xs font-medium leading-snug text-zinc-200">{title}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand steps" : "Collapse steps"}
          aria-expanded={!collapsed}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <Toggle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <StepBar
        orientation="vertical"
        collapsed={collapsed}
        steps={steps}
        current={current}
        onGo={onGo}
        onBack={onBack}
        onNext={onNext}
        label={label}
      />
    </div>
  );
}
