"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";
import { PROBLEMS } from "@/data/problems";
import { useAppStore } from "@/store/appStore";
import { useCustomProblemsStore } from "@/store/customProblemsStore";

function getDifficultyColor(difficulty: string) {
  switch (difficulty) {
    case "Easy":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "Medium":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case "Hard":
      return "border-rose-500/30 bg-rose-500/10 text-rose-400";
    default:
      return "";
  }
}

interface ProblemSelectorProps {
  onCreateProblem?: () => void;
}

export function ProblemSelector({ onCreateProblem }: ProblemSelectorProps) {
  const selectedProblemId = useAppStore((s) => s.selectedProblemId);
  const setSelectedProblem = useAppStore((s) => s.setSelectedProblem);
  const customProblems = useCustomProblemsStore((s) => s.problems);
  const deleteProblem = useCustomProblemsStore((s) => s.deleteProblem);

  const handleDeleteCustom = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteProblem(id);
    // If the deleted problem was selected, switch to the first predefined problem
    if (selectedProblemId === id) {
      setSelectedProblem(PROBLEMS[0].id);
    }
    useAppStore.getState().showToast("Custom problem deleted", "info");
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-3">
        {/* Create Problem button */}
        <button
          onClick={onCreateProblem}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-600 px-2.5 py-2 text-left text-xs font-medium text-violet-400 transition-colors hover:border-violet-500/50 hover:bg-violet-500/5"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Custom Problem
        </button>

        {/* Custom problems — row is a div[role=button] so the delete X can be
            a real <button> (button-in-button is invalid HTML) */}
        {customProblems.map((problem) => (
          <div
            key={problem.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedProblem(problem.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedProblem(problem.id);
              }
            }}
            aria-pressed={problem.id === selectedProblemId}
            className={`group flex w-full cursor-pointer flex-col gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors ${
              problem.id === selectedProblemId
                ? "border border-zinc-700 bg-zinc-800"
                : "border border-transparent hover:bg-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={`flex-1 truncate text-xs font-medium ${
                  problem.id === selectedProblemId ? "text-cyan-500" : "text-zinc-300"
                }`}
              >
                {problem.title}
              </span>
              <div className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 border-violet-500/30 bg-violet-500/10 px-1.5 text-[11px] font-medium text-violet-400"
                >
                  Custom
                </Badge>
                <Badge
                  variant="outline"
                  className={`h-4 shrink-0 px-1.5 text-[11px] font-medium ${getDifficultyColor(
                    problem.difficulty,
                  )}`}
                >
                  {problem.difficulty}
                </Badge>
                <button
                  onClick={(e) => handleDeleteCustom(e, problem.id)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 opacity-60 transition-opacity hover:text-rose-400 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  title="Delete custom problem"
                  aria-label={`Delete custom problem ${problem.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {problem.tags.map((tag, i) => (
                <span key={tag} className="text-[11px] text-zinc-400">
                  {tag}
                  {i < problem.tags.length - 1 ? " ·" : ""}
                </span>
              ))}
            </div>
          </div>
        ))}

        {/* Separator if there are custom problems */}
        {customProblems.length > 0 && <div className="!my-2 h-px bg-zinc-800" />}

        {/* Predefined problems */}
        {PROBLEMS.map((problem) => (
          <button
            key={problem.id}
            onClick={() => setSelectedProblem(problem.id)}
            aria-pressed={problem.id === selectedProblemId}
            className={`flex w-full flex-col gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors ${
              problem.id === selectedProblemId
                ? "border border-zinc-700 bg-zinc-800"
                : "border border-transparent hover:bg-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-medium ${
                  problem.id === selectedProblemId ? "text-cyan-500" : "text-zinc-300"
                }`}
              >
                {problem.title}
              </span>
              <Badge
                variant="outline"
                className={`h-4 px-1.5 text-[11px] font-medium ${getDifficultyColor(
                  problem.difficulty,
                )}`}
              >
                {problem.difficulty}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {problem.tags.map((tag, i) => (
                <span key={tag} className="text-[11px] text-zinc-400">
                  {tag}
                  {i < problem.tags.length - 1 ? " ·" : ""}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
