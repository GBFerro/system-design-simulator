"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useReactFlow } from "@xyflow/react";
import { LayoutGrid } from "lucide-react";
import { StageCard } from "@/components/layout/StageCard";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { getComponentById } from "@/data/components";
import { defaultTechnologyOf } from "@/domain/components/technologies";
import { useIsActiveTabReadOnly } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { usePrefersReducedMotion } from "@/hooks/useBreakpoint";
import { addComponentNode } from "@/lib/addComponent";
import { isoArchetypeOf, isoTintOf } from "@/lib/iso";
import { DOCK_GAP, DOCK_HEIGHT, DOCK_PANEL_WIDTH } from "@/lib/stageLayout";
import type { PaletteDragData } from "./PaletteDnd";
import { IsoModel } from "./nodes/IsoModel";

/** The dock's tiles, in order: the eight kinds a first design is made of. */
export const DOCK_COMPONENT_IDS = [
  "client",
  "cdn",
  "load-balancer",
  "app-server",
  "cache",
  "sql-db",
  "read-replica",
  "message-queue",
] as const;

/** A clicked tile's press and "+1" badge are gone after this long (the badge's 700 ms, with room). */
const FEEDBACK_MS = 900;
/** Tall as the panel opens, shrunk to what the screen leaves above the dock. */
const PANEL_HEIGHT = 440;
const PANEL_ID = "dock-all-components";

/**
 * The live region that says what was added ("Added App Server"). A `role="status"` of its own:
 * the toast has no `aria-live`, so the announcement does not rely on it. It is always mounted, so the
 * first announcement is read.
 */
export function AddAnnouncer() {
  const announcement = useAppStore((s) => s.announcement);
  return (
    <div role="status" aria-live="polite" data-testid="add-announcer" className="sr-only">
      {announcement && <span key={announcement.n}>{announcement.text}</span>}
    </div>
  );
}

/**
 * One tile of the dock: the kind's isometric model and its name. A click, Enter or Space adds it at
 * the visible center of the canvas; dragging it onto the canvas drops it where the pointer is (the
 * same drag source as the palette, `PaletteDndProvider`). It keeps `data-palette-item`.
 */
