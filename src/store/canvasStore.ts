import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { useAppStore } from "./appStore";
import { useSimulationStore } from "./simulationStore";
import { useRuntimeStore } from "./runtimeStore";
import { safeLocalStorage } from "./safeStorage";
import { migrateCanvasState } from "./migrations";
import { STORE_VERSION } from "./persistVersion";
import { randomId } from "@/lib/nodeFactory";
import { findFreePosition, freePositionNear, nodeRect } from "@/lib/placement";
import {
  instancesOf,
  MAX_INSTANCES,
  PARAM,
  resolvedParams,
  sanitizeParams,
} from "@/domain/components/registry";
import type { EdgeRule, Params } from "@/domain/components/types";
import {
  applyEdgeRulePatch,
  canvasRuleGraph,
  connectEdgeRule,
  newEdgeData,
  sanitizeEdgeRule,
  splitReadsOnReplicaConnect,
  type EdgeProtocol,
  type EdgeRulePatch,
} from "@/domain/graph/edgeRules";

import {
  RETURN_SOURCE_HANDLE,
  isReturnEdge,
  makeReturnEdge,
  requestEdges,
  responseOf,
  responseToOf,
  returnData,
  returnIdOf,
} from "@/domain/graph/returns";

export { edgeRuleOf } from "@/domain/graph/edgeRules";

export interface ComponentNodeData {
  componentId: string;
  label: string;
  icon: string;
  category: string;
  scalable: boolean;
  /** Validated against the type's `ComponentSchema` (Spec 03). */
  params: Params;
  // Runtime metrics (utilization, status…) are NOT here: they live in
  // `runtimeStore`, keyed by node id (Spec 07).
  // ReactFlow v12 requires an index signature on custom node data types
  [key: string]: unknown;
}

export interface TextNodeData {
  text: string;
  fontSize?: "sm" | "base" | "lg";
  [key: string]: unknown;
}

export interface CustomEdgeData {
  label?: string;
  protocol?: EdgeProtocol;
  /** Call rule (Spec 03). Edges saved before v2 get one on migration. */
  rule?: EdgeRule;
  [key: string]: unknown;
}

export interface CanvasTab {
  id: string;
  label: string;
  nodes: Node[];
  edges: Edge[];
  readOnly?: boolean;
}

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

/** Cheap deep snapshot of just the structural canvas state. */
function snapshot(state: { nodes: Node[]; edges: Edge[] }): HistoryEntry {
  return JSON.parse(JSON.stringify({ nodes: state.nodes, edges: state.edges })) as HistoryEntry;
}

/**
 * Push the CURRENT (pre-mutation) state onto the undo stack and clear the
 * redo stack. Call this from inside `set` BEFORE applying a structural
 * mutation so that `undo()` restores the pre-change state.
 */
function pushedHistory(state: {
  nodes: Node[];
  edges: Edge[];
  history: HistoryEntry[];
}): HistoryEntry[] {
  return [...state.history, snapshot(state)].slice(-MAX_HISTORY);
}

/** Consecutive arrow-key nudges within this window share one undo step. */
const NUDGE_COALESCE_MS = 600;
let lastNudgeAt = 0;

function nudgeHistory(state: {
  nodes: Node[];
  edges: Edge[];
  history: HistoryEntry[];
}): HistoryEntry[] {
  const now = Date.now();
  const coalesce = now - lastNudgeAt < NUDGE_COALESCE_MS;
  lastNudgeAt = now;
  return coalesce ? state.history : pushedHistory(state);
}

/**
 * True when the active tab is a reference (read-only) tab. The one check for
 * "may the user edit this canvas": read it with `useIsActiveTabReadOnly()` in
 * render and `isActiveTabReadOnly(useCanvasStore.getState())` in handlers.
 */
export function isActiveTabReadOnly(state: { tabs: CanvasTab[]; activeTabId: string }): boolean {
  return state.tabs.find((t) => t.id === state.activeTabId)?.readOnly === true;
}

/**
 * ReactFlow changes that only touch view state (selection, measured size) and
 * so still apply on a read-only tab; removals, additions and replacements are
 * dropped there.
 */
function isViewChange(change: NodeChange | EdgeChange): boolean {
  return change.type === "select" || change.type === "dimensions";
}

