import { create } from "zustand";
import type { Edge, Node } from "@xyflow/react";
import { applyAllFixes, applyFix, computeFindings, readRatioFor } from "@/advisor/advisor";
import { applyDiff, describeParamPatch, isEmptyDiff } from "@/advisor/graph";
import {
  SEVERITY_RANK,
  type AdvisorContext,
  type Finding,
  type GraphDiff,
  type QuickFix,
  type Severity,
} from "@/advisor/types";
import { getProblemById } from "@/data/problems";
import { topologySignature } from "@/lib/topology";
import type { TickSnapshot } from "@/engine/types";
import { useAppStore } from "./appStore";
import { useCanvasStore, type ComponentNodeData } from "./canvasStore";
import { useRuntimeStore } from "./runtimeStore";
import { useSimulationStore } from "./simulationStore";

/**
 * Advisor findings for the active canvas (Spec 12). NOT persisted: derived
 * from `canvasStore` (structure, params, rules), the last run's load
 * (`runtimeStore`, averaged over the last few simulated seconds and read at
 * most once a second), the problem's read mix and the last score while it
 * still describes the design. Recomputed only when one of those changes —
 * never on a drag. Nodes read their own worst severity with
 * `useNodeFindingSeverity(id)`; the canvas draws the previewed fix from
 * `preview` (ghost nodes/edges) and `useNodePreviewChange(id)` — a finding's
 * fix, or any other quick fix (a fault's mitigation, Spec 08 CHS-06).
 */
export interface AdvisorPreview {
  /** A finding id, or the caller's key for another fix (a mitigation). */
  key: string;
  /** True when `key` is a finding: its fix is looked up again as findings change. */
  fromFinding: boolean;
  fix: QuickFix;
  label: string;
  diff: GraphDiff;
  /** What the fix changes on existing nodes, by node id ("×1 → ×3"). */
  changes: Record<string, string>;
}

interface AdvisorState {
  findings: Finding[];
  /** Worst severity per node id. */
  byNode: Record<string, Severity>;
  /** The fix drawn on the canvas before it's applied (ADV-02). */
  preview: AdvisorPreview | null;
  /**
   * Bumped whenever an input of `advisorContext()` or the design changes:
   * what anything computed from the context (mitigations) depends on.
   */
  contextVersion: number;
}

export const useAdvisorStore = create<AdvisorState>(() => ({
  findings: [],
  byNode: {},
  preview: null,
  contextVersion: 0,
}));

function worstByNode(findings: Finding[]): Record<string, Severity> {
  const out: Record<string, Severity> = {};
  for (const f of findings) {
    for (const id of f.targetIds) {
      const prev = out[id];
      if (!prev || SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev]) out[id] = f.severity;
    }
  }
  return out;
}

/** What the findings depend on in the graph: the topology plus params and edge rules. */
function designSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  let sig = topologySignature(nodes, edges);
  for (const n of nodes) {
    if (n.type !== "text") sig += JSON.stringify((n.data as ComponentNodeData).params);
  }
  for (const e of edges) sig += JSON.stringify((e.data as { rule?: unknown } | undefined)?.rule);
  return sig;
}

/* ---------- load from the last run ---------- */

/** Simulated seconds of the live run the load is averaged over (smooths per-tick noise). */
export const LOAD_WINDOW_SEC = 5;
/** How often a live run refreshes the load-based findings. */
const LOAD_REFRESH_MS = 1000;

/**
 * Mean `rpsIn` per node over the newest snapshots of the current run (the
 * trailing stretch where the clock only goes back, within LOAD_WINDOW_SEC);
 * a Simulate snapshot (t = 0) stands alone.
 */
