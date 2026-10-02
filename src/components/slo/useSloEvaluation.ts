"use client";

import { useMemo } from "react";
import { evaluateSlo, type SloEvaluation } from "@/slo/budget";
import type { Slo } from "@/slo/types";
import { useRuntimeStore } from "@/store/runtimeStore";

/**
 * One evaluation per pushed snapshot and SLO, shared by every reader (the SLO
 * panel and the top-bar chip evaluate the same history once).
 */
let cache: { version: number; key: string; value: SloEvaluation } | null = null;

/** Non-hook: the run's error budget against `slo`, as of the latest snapshot. */
export function sloEvaluationNow(slo: Slo): SloEvaluation {
  const { history, historyVersion } = useRuntimeStore.getState();
  const key = JSON.stringify(slo);
  if (cache && cache.version === historyVersion && cache.key === key) return cache.value;
  const value = evaluateSlo(history.toArray(), slo);
  cache = { version: historyVersion, key, value };
  return value;
}

/**
 * The run's error budget against `slo`, re-evaluated on every snapshot push:
 * mount it only where it's shown (the SLO tab, the chip while a run exists).
 */
export function useSloEvaluation(slo: Slo | null): SloEvaluation | null {
  const version = useRuntimeStore((s) => s.historyVersion);
  // `version` is the change signal for the mutable ring buffer.
  return useMemo(() => (slo && version >= 0 ? sloEvaluationNow(slo) : null), [slo, version]);
}
