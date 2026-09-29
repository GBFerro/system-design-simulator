"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes/nodeTypes";
import { ChaosTimeline } from "./ChaosTimeline";
import { edgeTypes } from "./edges/edgeTypes";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { getLatestSnapshot, useRuntimeStore } from "@/store/runtimeStore";
import { usePenStore } from "@/store/penStore";
import { useAppStore } from "@/store/appStore";
import { visibleCanvasCenter } from "@/lib/placement";
import {
  BookOpen,
  GraduationCap,
  Layers,
  Lock,
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
import { PenOverlay } from "./PenOverlay";
import { FlowParticles } from "./FlowParticles";
import { PenToolbar } from "./PenToolbar";
import { CANVAS_DROP_ATTR } from "./PaletteDnd";
import { CanvasContextMenu, type ContextMenuState, type ContextTarget } from "./CanvasContextMenu";
import { useCanvasShortcuts } from "./useCanvasShortcuts";

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

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
  const { screenToFlowPosition, fitView } = useReactFlow();

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const activeTabId = useCanvasStore((s) => s.activeTabId);
  const isReadOnly = useIsActiveTabReadOnly();
  const penMode = usePenStore((s) => s.mode);
  const isDark = useAppStore((s) => s.theme) === "dark";
  const dotColor = isDark ? "rgba(155,172,205,0.24)" : "rgba(70,85,115,0.20)";
  const lineColor = isDark ? "rgba(150,165,195,0.05)" : "rgba(70,85,115,0.05)";
  const minimapMask = isDark ? "rgba(9,11,14,0.7)" : "rgba(228,232,240,0.6)";
  const penActive = penMode !== "off";

  // Re-fit the viewport whenever the user switches canvas tabs
  const initialTabRef = useRef(true);
  useEffect(() => {
    if (initialTabRef.current) {
      initialTabRef.current = false;
      return; // initial mount already handled by the `fitView` prop
    }
    // Wait one frame so the new tab's nodes are mounted before fitting
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTabId, fitView]);

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
      if (penActive) return;
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
      statusSignature === ""
        ? () => "#52525b"
        : (node: Node) => {
            const status = getLatestSnapshot()?.nodes[node.id]?.status;
            if (status === "critical" || status === "down") return "#ef4444";
            if (status === "warn") return "#f59e0b";
            if (status === "ok") return "#10b981";
            return "#52525b";
          },
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
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={isReadOnly ? undefined : onConnect}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          selectionOnDrag={!penActive}
          panOnScroll={!penActive}
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
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
          fitView
          proOptions={{ hideAttribution: true }}
          panOnDrag={penActive ? false : [1]}
          zoomOnScroll={!penActive}
          zoomOnPinch={!penActive}
          nodesDraggable={!penActive && !isReadOnly}
          nodesConnectable={!penActive && !isReadOnly}
          elementsSelectable={!penActive}
          connectionRadius={30}
          deleteKeyCode={null}
          snapToGrid
          snapGrid={[16, 16]}
        >
          {/* Two-tier grid (fine dots + faint coarse lines), both edge-masked. */}
          <Background
            id="grid-lines"
            variant={BackgroundVariant.Lines}
            gap={120}
            lineWidth={1}
            color={lineColor}
            className="!bg-transparent"
          />
          <Background
            id="grid-dots"
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color={dotColor}
            className="!bg-transparent"
          />
          <Controls
            className="!rounded-md !border !border-zinc-800 !bg-zinc-900 !shadow-sm [&>button]:!border-zinc-800 [&>button]:!bg-zinc-900 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-800 [&>button:hover]:!text-zinc-200"
            position="bottom-left"
          />
          <MiniMap
            className="!hidden !rounded-md !border !border-zinc-800 !bg-zinc-900 md:!block"
            maskColor={minimapMask}
            nodeColor={miniMapNodeColor}
            position="bottom-right"
            // Lifted above the corner Support FAB so the two don't overlap
            style={{ width: 140, height: 90, bottom: 72 }}
          />
          <FlowParticles />
        </ReactFlow>

        <PenOverlay />
        <PenToolbar />
        <ChaosTimeline />
        {menu && <CanvasContextMenu menu={menu} onClose={closeMenu} />}

        {/* Read-only hint for reference tabs */}
        {isReadOnly && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-cyan-500/30 bg-zinc-900/90 px-3 py-1 text-[11px] font-medium text-cyan-400 shadow-sm backdrop-blur">
            <Lock className="h-3 w-3" />
            Read-only reference
          </div>
        )}
      </div>

      {/* Welcome / empty state */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 pb-4 md:pb-0">
          <motion.div
            variants={emptyContainer}
            initial="hidden"
            animate="show"
            className="pointer-events-auto flex w-full max-w-lg flex-col items-center gap-6 text-center"
          >
            <motion.div
              variants={emptyItem}
              className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-transparent shadow-[0_0_40px_-10px_rgba(6,182,212,0.4)]"
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
          ? "border-cyan-500/30 hover:border-cyan-400/60 hover:shadow-[0_0_24px_-8px_rgba(6,182,212,0.5)]"
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
