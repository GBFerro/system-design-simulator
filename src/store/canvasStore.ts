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
  type XYPosition,
} from "@xyflow/react";
import { useSimulationStore } from "./simulationStore";
import { safeLocalStorage } from "./safeStorage";
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
  connectEdgeRule,
  defaultEdgeAsync,
  sanitizeEdgeRule,
  splitReadsOnReplicaConnect,
  type RuleGraph,
} from "@/domain/graph/edgeRules";

export interface ComponentNodeData {
  componentId: string;
  label: string;
  icon: string;
  category: string;
  scalable: boolean;
  /** Validated against the type's `ComponentSchema` (Spec 03). */
  params: Params;
  utilization?: number;
  status?: string;
  isBottleneck?: boolean;
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
  protocol?: "http" | "grpc" | "websocket" | "pubsub" | "tcp" | "custom";
  async?: boolean;
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

/** Strip simulation runtime fields so persisted nodes don't glow on reload. */
function stripRuntimeFields(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    if (n.type === "text") return n;
    const data = { ...n.data };
    delete data.utilization;
    delete data.status;
    delete data.isBottleneck;
    return { ...n, data };
  });
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

function isActiveTabReadOnly(state: { tabs: CanvasTab[]; activeTabId: string }): boolean {
  return state.tabs.find((t) => t.id === state.activeTabId)?.readOnly === true;
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
  return JSON.parse(JSON.stringify({ nodes: stripRuntimeFields(nodes), edges })) as Clipboard;
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
  const edges = clip.edges.map((e) => ({
    ...e,
    id: `e-${randomId()}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
    selected: true,
  }));
  return { nodes, edges };
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

function ruleGraph(state: { nodes: Node[]; edges: Edge[] }): RuleGraph<Edge> {
  return {
    componentIdOf: (id) => {
      const data = state.nodes.find((n) => n.id === id)?.data;
      return typeof data?.componentId === "string" ? data.componentId : undefined;
    },
    edges: state.edges,
  };
}

/** An edge's current rule, normalized (edges saved before v2 get their connect default). */
export function edgeRuleOf(state: { nodes: Node[]; edges: Edge[] }, edge: Edge): EdgeRule {
  const data = (edge.data ?? {}) as CustomEdgeData;
  const graph = ruleGraph(state);
  return sanitizeEdgeRule(
    data.rule,
    connectEdgeRule(edge.source, edge.target, graph, data.protocol),
  );
}

function resetSimulation(): void {
  // Metrics/score refer to nodes that just changed out from under them.
  useSimulationStore.getState().reset();
}

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
  /** Merge a params edit (validated by the node's schema) in one undo step. */
  updateNodeParams: (nodeId: string, patch: Params) => void;
  /** Merge an edge rule edit (normalized) in one undo step. */
  updateEdgeRule: (edgeId: string, patch: Partial<EdgeRule>) => void;
  updateNodeData: (nodeId: string, data: Partial<ComponentNodeData>) => void;
  updateEdgeData: (edgeId: string, data: Partial<CustomEdgeData>) => void;
  updateAllNodeData: (updates: Map<string, Partial<ComponentNodeData>>) => void;
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
          const hasRemove = changes.some((c) => c.type === "remove");
          return {
            edges: applyEdgeChanges(changes, state.edges),
            ...(hasRemove ? { history: pushedHistory(state), future: [] } : null),
          };
        });
      },
      onConnect: (connection) => {
        set((state) => {
          const graph = ruleGraph(state);
          const data: CustomEdgeData = {
            label: "",
            protocol: "http",
            async: defaultEdgeAsync(
              graph.componentIdOf(connection.source),
              graph.componentIdOf(connection.target),
            ),
            rule: connectEdgeRule(connection.source, connection.target, graph, "http"),
          };
          // Service → Read Replica: the service's `always` edges to SQL DBs become `writes`
          const edges = splitReadsOnReplicaConnect(connection.source, connection.target, graph);
          return {
            history: pushedHistory(state),
            future: [],
            edges: addEdge({ ...connection, type: "animated", data }, [...edges]),
          };
        });
      },
      addNode: (node) => {
        set((state) => ({
          history: pushedHistory(state),
          future: [],
          nodes: [...state.nodes, node],
        }));
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
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
          ),
        }));
      },
      updateEdgeData: (edgeId, data) => {
        set((state) => ({
          edges: state.edges.map((e) =>
            e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e,
          ),
        }));
      },
      updateAllNodeData: (updates) => {
        set((state) => ({
          nodes: state.nodes.map((n) => {
            const update = updates.get(n.id);
            return update ? { ...n, data: { ...n.data, ...update } } : n;
          }),
        }));
      },
      clearCanvas: () => {
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
            edges: state.edges.filter(
              (e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target),
            ),
          };
        }),
    }),
    {
      name: "systemsim-canvas",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (state) => state as any,
      partialize: (state) => ({
        nodes: stripRuntimeFields(state.nodes),
        edges: state.edges,
        // The active tab's content already lives in the top-level
        // nodes/edges — persist it emptied to avoid duplicating it, and
        // reconstruct it in `merge` on rehydrate.
        tabs: state.tabs.map((t) =>
          t.id === state.activeTabId
            ? { ...t, nodes: [], edges: [] }
            : { ...t, nodes: stripRuntimeFields(t.nodes) },
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
