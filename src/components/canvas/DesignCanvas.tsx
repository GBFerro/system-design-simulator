"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ReactFlow,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  useNodesInitialized,
  useReactFlow,
  useStoreApi,
  type Node,
} from "@xyflow/react";
import { useAppStore } from "@/store/appStore";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes/nodeTypes";
import { ChaosTimeline } from "./ChaosTimeline";
import { edgeTypes } from "./edges/edgeTypes";
import { isValidHandlePair } from "@/domain/graph/returns";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { useAdvisorStore } from "@/store/advisorStore";
import { isGhostId, withoutGhostChanges, withPreview } from "./previewGraph";
import { toEdgeChanges, toNodeChanges, withInstances } from "./instanceGraph";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";
import { getLatestSnapshot, useRuntimeStore } from "@/store/runtimeStore";
import { usePenStore } from "@/store/penStore";
import { minimapFill } from "@/lib/minimapColor";
import { framedViewportNow } from "@/lib/framing";
import { visibleCanvasCenter } from "@/lib/placement";
import {
  BookOpen,
  GraduationCap,
  Layers,
  Lock,
  Maximize,
  MousePointer2,
  Sparkles,
  HelpCircle,
} from "lucide-react";
import { motion } from "framer-motion";

// Orchestrated staggered reveal for the empty state — one deliberate page-load
// moment rather than scattered micro-animations.
const emptyContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};
const emptyItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};
import { CanvasTabBar } from "./CanvasTabBar";
import { IsoBackground } from "./IsoBackground";
import { PenOverlay } from "./PenOverlay";
import { FlowParticles } from "./FlowParticles";
import { NodeInsightCard } from "./NodeInsightCard";
import { PenToolbar } from "./PenToolbar";
import { CANVAS_DROP_ATTR } from "./PaletteDnd";
import { CanvasContextMenu, type ContextMenuState, type ContextTarget } from "./CanvasContextMenu";
import { useCanvasShortcuts } from "./useCanvasShortcuts";

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/** The part of the canvas the stage's floating cards leave (AppShell sets the variables; with no cards they are 0). */
const FREE_AREA: CSSProperties = {
  top: "var(--stage-inset-top, 0px)",
  left: "var(--stage-inset-left, 0px)",
  right: "var(--stage-inset-right, 0px)",
};
/** The same, below the tab bar that floats at its top (the read-only hint and the pen toolbar sit there). */
const BELOW_TABS_TOP = "calc(var(--stage-inset-top, 0px) + var(--stage-tabs, 0px))";

/**
 * Every fit of the viewport (the first one, the controls' button, a tab change) frames the design in
 * the part the open cards leave (`lib/framing.ts`), down to this zoom: the widest reference needs
 * about 0.4 at 1440 px, under the 0.5 a user can zoom out to by hand.
 */
const FIT_MIN_ZOOM = 0.2;
/** The first fit and the controls' button never zoom in past 1; a tab's fit may, as the canvas always did. */
const FIT_MAX_ZOOM = 1;
const TAB_FIT_MAX_ZOOM = 2;
/** Frames a tab change gives the new tab's nodes to be measured before it fits them anyway. */
const MEASURE_FRAMES = 60;

/** Which canvas element (node, edge or empty pane) an event landed on. */
function contextTargetOf(el: EventTarget | null): ContextTarget | null {
  if (!(el instanceof Element)) return null;
  const node = el.closest(".react-flow__node");
  if (node?.getAttribute("data-id")) return { kind: "node", id: node.getAttribute("data-id")! };
  const edge = el.closest(".react-flow__edge");
  if (edge?.getAttribute("data-id")) return { kind: "edge", id: edge.getAttribute("data-id")! };
  if (el.closest(".react-flow__pane")) return { kind: "pane" };
  return null;
}

