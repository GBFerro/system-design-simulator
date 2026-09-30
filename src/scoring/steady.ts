/**
 * Small readers over the measured steady states for the scoring rules
 * (Spec 09). Light on purpose: rules import this, not `measure.ts` (which
 * pulls the drill scripts and is loaded on demand).
 */
import type { Node } from "@xyflow/react";
import type { NodeSteadyState, SteadyState } from "@/engine/types";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { Measurements } from "@/types/scoring";

/** Steady-state metrics of the given nodes (those the steady state has). */
export function metricsOf(
  steady: SteadyState,
  nodes: readonly Node<ComponentNodeData>[],
): { node: Node<ComponentNodeData>; m: NodeSteadyState }[] {
  const byId = new Map(steady.nodes.map((n) => [n.nodeId, n]));
  const out: { node: Node<ComponentNodeData>; m: NodeSteadyState }[] = [];
  for (const node of nodes) {
    const m = byId.get(node.id);
    if (m) out.push({ node, m });
  }
  return out;
}

/** "App Server (230%), SQL Database (95%)" — the hottest first. */
export function hottest(
  items: { node: Node<ComponentNodeData>; m: NodeSteadyState }[],
  over: number,
  max = 3,
): string {
  return items
    .filter((x) => x.m.utilization >= over)
    .sort((a, b) => b.m.utilization - a.m.utilization)
    .slice(0, max)
    .map((x) => `${x.node.data.label} (${Math.round(x.m.utilization * 100)}%)`)
    .join(", ");
}

/** Measured, but no request reached the design (no entry point): nothing to judge. */
export function noTraffic(m: Measurements | undefined): boolean {
  return m !== undefined && m.atPeak.offeredRps <= 0;
}

export const NO_TRAFFIC_FEEDBACK =
  "No request reaches the design: it needs an entry point (a Client, or a component with no incoming connections that calls the rest).";

export const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
export const ms = (v: number) => (v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);
export const rps = (v: number) =>
  v >= 1e6
    ? `${Math.round(v / 1e5) / 10}M`
    : v >= 1e3
      ? `${Math.round(v / 100) / 10}k`
      : `${Math.round(v)}`;
