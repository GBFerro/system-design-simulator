/**
 * Steady state under one fault (Spec 09 scoring: "availability measured in
 * the drill", outside an interview). The fault is compiled at t = 0 and its
 * modifiers are read at the end of its window, after the transients a live
 * run would show (a load balancer's detection window, a database failover),
 * so this measures whether the design survives the fault, not the seconds
 * it takes to notice it.
 */
import type { SimGraph } from "@/domain/graph/compile";
import { analyze, resolveConfig } from "../analyze";
import type { SimConfig, SteadyState } from "../types";
import { compileFault } from "./compile";
import { effectsAt } from "./effects";
import type { FaultSpec } from "./types";

/** Faults without a duration are read this long after they start. */
export const DEFAULT_STEADY_FAULT_SEC = 60;

export type SteadyUnderFault =
  | { ok: true; steady: SteadyState; label: string }
  | { ok: false; error: string };

export function analyzeUnderFault(
  graph: SimGraph,
  rps: number,
  fault: FaultSpec,
  config?: SimConfig,
): SteadyUnderFault {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const { readRatio } = resolveConfig(graph, byId, config);
  const compiled = compileFault(fault, 0, { graph, readRatio });
  if (!compiled.ok) return compiled;
  const end = compiled.endT ?? fault.durationSec ?? DEFAULT_STEADY_FAULT_SEC;
  // Just before the end: modifiers are active while t < endT.
  const effects = effectsAt(compiled.modifiers, Math.max(0, end - 1e-3));
  return { ok: true, steady: analyze(graph, rps, config, effects), label: compiled.label };
}