/** On a read-only tab nodes can also be moved: layout only, never an undo entry. */
function isReadOnlyNodeChange(change: NodeChange): boolean {
  return isViewChange(change) || change.type === "position";
}

interface Clipboard {
  nodes: Node[];
  edges: Edge[];
}

/** Selected nodes plus every edge between two of them (deep copy). */
function selectionSubgraph(state: { nodes: Node[]; edges: Edge[] }): Clipboard {
  const nodes = state.nodes.filter((n) => n.selected);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = state.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return JSON.parse(JSON.stringify({ nodes, edges })) as Clipboard;
}

function boundingBox(nodes: Node[]) {
  const rects = nodes.map(nodeRect);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}

/**
 * Clone a subgraph with fresh ids, placed so its bounding box starts at the
 * first free spot (spiral search) near `targetTopLeft`. Clones come selected.
 */
function cloneSubgraph(clip: Clipboard, existing: Node[], targetTopLeft: XYPosition): Clipboard {
  const box = boundingBox(clip.nodes);
  const at = findFreePosition(
    targetTopLeft,
    { width: box.width, height: box.height },
    existing.map(nodeRect),
  );

  const idMap = new Map<string, string>();
  const nodes = clip.nodes.map((n) => {
    const prefix =
      n.type === "text" ? "text" : String((n.data as ComponentNodeData).componentId ?? "node");
    const id = `${prefix}-${randomId()}`;
    idMap.set(n.id, id);
    return {
      ...n,
      id,
      selected: true,
      dragging: false,
      position: { x: n.position.x - box.x + at.x, y: n.position.y - box.y + at.y },
    };
  });
  const requestIds = new Map<string, string>();
  const requests = clip.edges
    .filter((e) => !isReturnEdge(e))
    .map((e) => {
      const id = `e-${randomId()}`;
      requestIds.set(e.id, id);
      return {
        ...e,
        id,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        data: remapMissOf(e.data, idMap),
        selected: true,
      };
    });
  // A response follows its request (RET-28); one whose request wasn't copied is left out.
  const responses = clip.edges.flatMap((e) => {
    const request = requestIds.get(responseToOf(e) ?? "");
    if (request === undefined) return [];
    return [
      {
        ...e,
        id: returnIdOf(request),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        data: returnData(request),
        selected: true,
      },
    ];
  });
  return { nodes, edges: [...requests, ...responses] };
}

/**
 * "After miss" calls of a cloned edge point at the cloned cache; when the
 * cache wasn't cloned with it, `missOf` is dropped (the call plan then
 * treats the call as reads, with a warning).
 */
function remapMissOf(data: Edge["data"], idMap: ReadonlyMap<string, string>): Edge["data"] {
  const rule = (data as CustomEdgeData | undefined)?.rule;
  if (!rule?.calls.some((c) => c.missOf !== undefined)) return data;
  const calls = rule.calls.map(({ missOf, ...call }) => {
    if (missOf === undefined) return call;
    const cloned = idMap.get(missOf);
    return cloned ? { ...call, missOf: cloned } : call;
  });
  return { ...data, rule: { ...rule, calls } };
}

/** Deselect everything, then append the (selected) clones in one undo step. */
function withClones(state: CanvasState, clones: Clipboard): Partial<CanvasState> {
  return {
    history: pushedHistory(state),
    future: [],
    nodes: [
      ...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      ...clones.nodes,
    ],
    edges: [
      ...state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      ...clones.edges,
    ],
  };
}

/**
 * Connection dragged from `ret-out` of B to A: draws the response of the
 * request A → B (RET-01). Nothing is created when A or B is the same node or a
 * text node (RET-30), when A → B has no request (a toast says so, RET-02) or
 * when every A → B request already has its response (RET-03).
 */
type ResponseOutcome =
  | { kind: "none" }
  | { kind: "no-request"; message: string }
  | { kind: "create"; request: Edge };

