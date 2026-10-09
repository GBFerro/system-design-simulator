"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CapacityCalculator } from "@/components/panel/CapacityCalculator";
import { ProblemBrief } from "@/components/panel/ProblemBrief";
import { LearningPath } from "@/components/sidebar/LearningPath";
import { ProblemSelector } from "@/components/sidebar/ProblemSelector";
import { getProblemById } from "@/data/problems";
import { useAppStore } from "@/store/appStore";

const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wider text-zinc-500";

/**
 * The Problem step, full screen (WIZ-07): pick the problem, read its statement,
 * size it with Capacity, and see the learning path. The canvas is hidden, not
 * unmounted work: a live run keeps going behind it (WIZ-31).
 */
export function ProblemStep({ onCreateProblem }: { onCreateProblem?: () => void }) {
  const selectedProblemId = useAppStore((s) => s.selectedProblemId);
  const problem = getProblemById(selectedProblemId);
  const [left, setLeft] = useState<"problems" | "path">("problems");
  const tab = (id: typeof left, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={left === id}
      onClick={() => setLeft(id)}
      className={`h-7 flex-1 rounded-md px-3 text-xs font-medium transition-colors ${
        left === id ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main
      data-testid="problem-step"
      className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 md:overflow-hidden"
    >
      <div className="mx-auto grid h-full max-w-[1500px] grid-cols-1 gap-px bg-zinc-800 md:grid-cols-[320px_minmax(0,1fr)_340px]">
        <section className="flex min-h-[28rem] flex-col bg-zinc-900 md:min-h-0">
          <div
            role="tablist"
            aria-label="Problems"
            className="m-2 flex shrink-0 gap-1 rounded-lg bg-zinc-800 p-1"
          >
            {tab("problems", "Problems")}
            {tab("path", "Learning path")}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {left === "problems" ? (
              <ProblemSelector onCreateProblem={onCreateProblem} />
            ) : (
              <LearningPath />
            )}
          </div>
        </section>

        <section className="min-h-[24rem] bg-zinc-900 md:min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-5 pb-16">
              <div>
                <p className={SECTION_TITLE}>Problem</p>
                <h1 className="mt-1 text-xl font-semibold text-zinc-100">
                  {problem?.title ?? "Pick a problem"}
                </h1>
                {problem && <p className="mt-1 text-sm text-zinc-400">{problem.description}</p>}
              </div>
              {problem ? (
                <ProblemBrief problem={problem} />
              ) : (
                <p className="text-sm text-zinc-400">
                  Choose a problem on the left to read its requirements.
                </p>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="min-h-[24rem] bg-zinc-900 md:min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-5 pb-16">
              <p className={SECTION_TITLE}>Capacity</p>
              <CapacityCalculator />
            </div>
          </ScrollArea>
        </section>
      </div>
    </main>
  );
}
