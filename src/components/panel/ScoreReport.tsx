"use client";

import { motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Trophy } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import type { CategoryScore } from "@/types/scoring";

/** Animate a number from 0 → target over ~1s, synced with the ring sweep. */
function useCountUp(target: number, durationMs = 1000) {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    // Respect reduced-motion: jump straight to the value (deferred via rAF so
    // we never call setState synchronously inside the effect body).
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = reduce ? 1 : Math.min((t - start) / durationMs, 1);
      // easeOut to match the ring's easing
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);
  return value;
}

function CategorySection({ category, index = 0 }: { category: CategoryScore; index?: number }) {
  const [expanded, setExpanded] = useState(false);
  const pct = (category.score / category.maxScore) * 100;

  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div className="rounded-md bg-zinc-800 px-3 py-2.5" data-category={category.category}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3 w-3 text-zinc-400" />
          )}
          <span className="text-xs font-medium text-zinc-300">{category.category}</span>
        </div>
        <span className="font-mono text-xs text-zinc-400">
          {category.score}/{category.maxScore}
        </span>
      </button>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-700/70">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.25 + index * 0.09 }}
        />
      </div>

      {expanded && (
        <div className="mt-3 space-y-1.5">
          {category.passed.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
              <span className="text-xs text-zinc-400">{item}</span>
            </div>
          ))}
          {category.feedback.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span className="text-xs text-zinc-400">{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const VERDICT_BORDER: Record<string, string> = {
  "text-emerald-400": "border-emerald-400/30",
  "text-cyan-400": "border-cyan-400/30",
  "text-blue-400": "border-blue-400/30",
  "text-amber-400": "border-amber-400/30",
  "text-rose-400": "border-rose-400/30",
  "text-zinc-500": "border-zinc-500/30",
};

const VERDICT_BG: Record<string, string> = {
  "text-emerald-400": "bg-emerald-400/5",
  "text-cyan-400": "bg-cyan-400/5",
  "text-blue-400": "bg-blue-400/5",
  "text-amber-400": "bg-amber-400/5",
  "text-rose-400": "bg-rose-400/5",
  "text-zinc-500": "bg-zinc-500/5",
};

function verdictBorderClass(verdictColor: string): string {
  return VERDICT_BORDER[verdictColor] ?? "border-zinc-500/30";
}

function verdictBgClass(verdictColor: string): string {
  return VERDICT_BG[verdictColor] ?? "bg-zinc-500/5";
}

export function ScoreReport() {
  const scoreResult = useSimulationStore((s) => s.scoreResult);
  const animatedTotal = useCountUp(scoreResult?.total ?? 0);

  if (!scoreResult) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700">
          <Trophy className="h-4 w-4 text-zinc-500" />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-300">Ready to evaluate</p>
          <p className="mt-1 max-w-[220px] text-xs text-zinc-500">
            Design your system on the canvas, then click{" "}
            <span className="text-cyan-500">Score</span> to see how you did
          </p>
        </div>
      </div>
    );
  }

  const topImprovements = scoreResult.categories.flatMap((c) => c.feedback).slice(0, 3);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1">
        {/* Overall score */}
        <div className="flex flex-col items-center gap-2 py-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="relative flex items-center justify-center"
          >
            {(() => {
              const radius = 38;
              const circumference = 2 * Math.PI * radius;
              const progress = (scoreResult.total / 100) * circumference;
              // Tier-tinted gradient (base → lighter sheen) gives the ring depth
              const tier =
                scoreResult.total >= 71
                  ? ["#059669", "#34d399"]
                  : scoreResult.total >= 51
                    ? ["#0891b2", "#22d3ee"]
                    : scoreResult.total >= 31
                      ? ["#d97706", "#fbbf24"]
                      : ["#dc2626", "#f87171"];
              return (
                <svg width="96" height="96" className="-rotate-90">
                  <defs>
                    <linearGradient id="scoreRing" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={tier[0]} />
                      <stop offset="100%" stopColor={tier[1]} />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="48"
                    cy="48"
                    r={radius}
                    fill="none"
                    stroke="rgb(39,39,42)"
                    strokeWidth="6"
                  />
                  <motion.circle
                    cx="48"
                    cy="48"
                    r={radius}
                    fill="none"
                    stroke="url(#scoreRing)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: circumference - progress }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    style={{ filter: `drop-shadow(0 0 6px ${tier[1]}66)` }}
                  />
                </svg>
              );
            })()}
            <div className="absolute flex flex-col items-center">
              <span className="font-mono text-3xl font-bold text-zinc-100 tabular-nums">
                {animatedTotal}
              </span>
              <span className="text-[11px] text-zinc-400">/ 100</span>
            </div>
          </motion.div>

          <Badge
            variant="outline"
            className={`${scoreResult.verdictColor} ${verdictBorderClass(scoreResult.verdictColor)} ${verdictBgClass(scoreResult.verdictColor)} px-3 py-0.5 text-xs font-semibold`}
          >
            {scoreResult.verdict}
          </Badge>

          <p className="text-center text-xs text-zinc-500">{scoreResult.summary}</p>
        </div>

        <Separator className="bg-zinc-800" />

        {/* Category breakdowns */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Categories</p>
          {scoreResult.categories.map((cat, i) => (
            <CategorySection key={cat.category} category={cat} index={i} />
          ))}
        </div>

        {/* Top improvements */}
        {topImprovements.length > 0 && (
          <>
            <Separator className="bg-zinc-800" />
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Top Improvements
              </p>
              {topImprovements.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md bg-zinc-800 border border-zinc-700 px-2.5 py-2"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[11px] font-bold text-zinc-300">
                    {i + 1}
                  </span>
                  <span className="text-xs text-zinc-400">{item}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
