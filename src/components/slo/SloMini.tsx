"use client";

import { Flame, Gauge } from "lucide-react";
import { formatBurn } from "@/slo/slo";
import { FAST_BURN_RATE, type Slo } from "@/slo/types";
import { useAppStore } from "@/store/appStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useEffectiveSlo } from "@/store/sloStore";
import { useSloEvaluation } from "./useSloEvaluation";

/**
 * Error budget left, compact, for the top bar while a run exists (Spec 11,
 * SLO-02); opens the SLO tab. Only from 1680 px, like the cost chip: below
 * that the problem selector needs the room (smoke.spec.ts measures it).
 */
export function SloMini() {
  const live = useRuntimeStore((s) => s.playback !== "idle");
  const slo = useEffectiveSlo();
  if (!live || !slo) return null;
  return <SloChip slo={slo} />;
}

function SloChip({ slo }: { slo: Slo }) {
  const ev = useSloEvaluation(slo);
  if (!ev?.hasData) return null;
  const remaining = Math.max(0, 1 - ev.budgetUsed);
  const fast = ev.burnRate >= FAST_BURN_RATE;
  const tone =
    ev.verdict === "violated"
      ? "text-rose-300"
      : remaining < 0.5 || fast
        ? "text-amber-300"
        : "text-emerald-300";
  const open = () => {
    const app = useAppStore.getState();
    if (!app.rightPanelOpen) app.toggleRightPanel();
    app.setActiveRightTab("slo");
  };
  const label = `Error budget ${Math.round(remaining * 100)}% left, burn rate ${formatBurn(ev.burnRate)}${
    ev.verdict === "violated" ? ", SLO violated" : ""
  }`;
  return (
    <button
      type="button"
      onClick={open}
      data-testid="slo-mini"
      className={`hidden h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 font-mono text-[11px] tabular-nums transition-colors hover:bg-zinc-800 min-[1680px]:flex ${tone}`}
      title={`${label} (open the SLO tab)`}
      aria-label={label}
    >
      {fast ? <Flame className="h-3 w-3" aria-hidden /> : <Gauge className="h-3 w-3" aria-hidden />}
      <span>{Math.round(remaining * 100)}%</span>
    </button>
  );
}