export function recentLoad(
  history: readonly TickSnapshot[],
  latest: TickSnapshot | null,
): Record<string, number> | undefined {
  if (!latest) return undefined;
  const window: TickSnapshot[] = [latest];
  for (let i = history.length - 1; i >= 0 && latest.t > 0; i--) {
    const s = history[i];
    const prev = window[window.length - 1];
    if (s === latest) continue;
    if (s.t >= prev.t || s.t < latest.t - LOAD_WINDOW_SEC) break;
    window.push(s);
  }
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const s of window) {
    for (const [id, m] of Object.entries(s.nodes)) {
      sum[id] = (sum[id] ?? 0) + m.rpsIn;
      count[id] = (count[id] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.keys(sum).map((id) => [id, sum[id] / count[id]]));
}

let load: Record<string, number> | undefined;
let loadVersion = 0;

function readLoad(): void {
  const { history, latest } = useRuntimeStore.getState();
  load = recentLoad(history.toArray(), latest);
  loadVersion++;
}

/* ---------- context and refresh ---------- */

/** The score's design signature when it was computed (it's dropped once the design changes). */
let scoredSignature: string | null = null;
let scoreVersion = 0;

function currentContext(nodes: readonly Node[], signature: string): AdvisorContext {
  const score = useSimulationStore.getState().scoreResult;
  return {
    load,
    readRatio: readRatioFor(nodes, getProblemById(useAppStore.getState().selectedProblemId)),
    score: score && scoredSignature === signature ? score : null,
  };
}

/** What the advisor reads right now (the run's load, the read mix, the score): for mitigations. */
export function advisorContext(): AdvisorContext {
  const { nodes, edges } = useCanvasStore.getState();
  return currentContext(nodes, designSignature(nodes, edges));
}

let lastKey: string | null = null;

/** Recompute when an input changed (idempotent otherwise). */
export function refreshAdvisor(): void {
  const { nodes, edges } = useCanvasStore.getState();
  const signature = designSignature(nodes, edges);
  const problemId = useAppStore.getState().selectedProblemId;
  const scored =
    useSimulationStore.getState().scoreResult !== null && scoredSignature === signature;
  const key = `${signature}\n${loadVersion}\n${problemId}\n${scored ? scoreVersion : "-"}`;
  if (key === lastKey) return;
  lastKey = key;
  const findings = computeFindings({ nodes, edges }, currentContext(nodes, signature));
  useAdvisorStore.setState((s) => ({
    findings,
    byNode: worstByNode(findings),
    preview: refreshedPreview(s.preview, findings),
    contextVersion: s.contextVersion + 1,
  }));
}

/** Hide the previewed fix. */
export function clearPreview(): void {
  useAdvisorStore.setState({ preview: null });
}

/** The preview against the current graph; null when the fix no longer changes anything. */
function previewOf(
  key: string,
  fix: QuickFix | undefined,
  fromFinding: boolean,
): AdvisorPreview | null {
  if (!fix) return null;
  const { nodes, edges } = useCanvasStore.getState();
  const diff = fix.preview({ nodes, edges });
  if (isEmptyDiff(diff)) return null;
  const changes: Record<string, string> = {};
  for (const [id, patch] of Object.entries(diff.nodeParams)) {
    const node = nodes.find((n) => n.id === id);
    if (node) changes[id] = describeParamPatch(node.data as ComponentNodeData, patch);
  }
  return { key, fromFinding, fix, label: fix.label, diff, changes };
}

function refreshedPreview(prev: AdvisorPreview | null, findings: Finding[]): AdvisorPreview | null {
  if (!prev) return null;
  return prev.fromFinding
    ? previewOf(prev.key, findings.find((f) => f.id === prev.key)?.fix, true)
    : previewOf(prev.key, prev.fix, false);
}

/** Draw a finding's fix on the canvas (null hides it). */
export function setAdvisorPreview(findingId: string | null): void {
  const fix = findingId
    ? useAdvisorStore.getState().findings.find((f) => f.id === findingId)?.fix
    : undefined;
  useAdvisorStore.setState({ preview: findingId ? previewOf(findingId, fix, true) : null });
}

/** Draw any quick fix on the canvas under `key` (a fault's mitigation); null hides it. */
export function setFixPreview(key: string, fix: QuickFix | null): void {
  useAdvisorStore.setState({ preview: fix ? previewOf(key, fix, false) : null });
}

/** Apply a quick fix as one undo step, recomputed on the current graph (no-op on a read-only tab). */
export function applyQuickFix(fix: QuickFix): void {
  useAdvisorStore.setState({ preview: null });
  useCanvasStore.getState().applyGraphEdit((graph) => {
    const diff = fix.preview(graph);
    return isEmptyDiff(diff) ? null : applyDiff(graph, diff);
  });
}

/** Apply what's previewed. */
export function applyPreview(): void {
  const preview = useAdvisorStore.getState().preview;
  if (!preview) return;
  if (preview.fromFinding) applyFinding(preview.key);
  else applyQuickFix(preview.fix);
}

/** Apply one finding's fix as one undo step (no-op on a read-only tab). */
export function applyFinding(findingId: string): void {
  const { nodes, edges } = useCanvasStore.getState();
  const ctx = currentContext(nodes, designSignature(nodes, edges));
  useAdvisorStore.setState({ preview: null });
  useCanvasStore.getState().applyGraphEdit((graph) => applyFix(graph, findingId, ctx));
}

/** Apply every fix in sequence (most severe first, each recomputed) as one undo step. */
export function applyAllFindings(): void {
  const { nodes, edges } = useCanvasStore.getState();
  const ctx = currentContext(nodes, designSignature(nodes, edges));
  const ids = useAdvisorStore
    .getState()
    .findings.filter((f) => f.fix)
    .map((f) => f.id);
  useAdvisorStore.setState({ preview: null });
  useCanvasStore.getState().applyGraphEdit((graph) => applyAllFixes(graph, ctx, ids));
}

readLoad();
refreshAdvisor();

useCanvasStore.subscribe((s, prev) => {
  if (s.activeTabId !== prev.activeTabId) useAdvisorStore.setState({ preview: null });
  if (s.nodes !== prev.nodes || s.edges !== prev.edges) refreshAdvisor();
});
useAppStore.subscribe((s, prev) => {
  if (s.selectedProblemId !== prev.selectedProblemId) refreshAdvisor();
});
useSimulationStore.subscribe((s, prev) => {
  if (s.scoreResult === prev.scoreResult) return;
  const { nodes, edges } = useCanvasStore.getState();
  scoredSignature = s.scoreResult ? designSignature(nodes, edges) : null;
  scoreVersion++;
  refreshAdvisor();
});

// Load: at once when the run is cleared, else at most once a second (trailing).
let lastLoadAt = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
function flushLoad(): void {
  loadTimer = null;
  lastLoadAt = Date.now();
  readLoad();
  refreshAdvisor();
}
useRuntimeStore.subscribe((s, prev) => {
  if (s.latest === prev.latest) return;
  const wait = LOAD_REFRESH_MS - (Date.now() - lastLoadAt);
  if (s.latest === null || wait <= 0) {
    if (loadTimer) clearTimeout(loadTimer);
    flushLoad();
  } else if (!loadTimer) {
    loadTimer = setTimeout(flushLoad, wait);
  }
});

export function useNodeFindingSeverity(nodeId: string): Severity | undefined {
  return useAdvisorStore((s) => s.byNode[nodeId]);
}

/** What the previewed fix changes on this node ("×1 → ×3"), if anything. */
export function useNodePreviewChange(nodeId: string): string | undefined {
  return useAdvisorStore((s) => s.preview?.changes[nodeId]);
}
