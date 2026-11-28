"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useReactFlow } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import { getTechnology } from "@/domain/components/technologies";
import { addComponentNode } from "@/lib/addComponent";
import { isoArchetypeOf, isoTintOf } from "@/lib/iso";
import { pointOverCanvas } from "@/lib/stageLayout";
import { isActiveTabReadOnly, useCanvasStore } from "@/store/canvasStore";
import { IsoModel } from "./nodes/IsoModel";

/** Marks the element that accepts palette drops (the canvas area in DesignCanvas). */
export const CANVAS_DROP_ATTR = "data-canvas-drop";
/**
 * Set on that element ("true") only while a drag's pointer is over a place that accepts the drop:
 * on the canvas, under no floating card, on a tab that can be edited (slice 4, criterion 31).
 */
export const DROP_ACTIVE_ATTR = "data-drop-active";

/** Whether a drop at `p` would add a node: over the canvas, clear of the cards, on an editable tab. */
function acceptsDrop(p: { x: number; y: number } | null): boolean {
  return !!p && isOverCanvas(p) && !isActiveTabReadOnly(useCanvasStore.getState());
}

function markDropActive(on: boolean) {
  const el = document.querySelector(`[${CANVAS_DROP_ATTR}]`);
  if (!el) return;
  if (on) el.setAttribute(DROP_ACTIVE_ATTR, "true");
  else el.removeAttribute(DROP_ACTIVE_ATTR);
}

/** Over the canvas, but not over a floating card (stage layout) that covers part of it. */
function isOverCanvas(p: { x: number; y: number }): boolean {
  return pointOverCanvas(
    p,
    document.querySelector(`[${CANVAS_DROP_ATTR}]`)?.getBoundingClientRect(),
    [...document.querySelectorAll("[data-stage-card]")].map((c) => c.getBoundingClientRect()),
  );
}

export interface PaletteDragData {
  componentId: string;
  /** The technology the new node starts with (component-technologies); omitted = generic. */
  technology?: string;
}

function clientPoint(event: Event): { x: number; y: number } | null {
  if ("touches" in event) {
    const t = (event as TouchEvent).touches[0] ?? (event as TouchEvent).changedTouches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  if ("clientX" in event)
    return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  return null;
}

/**
 * Drag from the component palette onto the canvas, one path for mouse and
 * touch. Mouse starts after 6px of movement (so clicks still work); touch
 * starts after a short press so the palette list can still scroll.
 */
export function PaletteDndProvider({
  children,
  onPaletteDragStart,
}: {
  children: ReactNode;
  /** e.g. close the mobile library drawer so the canvas is visible. */
  onPaletteDragStart?: () => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const [active, setActive] = useState<PaletteDragData | null>(null);
  // Where the pointer/finger actually is. dnd-kit's `delta` is adjusted for
  // scrolling of the palette list, which is not what a drop point needs.
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  useEffect(() => () => stopTracking.current?.(), []);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as PaletteDragData | undefined;
    if (!data) return;
    setActive(data);
    lastPoint.current = clientPoint(event.activatorEvent);
    markDropActive(acceptsDrop(lastPoint.current));
    const track = (e: Event) => {
      const p = clientPoint(e);
      if (!p) return;
      lastPoint.current = p;
      markDropActive(acceptsDrop(p));
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("mousemove", track, opts);
    window.addEventListener("touchmove", track, opts);
    stopTracking.current = () => {
      window.removeEventListener("mousemove", track, opts);
      window.removeEventListener("touchmove", track, opts);
      markDropActive(false);
      stopTracking.current = null;
    };
    onPaletteDragStart?.();
  }

  function handleDragEnd(event: DragEndEvent) {
    setActive(null);
    stopTracking.current?.();
    const point = lastPoint.current;
    const data = event.active.data.current as PaletteDragData | undefined;
    // Geometry, not DOM hit-testing: the empty-state overlay sits on top of the
    // canvas and must not swallow drops (bug B1)
    if (!data || !point || !isOverCanvas(point)) return;
    if (isActiveTabReadOnly(useCanvasStore.getState())) return;

    // Centered under the pointer; the one add function announces it and returns the node's id
    addComponentNode(data.componentId, { drop: screenToFlowPosition(point) }, data.technology);
  }

  const activeComponent = active ? getComponentById(active.componentId) : undefined;
  const activeTech = active?.technology
    ? getTechnology(active.componentId, active.technology)
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActive(null);
        stopTracking.current?.();
      }}
      autoScroll={false}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeComponent && (
          // The model, lifted off the ground: scaled up with its shadow cast on the floor below it
          <div
            data-drag-lift=""
            className="pointer-events-none relative flex w-[88px] flex-col items-center"
            style={{ transform: "scale(1.06)", transformOrigin: "50% 100%" }}
          >
            <span
              data-drag-shadow=""
              aria-hidden="true"
              className="absolute bottom-[22px] left-1/2 h-3 w-12 -translate-x-1/2 rounded-[50%] bg-[var(--iso-shadow)] opacity-25 blur-[3px]"
            />
            <IsoModel
              archetype={isoArchetypeOf(activeComponent.id)}
              tint={isoTintOf(activeComponent.id, activeComponent.category)}
              className="relative h-[64px] w-[64px] [filter:drop-shadow(0_8px_6px_color-mix(in_srgb,var(--iso-shadow)_30%,transparent))]"
            />
            <span className="relative mt-0.5 max-w-full truncate rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] font-medium text-zinc-200">
              {activeTech ? activeTech.label : activeComponent.label}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