/** Pure: what dragging a response from `connection.source` to `connection.target` would do. */
function responseOutcome(state: CanvasState, connection: Connection): ResponseOutcome {
  const { source: callee, target: caller } = connection;
  const isComponent = (id: string) => state.nodes.some((n) => n.id === id && n.type !== "text");
  if (callee === caller || !isComponent(callee) || !isComponent(caller)) return { kind: "none" };
  const requests = requestEdges(state.edges).filter(
    (e) => e.source === caller && e.target === callee,
  );
  if (requests.length === 0) {
    const label = (id: string) =>
      (state.nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id;
    return {
      kind: "no-request",
      message: `A response needs a request: connect ${label(caller)} → ${label(callee)} first`,
    };
  }
  const answered = responseOf(state.edges);
  const open = requests.find((e) => !answered.has(e.id));
  return open ? { kind: "create", request: open } : { kind: "none" };
}

/** The state change of a response connection: one response, one undo entry (a reducer: no side effects). */
function connectResponse(
  state: CanvasState,
  connection: Connection,
): Partial<CanvasState> | CanvasState {
  const outcome = responseOutcome(state, connection);
  if (outcome.kind !== "create") return state;
  return {
    history: pushedHistory(state),
    future: [],
    edges: [...state.edges, makeReturnEdge(outcome.request)],
  };
}

/**
 * The edges after a removal, kept consistent: a response whose request is gone
 * goes with it (RET-08). A request that lost its response simply has none, so
 * it is async (RET-07).
 */
function withoutOrphanResponses(next: Edge[]): Edge[] {
  const ids = new Set(next.map((e) => e.id));
  return next.filter((e) => {
    const to = responseToOf(e);
    return to === undefined || ids.has(to);
  });
}

const ruleGraph = (state: { nodes: Node[]; edges: Edge[] }) =>
  canvasRuleGraph(state.nodes, state.edges);

function resetSimulation(): void {
  // Metrics/score refer to nodes that just changed out from under them.
  useSimulationStore.getState().reset();
  useRuntimeStore.getState().clear();
}

type GraphEditResult = { nodes: Node[]; edges: Edge[] } | null;

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  /** In-app clipboard for copy/paste (not persisted). */
  clipboard: Clipboard | null;

  // Tab system
  tabs: CanvasTab[];
  activeTabId: string;
  addTab: (tab: CanvasTab) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;

  // Undo/redo (not persisted)
  history: HistoryEntry[];
  future: HistoryEntry[];
  /** Internal: true while a node drag is in progress (dedupes history pushes). */
  isDragging: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (node: Node) => void;
  /** Add a node centered near `center`, spiraling out to avoid overlaps. */
  placeNode: (node: Node, center: XYPosition) => void;

  // Selection lives on node.selected / edge.selected (single source of truth)
  selectOnly: (nodeIds: string[], edgeIds?: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** Copy the selection to the in-app clipboard; returns how many nodes were copied. */
  copySelection: () => number;
  /** Paste the clipboard centered near `center` (flow coordinates). */
  pasteClipboard: (center: XYPosition) => void;
  duplicateSelection: () => void;
  /** Move selected nodes by (dx, dy); consecutive nudges share one undo step. */
  nudgeSelection: (dx: number, dy: number) => void;
  changeReplicas: (nodeId: string, delta: number) => void;
  /** Set several nodes' instance counts (right-size, Spec 10) in one undo step. */
  setInstanceCounts: (counts: Record<string, number>) => void;
  /**
   * Replace the graph with `edit(current)` in one undo step (the advisor's
   * quick fixes, Spec 12); `edit` returns null for "nothing to change".
   */
  applyGraphEdit: (edit: (graph: { nodes: Node[]; edges: Edge[] }) => GraphEditResult) => void;
  /** Merge a params edit (validated by the node's schema) in one undo step. */
  updateNodeParams: (nodeId: string, patch: Params) => void;
  /**
   * Merge an edge rule edit (normalized) in one undo step: link fields, the
   * first call's fields, or a whole call list (`calls`; an empty list is refused).
   */
  updateEdgeRule: (edgeId: string, patch: EdgeRulePatch) => void;
  updateNodeData: (nodeId: string, data: Partial<ComponentNodeData>) => void;
  updateEdgeData: (edgeId: string, data: Partial<CustomEdgeData>) => void;
  /**
   * Sync / Async shortcut (RET-12, RET-13): draws (`true`) or deletes (`false`)
   * the response of the call `edgeId` (or of the call a response answers), in
   * one undo step.
   */
  setEdgeSync: (edgeId: string, sync: boolean) => void;
  clearCanvas: () => void;
  /** The single delete path: selected nodes/edges (plus edges touching removed nodes) in one undo step. */
  deleteSelection: () => void;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      clipboard: null,

      // Tab system — "my-design" is the default tab
      tabs: [{ id: "my-design", label: "My Design", nodes: [], edges: [] }],
      activeTabId: "my-design",

      history: [],
      future: [],
      isDragging: false,

      addTab: (tab) => {
        set((state) => {
          // Save current tab state before switching
          const updatedTabs = state.tabs.map((t) =>
            t.id === state.activeTabId ? { ...t, nodes: state.nodes, edges: state.edges } : t,
          );
          // Check if tab already exists (reuse it)
          const existing = updatedTabs.find((t) => t.id === tab.id);
          if (existing) {
            return {
              tabs: updatedTabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t)),
              activeTabId: tab.id,
              nodes: tab.nodes,
              edges: tab.edges,
              history: [],
              future: [],
              isDragging: false,
            };
          }
          return {
            tabs: [...updatedTabs, tab],
            activeTabId: tab.id,
            nodes: tab.nodes,
            edges: tab.edges,
            history: [],
            future: [],
            isDragging: false,
          };
        });
        resetSimulation();
      },

      switchTab: (tabId) => {
        const before = get().activeTabId;
        set((state) => {
          const target = state.tabs.find((t) => t.id === tabId);
          if (!target || tabId === state.activeTabId) return state;
          // Save current tab state
          const updatedTabs = state.tabs.map((t) =>
            t.id === state.activeTabId ? { ...t, nodes: state.nodes, edges: state.edges } : t,
          );
          return {
            tabs: updatedTabs,
            activeTabId: tabId,
            nodes: target.nodes,
            edges: target.edges,
            history: [],
            future: [],
            isDragging: false,
          };
        });
        if (get().activeTabId !== before) resetSimulation();
      },

      closeTab: (tabId) => {
        const before = get().activeTabId;
        set((state) => {
          if (tabId === "my-design") return state; // Can't close the main tab
          const remaining = state.tabs.filter((t) => t.id !== tabId);
          if (state.activeTabId === tabId) {
            // Switch to my-design tab
            const myDesign = remaining.find((t) => t.id === "my-design") ?? remaining[0];
            return {
              tabs: remaining,
              activeTabId: myDesign.id,
              nodes: myDesign.nodes,
              edges: myDesign.edges,
              history: [],
              future: [],
              isDragging: false,
            };
          }
          return { tabs: remaining };
        });
        if (get().activeTabId !== before) resetSimulation();
      },

      renameTab: (tabId, label) => {
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, label } : t)),
        }));
      },

      undo: () => {
        set((state) => {
          const prev = state.history[state.history.length - 1];
          if (!prev) return state;
          lastNudgeAt = 0; // the next nudge is a new step, not part of the undone one
          return {
            history: state.history.slice(0, -1),
            future: [...state.future, snapshot(state)].slice(-MAX_HISTORY),
            nodes: prev.nodes,
            edges: prev.edges,
            isDragging: false,
          };
        });
      },

      redo: () => {
        set((state) => {
          const next = state.future[state.future.length - 1];
          if (!next) return state;
          lastNudgeAt = 0;
          return {
            future: state.future.slice(0, -1),
            history: [...state.history, snapshot(state)].slice(-MAX_HISTORY),
            nodes: next.nodes,
            edges: next.edges,
            isDragging: false,
          };
        });
      },

      canUndo: () => get().history.length > 0,
      canRedo: () => get().future.length > 0,

      clearHistory: () => set({ history: [], future: [], isDragging: false }),

      onNodesChange: (changes) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) {
            const view = changes.filter(isReadOnlyNodeChange);
            return view.length === 0 ? state : { nodes: applyNodeChanges(view, state.nodes) };
          }
          const dragStart = changes.some((c) => c.type === "position" && c.dragging === true);
          const dragEnd = changes.some((c) => c.type === "position" && c.dragging === false);
          const hasRemove = changes.some((c) => c.type === "remove");

          // ReactFlow's own arrow-key move on a focused node emits
          // `dragging: false` position changes outside of any drag.
          const keyboardMove = !state.isDragging && !dragStart && dragEnd;

          let history = state.history;
          let future = state.future;
          // Push pre-change state once at drag start (NOT on every drag
          // tick) so undo restores the pre-drag positions; also on removal.
          if ((dragStart && !state.isDragging) || hasRemove) {
            history = pushedHistory(state);
            future = [];
          } else if (keyboardMove) {
            history = nudgeHistory(state);
            future = [];
          }

          return {
            nodes: applyNodeChanges(changes, state.nodes) as Node[],
            history,
            future,
            isDragging: dragStart ? true : dragEnd ? false : state.isDragging,
          };
        });
      },
      onEdgesChange: (changes) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) {
            const view = changes.filter(isViewChange);
            return view.length === 0 ? state : { edges: applyEdgeChanges(view, state.edges) };
          }
          const hasRemove = changes.some((c) => c.type === "remove");
          const applied = applyEdgeChanges(changes, state.edges);
          return {
            edges: hasRemove ? withoutOrphanResponses(applied) : applied,
            ...(hasRemove ? { history: pushedHistory(state), future: [] } : null),
          };
        });
      },
      onConnect: (connection) => {
        // Dragged from a return handle: the response of an existing request. The
        // toast (RET-02) is shown here, outside the reducer, which stays pure.
        if (connection.sourceHandle === RETURN_SOURCE_HANDLE) {
          const current = get();
          if (isActiveTabReadOnly(current)) return;
          const outcome = responseOutcome(current, connection);
          if (outcome.kind === "no-request")
            useAppStore.getState().showToast(outcome.message, "info");
          if (outcome.kind !== "create") return;
          set((state) => (isActiveTabReadOnly(state) ? state : connectResponse(state, connection)));
          return;
        }
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          const graph = ruleGraph(state);
          // A new call has no response yet, so it is async until one is drawn.
          const data: CustomEdgeData = newEdgeData(connection.source, connection.target, graph);
          // Service → Read Replica: the service's `always` edges to SQL DBs become `writes`
          const split = splitReadsOnReplicaConnect(connection.source, connection.target, graph);
          // (the rule graph holds the requests only: the responses stay where they are)
          const edges =
            split === graph.edges
              ? state.edges
              : [...split, ...state.edges.filter((e) => isReturnEdge(e))];
          return {
            history: pushedHistory(state),
            future: [],
            edges: addEdge({ ...connection, type: "animated", data }, [...edges]),
          };
        });
      },
      addNode: (node) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: [...state.nodes, node],
          };
        });
      },
      placeNode: (node, center) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: [...state.nodes, { ...node, position: freePositionNear(center, state.nodes) }],
          };
        });
      },
      selectOnly: (nodeIds, edgeIds = []) => {
        const n = new Set(nodeIds);
        const e = new Set(edgeIds);
        set((state) => ({
          nodes: state.nodes.map((node) =>
            !!node.selected === n.has(node.id) ? node : { ...node, selected: n.has(node.id) },
          ),
          edges: state.edges.map((edge) =>
            !!edge.selected === e.has(edge.id) ? edge : { ...edge, selected: e.has(edge.id) },
          ),
        }));
      },
      selectAll: () => {
        set((state) => ({
          nodes: state.nodes.map((n) => (n.selected ? n : { ...n, selected: true })),
          edges: state.edges.map((e) => (e.selected ? e : { ...e, selected: true })),
        }));
      },
      clearSelection: () => get().selectOnly([]),
      copySelection: () => {
        const clip = selectionSubgraph(get());
        if (clip.nodes.length === 0) return 0;
        set({ clipboard: clip });
        return clip.nodes.length;
      },
      pasteClipboard: (center) => {
        set((state) => {
          const clip = state.clipboard;
          if (!clip || clip.nodes.length === 0 || isActiveTabReadOnly(state)) return state;
          const box = boundingBox(clip.nodes);
          const target = { x: center.x - box.width / 2, y: center.y - box.height / 2 };
          return withClones(state, cloneSubgraph(clip, state.nodes, target));
        });
      },
      duplicateSelection: () => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          const clip = selectionSubgraph(state);
          if (clip.nodes.length === 0) return state;
          const box = boundingBox(clip.nodes);
          return withClones(
            state,
            cloneSubgraph(clip, state.nodes, { x: box.x + 32, y: box.y + 32 }),
          );
        });
      },
      nudgeSelection: (dx, dy) => {
        set((state) => {
          if (isActiveTabReadOnly(state) || !state.nodes.some((n) => n.selected)) return state;
          return {
            history: nudgeHistory(state),
            future: [],
            nodes: state.nodes.map((n) =>
              n.selected ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
            ),
          };
        });
      },
      changeReplicas: (nodeId, delta) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId);
          if (!node || node.type !== "component" || isActiveTabReadOnly(state)) return state;
          const data = node.data as ComponentNodeData;
          const current = instancesOf(data);
          const instances = Math.min(MAX_INSTANCES, Math.max(1, current + delta));
          if (instances === current) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: state.nodes.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, params: { ...data.params, [PARAM.instances]: instances } },
                  }
                : n,
            ),
          };
        });
      },
      setInstanceCounts: (counts) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          let changed = false;
          const nodes = state.nodes.map((n) => {
            const want = counts[n.id];
            if (want === undefined || n.type !== "component" || !Number.isFinite(want)) return n;
            const data = n.data as ComponentNodeData;
            const instances = Math.min(MAX_INSTANCES, Math.max(1, Math.round(want)));
            if (instances === instancesOf(data)) return n;
            changed = true;
            return {
              ...n,
              data: { ...n.data, params: { ...data.params, [PARAM.instances]: instances } },
            };
          });
          if (!changed) return state;
          return { history: pushedHistory(state), future: [], nodes };
        });
      },
      applyGraphEdit: (edit) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          const next = edit({ nodes: state.nodes, edges: state.edges });
          if (!next) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: next.nodes,
            edges: next.edges,
          };
        });
      },
      updateNodeParams: (nodeId, patch) => {
        set((state) => {
          const node = state.nodes.find((n) => n.id === nodeId);
          if (!node || node.type !== "component" || isActiveTabReadOnly(state)) return state;
          const data = node.data as ComponentNodeData;
          const current = resolvedParams(data);
          const next = sanitizeParams(data.componentId, { ...current, ...patch });
          if (Object.keys(next).every((k) => next[k] === current[k])) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: state.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, params: next } } : n,
            ),
          };
        });
      },
      updateEdgeRule: (edgeId, patch) => {
        set((state) => {
          const edge = state.edges.find((e) => e.id === edgeId);
          if (!edge || isActiveTabReadOnly(state)) return state;
          // An edge always keeps at least one call (FLW-44).
          if (patch.calls !== undefined && patch.calls.length === 0) return state;
          const data = (edge.data ?? {}) as CustomEdgeData;
          const fallback = connectEdgeRule(
            edge.source,
            edge.target,
            ruleGraph(state),
            data.protocol,
          );
          const current = sanitizeEdgeRule(data.rule, fallback);
          const next = applyEdgeRulePatch(current, patch, fallback);
          if (JSON.stringify(next) === JSON.stringify(current)) return state;
          return {
            history: pushedHistory(state),
            future: [],
            edges: state.edges.map((e) =>
              e.id === edgeId ? { ...e, data: { ...e.data, rule: next } } : e,
            ),
          };
        });
      },
      updateNodeData: (nodeId, data) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          return {
            nodes: state.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
            ),
          };
        });
      },
      updateEdgeData: (edgeId, data) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          return {
            edges: state.edges.map((e) =>
              e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e,
            ),
          };
        });
      },
      setEdgeSync: (edgeId, sync) => {
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          const picked = state.edges.find((e) => e.id === edgeId);
          const requestId = picked ? (responseToOf(picked) ?? picked.id) : undefined;
          const request = state.edges.find((e) => e.id === requestId && !isReturnEdge(e));
          if (!request) return state;
          const response = responseOf(state.edges).get(request.id);
          if (sync === (response !== undefined)) return state;
          return {
            history: pushedHistory(state),
            future: [],
            edges: sync
              ? [...state.edges, makeReturnEdge(request)]
              : state.edges.filter((e) => e.id !== response!.id),
          };
        });
      },
      clearCanvas: () => {
        if (isActiveTabReadOnly(get())) return;
        set((state) => ({
          history: pushedHistory(state),
          future: [],
          nodes: [],
          edges: [],
        }));
        resetSimulation();
      },
      deleteSelection: () =>
        set((state) => {
          if (isActiveTabReadOnly(state)) return state;
          const nodeIds = new Set(state.nodes.filter((n) => n.selected).map((n) => n.id));
          const edgeIds = new Set(state.edges.filter((e) => e.selected).map((e) => e.id));
          if (nodeIds.size === 0 && edgeIds.size === 0) return state;
          return {
            history: pushedHistory(state),
            future: [],
            nodes: state.nodes.filter((n) => !nodeIds.has(n.id)),
            edges: withoutOrphanResponses(
              state.edges.filter(
                (e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target),
              ),
            ),
          };
        }),
    }),
    {
      name: "systemsim-canvas",
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // v1 → v2: params + edge rules for the live graph and every tab.
      migrate: migrateCanvasState,
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        // The active tab's content already lives in the top-level
        // nodes/edges — persist it emptied to avoid duplicating it, and
        // reconstruct it in `merge` on rehydrate.
        tabs: state.tabs.map((t) =>
          t.id === state.activeTabId ? { ...t, nodes: [], edges: [] } : t,
        ),
        activeTabId: state.activeTabId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<
          Pick<CanvasState, "nodes" | "edges" | "tabs" | "activeTabId">
        >;
        const merged: CanvasState = { ...currentState, ...persisted };
        // Refill the active tab's snapshot from the live nodes/edges.
        if (merged.tabs && merged.tabs.length > 0) {
          merged.tabs = merged.tabs.map((t) =>
            t.id === merged.activeTabId ? { ...t, nodes: merged.nodes, edges: merged.edges } : t,
          );
        } else {
          merged.tabs = [
            {
              id: "my-design",
              label: "My Design",
              nodes: merged.nodes,
              edges: merged.edges,
            },
          ];
          merged.activeTabId = "my-design";
        }
        return merged;
      },
    },
  ),
);

