/**
 * The advisor (Spec 12): every finding for a design, and applying quick
 * fixes — one, or all of them in sequence (each recomputed on the graph the
 * previous one left, most severe first). Pure: the store runs it and the
 * canvas store applies the result as one undo step.
 */
import type { Node } from "@xyflow/react";
import { defaultParams, numParam, PARAM } from "@/domain/components/registry";
import type { Problem } from "@/types/problem";
import type { ComponentNodeData } from "@/store/canvasStore";
import { applyDiff, isEmptyDiff } from "./graph";
import { loadFindings } from "./load";
import { patternFindings } from "./patterns";
import { scoreFindings } from "./score";
import { structureHints } from "./structure";
import { byPriority, type AdvisorContext, type CanvasGraph, type Finding } from "./types";
import { viewOf } from "./view";

export function computeFindings(graph: CanvasGraph, ctx: AdvisorContext): Finding[] {
  const view = viewOf(graph);
  const structure = structureHints(view);
  const reachable = !structure.some((f) => f.id === "no-entry");
  return [
    ...structure,
    ...(reachable ? [...loadFindings(view, ctx), ...patternFindings(view, ctx)] : []),
    ...scoreFindings(ctx.score),
  ].sort(byPriority);
}

/** The graph after one finding's fix, or null when it has none (or it's gone). */
export function applyFix(
  graph: CanvasGraph,
  findingId: string,
  ctx: AdvisorContext,
): CanvasGraph | null {
  const fix = computeFindings(graph, ctx).find((f) => f.id === findingId)?.fix;
  if (!fix) return null;
  const diff = fix.preview(graph);
  return isEmptyDiff(diff) ? null : applyDiff(graph, diff);
}

/**
 * Apply every fix of `findingIds` (default: every finding that has one), most
 * severe first, each recomputed on the graph the previous fix left — a fix
 * whose finding the earlier ones resolved is skipped. Null if nothing applies.
 */
export function applyAllFixes(
  graph: CanvasGraph,
  ctx: AdvisorContext,
  findingIds?: readonly string[],
): CanvasGraph | null {
  const wanted = new Set(
    findingIds ??
      computeFindings(graph, ctx)
        .filter((f) => f.fix)
        .map((f) => f.id),
  );
  let current = graph;
  let changed = false;
  // Each pass takes one id out of `wanted`, so this ends.
  while (wanted.size > 0) {
    const next = computeFindings(current, ctx).find((f) => f.fix && wanted.has(f.id));
    if (!next) break;
    wanted.delete(next.id);
    const diff = next.fix!.preview(current);
    if (isEmptyDiff(diff)) continue;
    current = applyDiff(current, diff);
    changed = true;
  }
  return changed ? current : null;
}

/** The share of reads: the problem's mix, else the Client's `readRatio`, else its default. */
export function readRatioFor(nodes: readonly Node[], problem?: Problem | null): number {
  const req = problem?.requirements;
  const total = req ? req.readsPerSec + req.writesPerSec : 0;
  if (req && total > 0) return req.readsPerSec / total;
  const client = nodes.find(
    (n) => (n.data as Partial<ComponentNodeData> | undefined)?.componentId === "client",
  );
  const fallback = Number(defaultParams("client")[PARAM.readRatio] ?? 0.9);
  return client ? numParam(client.data as ComponentNodeData, PARAM.readRatio, fallback) : fallback;
}