function DockTile({ componentId }: { componentId: string }) {
  const component = getComponentById(componentId);
  const { screenToFlowPosition } = useReactFlow();
  const readOnly = useIsActiveTabReadOnly();
  const reduceMotion = usePrefersReducedMotion();
  // A central type starts with its default technology, as in the palette (TEC-22)
  const technology = defaultTechnologyOf(componentId);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `dock:${componentId}`,
    data: { componentId, technology } satisfies PaletteDragData,
  });
  // The press and the "+1": set by a click that added a node, cleared on a timer
  const [feedback, setFeedback] = useState(0);
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clear.current) clearTimeout(clear.current);
    },
    [],
  );
  if (!component) return null;

  function handleClick() {
    // (a reference tab gets the read-only toast from the add function and no feedback)
    const id = addComponentNode(componentId, { tap: screenToFlowPosition }, technology);
    if (id === null || reduceMotion) return;
    setFeedback((n) => n + 1);
    if (clear.current) clearTimeout(clear.current);
    clear.current = setTimeout(() => setFeedback(0), FEEDBACK_MS);
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      onClick={handleClick}
      data-palette-item={componentId}
      data-pressed={feedback > 0 ? "" : undefined}
      aria-label={`Add ${component.label} to canvas`}
      aria-disabled={readOnly ? "true" : undefined}
      style={{ touchAction: "manipulation" }}
      className={`group relative flex h-[76px] w-[80px] shrink-0 flex-col items-center justify-start rounded-[10px] px-1 pb-1 pt-1 text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500 ${
        readOnly ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {/* the press is the model's: the tile around it stays put under the pointer */}
      <span
        key={feedback}
        className={`flex h-[48px] w-[48px] items-end justify-center ${feedback > 0 ? "dock-press" : ""}`}
        data-dock-model=""
      >
        <IsoModel
          archetype={isoArchetypeOf(componentId)}
          tint={isoTintOf(componentId, component.category)}
          className="h-[48px] w-[48px]"
        />
      </span>
      <span className="mt-0.5 line-clamp-2 w-full text-center text-[10px] font-medium leading-[1.15]">
        {component.label}
      </span>
      {feedback > 0 && (
        <span
          key={`plus-${feedback}`}
          aria-hidden="true"
          data-dock-plus=""
          className="dock-plus pointer-events-none absolute right-2 top-0.5 rounded-full bg-cyan-500 px-1.5 text-[10px] font-semibold leading-4 text-white"
        >
          +1
        </span>
      )}
    </button>
  );
}

interface ComponentDockProps {
  /** Shown or not (the top bar's "Toggle sidebar"): closed, the dock and its panel are hidden. */
  open: boolean;
  /** Whether the "All components" panel is open; controlled by the shell, which closes it on a drag. */
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onCreateCustomComponent?: () => void;
  /** Position of the area the dock and its panel live in: from the shell's stage metrics. */
  style: CSSProperties;
}

/**
 * The dock (slice 4): a floating card at the bottom of the canvas with the eight common components
 * as tiles and an "All components" button that opens a panel above it, holding the whole palette
 * with its search. Desktop only (the shell does not render it below 768 px). The panel stays
 * mounted while closed, so the palette keeps its search and its open technologies, but hidden: its
 * items are not visible, not focusable and not in the accessibility tree then.
 */
export function ComponentDock({
  open,
  panelOpen,
  onPanelOpenChange,
  onCreateCustomComponent,
  style,
}: ComponentDockProps) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showPanel = open && panelOpen;

  // Escape closes the panel and gives the focus back to its button. The shell does the same on
  // Escape, but not while a field has the focus (the search box).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onPanelOpenChange(false);
      toggleRef.current?.focus();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [onPanelOpenChange]);

  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-col-reverse items-center"
      style={{ ...style, gap: DOCK_GAP }}
    >
      <StageCard
        testId="stage-dock"
        open={open}
        role="toolbar"
        ariaLabel="Components"
        className="pointer-events-auto max-w-full shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
        style={{ height: DOCK_HEIGHT }}
      >
        <div className="flex h-full w-max items-center gap-1 px-2">
          {DOCK_COMPONENT_IDS.map((id) => (
            <DockTile key={id} componentId={id} />
          ))}
          <span aria-hidden="true" className="mx-1 h-12 w-px shrink-0 bg-zinc-800" />
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={showPanel}
            aria-controls={PANEL_ID}
            onClick={() => onPanelOpenChange(!panelOpen)}
            className="flex h-[76px] w-[84px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-500 aria-expanded:bg-zinc-800 aria-expanded:text-cyan-400"
          >
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            <span className="leading-[1.15]">All components</span>
          </button>
        </div>
      </StageCard>

      {/* Not a stage card: open for a moment, it moves neither the visible center nor a fit. A
          component added from it lands at the center and the panel closes, as the mobile drawer
          does; a drag from it closes it too (the shell). */}
      <div
        id={PANEL_ID}
        data-testid="stage-dock-panel"
        role="region"
        aria-label="All components"
        aria-hidden={showPanel ? undefined : true}
        inert={showPanel ? undefined : true}
        ref={panelRef}
        className="pointer-events-auto flex min-h-0 shrink flex-col self-start overflow-hidden bg-zinc-900 shadow-lg"
        style={{
          width: DOCK_PANEL_WIDTH,
          height: PANEL_HEIGHT,
          borderRadius: "var(--sf-radius)",
          borderWidth: "var(--sf-border-w)",
          borderStyle: "solid",
          borderColor: "var(--sf-line)",
          // hidden, not display:none: a drag that starts here closes it, and the drag keeps measuring its source
          visibility: showPanel ? "visible" : "hidden",
        }}
      >
        <Sidebar
          onCreateCustomComponent={onCreateCustomComponent}
          onComponentAdded={() => onPanelOpenChange(false)}
          variant="desktop"
        />
      </div>
    </div>
  );
}