/** Reactive form of `isActiveTabReadOnly` (re-renders only when the flag flips). */
export function useIsActiveTabReadOnly(): boolean {
  return useCanvasStore(isActiveTabReadOnly);
}

/** Does the call `requestId` have its response drawn? (No response: it is async.) */
export function useHasResponse(requestId: string): boolean {
  return useCanvasStore((s) => s.edges.some((e) => responseToOf(e) === requestId));
}

type CanvasAction = {
  [K in keyof CanvasState]: CanvasState[K] extends (...args: never[]) => unknown ? K : never;
}[keyof CanvasState];

/**
 * Actions that edit the active tab's graph. Each one refuses by itself on a
 * read-only (reference) tab — the UI gates are affordances, not the guard.
 * `tests/unit/editor.test.ts` runs every one of them on a read-only tab, and
 * checks that every action is listed here or in `READ_ONLY_EXEMPT_ACTIONS`.
 */
export const MUTATING_ACTIONS = [
  // Only view changes (select, dimensions) apply on a read-only tab.
  "onNodesChange",
  "onEdgesChange",
  "onConnect",
  "addNode",
  "placeNode",
  "pasteClipboard",
  "duplicateSelection",
  "nudgeSelection",
  "changeReplicas",
  "setInstanceCounts",
  "applyGraphEdit",
  "updateNodeParams",
  "updateEdgeRule",
  "updateNodeData",
  "updateEdgeData",
  "setEdgeSync",
  "clearCanvas",
  "deleteSelection",
] as const satisfies readonly CanvasAction[];

/** Actions that legitimately run on a read-only tab, each for the reason given. */
export const READ_ONLY_EXEMPT_ACTIONS = [
  // Tab management: `addTab` is how `loadReferenceIntoTab` creates (or
  // refreshes) a reference tab; switching, closing and renaming tabs never
  // edit a tab's graph.
  "addTab",
  "switchTab",
  "closeTab",
  "renameTab",
  // History only replays this tab's own entries, and a read-only tab never
  // records any (every edit above is gated; tab switches clear the stacks).
  "undo",
  "redo",
  "canUndo",
  "canRedo",
  "clearHistory",
  // Selection is view state: selecting (and inspecting) reference nodes works.
  "selectOnly",
  "selectAll",
  "clearSelection",
  // Copying out of a reference writes only the clipboard.
  "copySelection",
] as const satisfies readonly CanvasAction[];