function centerOf(el: Element | null): { x: number; y: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

interface DesignCanvasProps {
  onPickProblem?: () => void;
  onLoadReference?: () => void;
  onStartInterview?: () => void;
  onShowGuide?: () => void;
}

export function DesignCanvas({
  onPickProblem,
  onLoadReference,
  onStartInterview,
  onShowGuide,
}: DesignCanvasProps = {}) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, setViewport, getNodes, getNodesBounds } = useReactFlow();
  const store = useStoreApi();

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  // Advisor quick-fix preview (Spec 12): ghosts drawn over the graph, never stored.
  const previewDiff = useAdvisorStore((s) => s.preview?.diff);
  // Expanded nodes (OBS-04): one card per instance, also only in what ReactFlow renders.
  const expanded = useExpandedNodesStore((s) => s.expanded);
  const rendered = useMemo(() => {
    const opened = withInstances(nodes, edges, expanded);
    return withPreview(opened.nodes, opened.edges, previewDiff);
  }, [nodes, edges, expanded, previewDiff]);
  const handleNodesChange = useCallback<typeof onNodesChange>(
    (changes) => {
      const real = toNodeChanges(previewDiff ? withoutGhostChanges(changes) : changes, nodes);
      if (real.length > 0) onNodesChange(real);
    },
    [onNodesChange, previewDiff, nodes],
  );
  const handleEdgesChange = useCallback<typeof onEdgesChange>(
    (changes) => {
      const real = toEdgeChanges(previewDiff ? withoutGhostChanges(changes) : changes);
      if (real.length > 0) onEdgesChange(real);
    },
    [onEdgesChange, previewDiff],
  );
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const activeTabId = useCanvasStore((s) => s.activeTabId);
  const isReadOnly = useIsActiveTabReadOnly();
  const minimapVisible = useAppStore((s) => s.minimapVisible);
  const toggleMinimap = useAppStore((s) => s.toggleMinimap);
  const penMode = usePenStore((s) => s.mode);
  const penActive = penMode !== "off";

  // Frame the nodes in the part of the canvas the open floating cards leave (see `lib/framing.ts`).
  // The cards are read when it runs: opening or closing one never moves the view by itself.
  const frame = useCallback(
    (maxZoom: number, duration?: number) => {
      const shown = getNodes();
      if (shown.length === 0) return;
      const view = framedViewportNow(getNodesBounds(shown), { minZoom: FIT_MIN_ZOOM, maxZoom });
      if (view) void setViewport(view, duration ? { duration } : undefined);
    },
    [getNodes, getNodesBounds, setViewport],
  );

  // The first fit: once, when the first nodes are on screen and measured (a persisted design at
  // load, or the first node added to an empty canvas).
  const nodesInitialized = useNodesInitialized();
  const firstFitDone = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || firstFitDone.current) return;
    firstFitDone.current = true;
    frame(FIT_MAX_ZOOM);
  }, [nodesInitialized, frame]);

  // Re-fit the viewport whenever the user switches canvas tabs
  const initialTabRef = useRef(true);
  useEffect(() => {
    if (initialTabRef.current) {
      initialTabRef.current = false;
      return; // the first fit above handles the initial mount
    }
    // Wait until the new tab's nodes are mounted and measured, or the frame misses their size
    let raf = 0;
    let frames = 0;
    const wait = () => {
      if (getNodes().length === 0) return; // an empty tab: nothing to frame (and the first node's fit is the first fit's)
      if (store.getState().nodesInitialized || ++frames > MEASURE_FRAMES) {
        frame(TAB_FIT_MAX_ZOOM, 300);
      } else {
        raf = requestAnimationFrame(wait);
      }
    };
    raf = requestAnimationFrame(wait);
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, frame, getNodes, store]);

  // Listen for text node edits and persist them to the store
  useEffect(() => {
    function handleTextNodeUpdate(e: Event) {
      const { id, text } = (e as CustomEvent).detail;
      updateNodeData(id, { text } as Record<string, unknown>);
    }
    window.addEventListener("textnode:update", handleTextNodeUpdate);
    return () => window.removeEventListener("textnode:update", handleTextNodeUpdate);
  }, [updateNodeData]);

  // Last pointer position over the canvas, so paste lands under the cursor
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const getPasteCenter = useCallback(
    () =>
      lastPointer.current
        ? screenToFlowPosition(lastPointer.current)
        : visibleCanvasCenter(screenToFlowPosition),
    [screenToFlowPosition],
  );

  // Context menu: right-click, long-press (touch) or Shift+F10 / Menu key
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback(
    (target: ContextTarget, x: number, y: number) => {
      if (penActive || ("id" in target && isGhostId(target.id))) return;
      const s = useCanvasStore.getState();
      // Acting on something outside the selection selects just that thing
      if (target.kind === "node" && !s.nodes.find((n) => n.id === target.id)?.selected) {
        s.selectOnly([target.id]);
      } else if (target.kind === "edge" && !s.edges.find((e) => e.id === target.id)?.selected) {
        s.selectOnly([], [target.id]);
      }
      setMenu({ target, x, y });
    },
    [penActive],
  );

  const openMenuForSelection = useCallback(() => {
    const s = useCanvasStore.getState();
    const node = s.nodes.find((n) => n.selected);
    const edge = s.edges.find((e) => e.selected);
    const at = (sel: string) => centerOf(reactFlowWrapper.current?.querySelector(sel) ?? null);
    if (node) {
      const p = at(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
      if (p) return openMenu({ kind: "node", id: node.id }, p.x, p.y);
    }
    if (edge) {
      const p = at(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"]`);
      if (p) return openMenu({ kind: "edge", id: edge.id }, p.x, p.y);
    }
    const p = at(".react-flow");
    if (p) openMenu({ kind: "pane" }, p.x, p.y);
  }, [openMenu]);

  useCanvasShortcuts({ getPasteCenter, openMenuForSelection });

  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );
  const cancelLongPress = useCallback(() => {
    if (longPress.current) clearTimeout(longPress.current.timer);
    longPress.current = null;
  }, []);
  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      cancelLongPress(); // a second finger (pinch) cancels too
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const target = contextTargetOf(e.target);
      if (!target) return;
      const { clientX: x, clientY: y } = e;
      longPress.current = { x, y, timer: setTimeout(() => openMenu(target, x, y), LONG_PRESS_MS) };
    },
    [cancelLongPress, openMenu],
  );
  const onPointerMoveCapture = useCallback(
    (e: ReactPointerEvent) => {
      const lp = longPress.current;
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) cancelLongPress();
    },
    [cancelLongPress],
  );
  useEffect(() => cancelLongPress, [cancelLongPress]);

  // Minimap colors follow runtime status. The selector returns a string, so
  // the canvas re-renders only when some node's status changes, not per tick.
  const statusSignature = useRuntimeStore((s) => {
    const nodes = s.latest?.nodes;
    if (!nodes) return "";
    let sig = "";
    for (const id in nodes) sig += `${id}:${nodes[id].status};`;
    return sig;
  });
  const miniMapNodeColor = useMemo(
    () =>
      // `statusSignature` changes the function identity so the minimap repaints.
      (node: Node) =>
        minimapFill(node.id, getLatestSnapshot()?.nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature is the repaint trigger
    [statusSignature],
  );

  const isEmpty = nodes.length === 0;

  return (
    <div ref={reactFlowWrapper} className="relative flex-1 flex flex-col">
      <CanvasTabBar />
      <div
        {...{ [CANVAS_DROP_ATTR]: "" }}
        className="relative flex-1 bg-background"
        style={{ WebkitTouchCallout: "none" }}
        onMouseMove={(e) => (lastPointer.current = { x: e.clientX, y: e.clientY })}
        onMouseLeave={() => (lastPointer.current = null)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMoveCapture={onPointerMoveCapture}
        onPointerUpCapture={cancelLongPress}
        onPointerCancelCapture={cancelLongPress}
      >
        <ReactFlow
          className="sf-canvas h-full w-full"
          nodes={rendered.nodes}
          edges={rendered.edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={isReadOnly ? undefined : onConnect}
          isValidConnection={isValidHandlePair}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          selectionOnDrag={!penActive}
          panOnScroll={!penActive}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            openMenu({ kind: "node", id: node.id }, e.clientX, e.clientY);
          }}
          onSelectionContextMenu={(e, selected) => {
            e.preventDefault();
            if (selected[0]) openMenu({ kind: "node", id: selected[0].id }, e.clientX, e.clientY);
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            openMenu({ kind: "edge", id: edge.id }, e.clientX, e.clientY);
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            openMenu({ kind: "pane" }, e.clientX, e.clientY);
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: "animated" }}
          proOptions={{ hideAttribution: true }}
          panOnDrag={penActive ? false : [1]}
          zoomOnScroll={!penActive}
          zoomOnPinch={!penActive}
          nodesDraggable={!penActive}
          nodesConnectable={!penActive && !isReadOnly}
          elementsSelectable={!penActive}
          connectionRadius={30}
          deleteKeyCode={null}
          snapToGrid
          snapGrid={[16, 16]}
        >
          {/* Isometric lines at 30° and 150°, 26 px, edge-masked: decorative; nodes snap to 16 px. */}
          <IsoBackground />
          <Controls
            className="!rounded-md !border !border-zinc-800 !bg-zinc-900 !shadow-sm [&>button]:!border-zinc-800 [&>button]:!bg-zinc-900 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-800 [&>button:hover]:!text-zinc-200"
            position="bottom-left"
            // The button is ours: React Flow's would fit on the whole canvas, under the cards
            showFitView={false}
          >
            <ControlButton
              onClick={() => frame(FIT_MAX_ZOOM, 300)}
              title="Fit View"
              aria-label="Fit View"
            >
              <Maximize />
            </ControlButton>
          </Controls>
          {/* Next to the zoom controls (bottom-left): the timeline starts to its right. */}
          <Panel position="bottom-left" className="!ml-[52px] hidden md:block">
            <button
              type="button"
              onClick={toggleMinimap}
              data-testid="minimap-toggle"
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-400 shadow-sm hover:bg-zinc-800 hover:text-zinc-200"
            >
              {minimapVisible ? "Hide minimap" : "Show minimap"}
            </button>
          </Panel>
          {minimapVisible && (
            <MiniMap
              className="!hidden !rounded-md !border !border-zinc-800 !bg-zinc-900 md:!block"
              maskColor="var(--minimap-mask)"
              nodeColor={miniMapNodeColor}
              position="bottom-left"
              // Stacked above the zoom controls, so it clears the timeline (to the right of the toggle).
              style={{ width: 140, height: 90, bottom: 150 }}
            />
          )}
          <FlowParticles />
          <NodeInsightCard />
        </ReactFlow>

        <PenOverlay />
        <PenToolbar />
        <ChaosTimeline />
        {menu && <CanvasContextMenu menu={menu} onClose={closeMenu} />}

        {/* Read-only hint for reference tabs: centered at the top of what the cards leave */}
        {isReadOnly && (
          <div
            className="pointer-events-none absolute z-20 flex justify-center"
            style={{ ...FREE_AREA, top: BELOW_TABS_TOP, paddingTop: 12 }}
          >
            <div
              data-testid="readonly-hint"
              className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-zinc-900/90 px-3 py-1 text-[11px] font-medium text-cyan-400 shadow-sm backdrop-blur"
            >
              <Lock className="h-3 w-3" />
              Read-only reference
            </div>
          </div>
        )}
      </div>

      {/* Welcome / empty state */}
      {isEmpty && (
        <div
          data-testid="empty-state"
          className="pointer-events-none absolute bottom-0 flex items-center justify-center px-4 pb-4 md:pb-0"
          style={FREE_AREA}
        >
          <motion.div
            variants={emptyContainer}
            initial="hidden"
            animate="show"
            className="pointer-events-auto flex w-full max-w-lg flex-col items-center gap-6 text-center"
          >
            <motion.div
              variants={emptyItem}
              className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-transparent [box-shadow:0_0_40px_-10px_var(--sf-accent)]"
            >
              <Layers className="h-6 w-6 text-cyan-400" />
            </motion.div>
            <motion.div variants={emptyItem} className="space-y-1.5">
              <h1 className="font-display text-lg font-bold tracking-[-0.02em] text-zinc-50 md:text-xl">
                Build an architecture that scales
              </h1>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-zinc-400 md:text-sm">
                Pick a problem, drop infrastructure components onto the canvas, and get scored the
                way an interviewer would evaluate you.
              </p>
            </motion.div>

            {onShowGuide && (
              <motion.button
                variants={emptyItem}
                onClick={onShowGuide}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/70 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                New here? See how it works
              </motion.button>
            )}

            <motion.div variants={emptyItem} className="grid w-full gap-2 sm:grid-cols-3">
              <QuickStartCard
                icon={<BookOpen className="h-3.5 w-3.5" />}
                title="Pick a problem"
                hint="35 real interview questions"
                onClick={onPickProblem}
              />
              <QuickStartCard
                icon={<Sparkles className="h-3.5 w-3.5" />}
                title="Load reference"
                hint="Open a sample solution"
                onClick={onLoadReference}
              />
              <QuickStartCard
                icon={<GraduationCap className="h-3.5 w-3.5" />}
                title="Practice interview"
                hint="Timed 6-phase mock"
                onClick={onStartInterview}
                accent
              />
            </motion.div>

            <motion.div
              variants={emptyItem}
              className="hidden flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-500 md:flex"
            >
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘K
                </kbd>
                command palette
              </span>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1.5">
                <MousePointer2 className="h-3 w-3" />
                Drag from the sidebar
              </span>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘E
                </kbd>
                export
              </span>
              <span className="text-zinc-700">·</span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘↵
                </kbd>
                simulate
              </span>
            </motion.div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function QuickStartCard({
  icon,
  title,
  hint,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-start gap-1.5 rounded-lg border bg-zinc-900/60 p-3 text-left transition-all hover:-translate-y-0.5 hover:bg-zinc-900 ${
        accent
          ? "border-cyan-500/30 hover:border-cyan-400/60 hover:[box-shadow:0_0_24px_-8px_var(--sf-accent)]"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-md ${
          accent
            ? "bg-cyan-500/15 text-cyan-400"
            : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
        }`}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-zinc-200">{title}</span>
      <span className="text-[11px] leading-tight text-zinc-500">{hint}</span>
    </button>
  );
}
