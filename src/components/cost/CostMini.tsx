"use client";

import { Wallet } from "lucide-react";
import { formatMoney } from "@/cost/currency";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useCostEstimate } from "./useCostEstimate";

/**
 * Compact live $/month and $/1M requests for the top bar; opens the Cost tab.
 * 2xl and up only: below that the problem selector needs the room (the Cost
 * tab has the same numbers).
 */
export function CostMini() {
  const hasComponents = useCanvasStore((s) => s.nodes.some((n) => n.type !== "text"));
  if (!hasComponents) return null;
  return <CostChip />;
}

function CostChip() {
  const currency = useAppStore((s) => s.currency);
  const { estimate, perMillion } = useCostEstimate();
  const open = () => {
    const app = useAppStore.getState();
    if (!app.rightPanelOpen) app.toggleRightPanel();
    app.setActiveRightTab("cost");
  };
  const monthly = formatMoney(estimate.monthly, currency, true);
  const perM = perMillion === null ? null : formatMoney(perMillion, currency);
  return (
    <button
      type="button"
      onClick={open}
      data-testid="cost-mini"
      className="hidden h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 font-mono text-[11px] tabular-nums text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 2xl:flex"
      title={`Estimated cost: ${monthly}/month${perM ? ` · ${perM} per 1M requests` : ""} (open the Cost tab)`}
      aria-label={`Estimated cost ${monthly} per month${perM ? `, ${perM} per million requests` : ""}`}
    >
      <Wallet className="h-3 w-3 text-emerald-400" aria-hidden />
      <span>{monthly}/mo</span>
      {perM && <span className="text-zinc-400">· {perM}/1M</span>}
    </button>
  );
}
