"use client";

import { useEffect, useState } from "react";
import { useMotionStore } from "@/store/motionStore";
import { openTool } from "@/store/openTool";
import { Wallet } from "lucide-react";
import { formatMoney } from "@/cost/currency";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useCostEstimate } from "./useCostEstimate";

/**
 * Compact live $/month for the top bar ($/1M requests in its tooltip); opens
 * the Cost tab. Only from 1680 px: below that the problem selector needs the
 * room (smoke.spec.ts measures it), and the Cost tab has the same numbers.
 */
export function CostMini() {
  const hasComponents = useCanvasStore((s) => s.nodes.some((n) => n.type !== "text"));
  if (!hasComponents) return null;
  return <CostChip />;
}

/** How long the chip's flash lasts: its animation (600 ms) and a margin, under a second. */
const FLASH_MS = 700;

function CostChip() {
  const currency = useAppStore((s) => s.currency);
  const { estimate, perMillion } = useCostEstimate();
  const open = () => {
    const app = useAppStore.getState();
    if (!app.rightPanelOpen) app.toggleRightPanel();
    openTool("cost");
  };
  const monthly = formatMoney(estimate.monthly, currency, true);
  // A brief flash when an add changed the figure (motionStore's mark is set by the add and only
  // then: a load, a reference, a quick fix or reduced motion never flash).
  const [seen, setSeen] = useState<number | null>(null);
  const [flash, setFlash] = useState(0); // 0: off; each flash has its own number
  if (seen !== estimate.monthly) {
    setSeen(estimate.monthly);
    if (useMotionStore.getState().node) setFlash(flash + 1);
  }
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(0), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  const perM = perMillion === null ? null : formatMoney(perMillion, currency);
  return (
    <button
      type="button"
      onClick={open}
      data-testid="cost-mini"
      data-flash={flash > 0 ? "" : undefined}
      className="hidden h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 font-mono text-[11px] tabular-nums text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 min-[1680px]:flex"
      title={`Estimated cost: ${monthly}/month${perM ? ` · ${perM} per 1M requests` : ""} (open the Cost tab)`}
      aria-label={`Estimated cost ${monthly} per month${perM ? `, ${perM} per million requests` : ""}`}
    >
      <Wallet className="h-3 w-3 text-emerald-400" aria-hidden />
      <span>{monthly}/mo</span>
    </button>
  );
}
