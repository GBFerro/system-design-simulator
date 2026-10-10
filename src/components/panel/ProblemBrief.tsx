"use client";

import { useState } from "react";
import { CheckSquare, ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/cost/currency";
import { useAppStore } from "@/store/appStore";
import type { Problem } from "@/types/problem";

function ConstraintsSection({ constraints }: { constraints: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? constraints : constraints.slice(0, 3);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Constraints</p>
      <div className="space-y-1.5">
        {shown.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <CheckSquare className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
            <span className="text-xs leading-relaxed text-zinc-400">{c}</span>
          </div>
        ))}
      </div>
      {constraints.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-cyan-500 transition-colors hover:text-cyan-400"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              Show {constraints.length - 3} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

function HintsSection({ hints }: { hints: { title: string; content: string }[] }) {
  const [expandedHints, setExpandedHints] = useState<Set<number>>(new Set());

  const toggleHint = (index: number) => {
    setExpandedHints((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Hints</p>
      <div className="space-y-1.5">
        {hints.map((hint, i) => (
          <div key={i} className="rounded-md border border-zinc-700 bg-zinc-800 overflow-hidden">
            <button
              onClick={() => toggleHint(i)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="flex-1 text-xs font-medium text-zinc-300">{hint.title}</span>
              {expandedHints.has(i) ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
              )}
            </button>
            {expandedHints.has(i) && (
              <div className="border-t border-zinc-700 px-2.5 py-2">
                <p className="text-xs leading-relaxed text-zinc-400">{hint.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The statement of a problem: its requirements, constraints and hints. Shown on
 * the Problem step and, as always, at the top of the Props tab.
 */
export function ProblemBrief({ problem }: { problem: Problem }) {
  const currency = useAppStore((s) => s.currency);
  return (
    <div className="space-y-4" data-testid="problem-brief">
      {
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Requirements — {problem.title}
          </p>
          <div className="space-y-1.5">
            {[
              {
                label: "Reads/sec",
                value: new Intl.NumberFormat("en-US").format(problem.requirements.readsPerSec),
              },
              {
                label: "Writes/sec",
                value: new Intl.NumberFormat("en-US").format(problem.requirements.writesPerSec),
              },
              {
                label: "Storage",
                value: `${new Intl.NumberFormat("en-US").format(problem.requirements.storageGB)} GB`,
              },
              { label: "Latency SLA", value: `< ${problem.requirements.latencyMs}ms` },
              { label: "Users", value: problem.requirements.users },
              ...(problem.requirements.budgetMonthlyUsd
                ? [
                    {
                      label: "Budget",
                      value: `${formatMoney(problem.requirements.budgetMonthlyUsd, currency)}/mo`,
                    },
                  ]
                : []),
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-md bg-zinc-800 px-2.5 py-1.5"
              >
                <span className="text-xs text-zinc-400">{item.label}</span>
                <span className="font-mono text-xs text-zinc-300">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      }

      {/* Constraints */}
      {problem && problem.constraints.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <ConstraintsSection constraints={problem.constraints} />
        </>
      )}

      {/* Hints */}
      {problem && problem.hints.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <HintsSection hints={problem.hints} />
        </>
      )}
    </div>
  );
}
