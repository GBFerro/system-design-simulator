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
import { Server } from "lucide-react";
import { getComponentById } from "@/data/components";
import { ICON_MAP } from "@/lib/icons";
import { createComponentNode } from "@/lib/nodeFactory";
import { DEFAULT_NODE_SIZE } from "@/lib/placement";
import { isActiveTabReadOnly, useCanvasStore } from "@/store/canvasStore";

/** Marks the element that accepts palette drops (the canvas area in DesignCanvas). */
export const CANVAS_DROP_ATTR = "data-canvas-drop";

function isOverCanvas(p: { x: number; y: number }): boolean {
  const r = document.querySelector(`[${CANVAS_DROP_ATTR}]`)?.getBoundingClientRect();
  return !!r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export interface PaletteDragData {
  componentId: string;
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
  const [activeId, setActiveId] = useState<string | null>(null);
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
    setActiveId(data.componentId);
    lastPoint.current = clientPoint(event.activatorEvent);
    const track = (e: Event) => {
      const p = clientPoint(e);
      if (p) lastPoint.current = p;
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("mousemove", track, opts);
    window.addEventListener("touchmove", track, opts);
    stopTracking.current = () => {
      window.removeEventListener("mousemove", track, opts);
      window.removeEventListener("touchmove", track, opts);
      stopTracking.current = null;
    };
    onPaletteDragStart?.();
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    stopTracking.current?.();
    const point = lastPoint.current;
    const data = event.active.data.current as PaletteDragData | undefined;
    // Geometry, not DOM hit-testing: the empty-state overlay sits on top of the
    // canvas and must not swallow drops (bug B1)
    if (!data || !point || !isOverCanvas(point)) return;
    const canvas = useCanvasStore.getState();
    if (isActiveTabReadOnly(canvas)) return;

    const component = getComponentById(data.componentId);
    if (!component) return;

    const drop = screenToFlowPosition(point);
    // Center the new node under the pointer
    canvas.addNode(
      createComponentNode(component, {
        x: drop.x - DEFAULT_NODE_SIZE.width / 2,
        y: drop.y - DEFAULT_NODE_SIZE.height / 2,
      }),
    );
  }

  const active = activeId ? getComponentById(activeId) : undefined;
  const Icon = active ? (ICON_MAP[active.icon] ?? Server) : Server;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        stopTracking.current?.();
      }}
      autoScroll={false}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="flex w-max items-center gap-2 rounded-lg border border-cyan-500/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 shadow-lg">
            <Icon className="h-3.5 w-3.5 text-cyan-400" />
            {active.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
