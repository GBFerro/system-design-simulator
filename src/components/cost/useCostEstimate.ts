"use client";

import { useEffect, useMemo, useState } from "react";
import { costPerMillionRequests, estimateCost, type CostEstimate } from "@/cost/estimate";
import type { TickSnapshot } from "@/engine/types";
import { useCanvasStore } from "@/store/canvasStore";
import { useRuntimeStore } from "@/store/runtimeStore";

/** How often a live run refreshes the cost (Spec 10: 1 Hz during play). */
const COST_REFRESH_MS = 1000;

/**
 * The latest runtime snapshot, at most once per `intervalMs` (trailing, so
 * the last frame of a run always lands). A cleared store shows at once.
 */
function useThrottledSnapshot(intervalMs: number): TickSnapshot | null {
  const [snapshot, setSnapshot] = useState(() => useRuntimeStore.getState().latest);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      last = performance.now();
      setSnapshot(useRuntimeStore.getState().latest);
    };
    // A snapshot pushed between the first render and this effect.
    flush();
    const unsubscribe = useRuntimeStore.subscribe((s, prev) => {
      if (s.latest === prev.latest) return;
      const wait = intervalMs - (performance.now() - last);
      if (s.latest === null || wait <= 0) {
        if (timer) clearTimeout(timer);
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, wait);
      }
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
  return snapshot;
}

export interface LiveCost {
  estimate: CostEstimate;
  /** $ per million user requests; null without traffic. */
  perMillion: number | null;
  /** The load the request costs come from (null before any run). */
  snapshot: TickSnapshot | null;
}

/**
 * Cost of the active canvas at the latest simulated load (the Simulate
 * button's `analyze()` or the live run, refreshed at 1 Hz). Without a
 * snapshot only the fixed costs (instances, monthly fees) count.
 */
export function useCostEstimate(): LiveCost {
  const nodes = useCanvasStore((s) => s.nodes);
  const snapshot = useThrottledSnapshot(COST_REFRESH_MS);
  return useMemo(() => {
    const estimate = estimateCost(nodes, (id) => snapshot?.nodes[id]?.rpsIn ?? 0);
    const perMillion = snapshot
      ? costPerMillionRequests(estimate.monthly, snapshot.offeredRps)
      : null;
    return { estimate, perMillion, snapshot };
  }, [nodes, snapshot]);
}
