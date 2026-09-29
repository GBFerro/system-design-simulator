"use client";

import { useCallback, useId, useState, type ReactNode, type Ref } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useReactFlow } from "@xyflow/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SYSTEM_COMPONENTS, COMPONENT_CATEGORIES, getComponentById } from "@/data/components";
import { CONCEPT_LIBRARY } from "@/data/conceptLibrary";
import { Server, GripVertical, Plus, Search as SearchIcon, Sparkles, Trash2 } from "lucide-react";
import { ICON_MAP } from "@/lib/icons";
import { useCanvasStore } from "@/store/canvasStore";
import { createComponentNode } from "@/lib/nodeFactory";
import { visibleCanvasCenter } from "@/lib/placement";
import type { PaletteDragData } from "@/components/canvas/PaletteDnd";
import { useAppStore } from "@/store/appStore";
import { useCustomComponentsStore } from "@/store/customComponentsStore";
import { useIsCoarsePointer } from "@/hooks/useBreakpoint";
import type { SystemComponent } from "@/types/component";

const CATEGORY_ACCENT: Record<string, string> = {
  networking: "text-blue-400",
  compute: "text-violet-400",
  storage: "text-amber-400",
  messaging: "text-emerald-400",
  infrastructure: "text-cyan-400",
};

const CATEGORY_BG: Record<string, string> = {
  networking: "bg-blue-400/10",
  compute: "bg-violet-400/10",
  storage: "bg-amber-400/10",
  messaging: "bg-emerald-400/10",
  infrastructure: "bg-cyan-400/10",
};

interface ComponentPaletteProps {
  onCreateCustomComponent?: () => void;
  /** Called after a component is added via tap/quick-add (e.g. to close a mobile drawer). */
  onComponentAdded?: () => void;
}

export function ComponentPalette({
  onCreateCustomComponent,
  onComponentAdded,
}: ComponentPaletteProps = {}) {
  const [search, setSearch] = useState("");
  const { screenToFlowPosition } = useReactFlow();
  const placeNode = useCanvasStore((s) => s.placeNode);
  // Two palettes can be mounted at once (desktop sidebar + mobile drawer)
  const dragIdPrefix = useId();
  const customComponents = useCustomComponentsStore((s) => s.components);
  const deleteCustomComponent = useCustomComponentsStore((s) => s.deleteComponent);
  const isCoarse = useIsCoarsePointer();

  const allComponents: SystemComponent[] = [...customComponents, ...SYSTEM_COMPONENTS];
  const customIds = new Set(customComponents.map((c) => c.id));

  /** Tap-to-add: place the component near the visible canvas center, clear of other nodes. */
  const handleQuickAdd = useCallback(
    (componentId: string) => {
      const component = getComponentById(componentId);
      if (!component) return;
      const { tabs, activeTabId } = useCanvasStore.getState();
      if (tabs.find((t) => t.id === activeTabId)?.readOnly) {
        useAppStore.getState().showToast("Reference tabs are read-only", "info");
        return;
      }
      placeNode(
        createComponentNode(component, { x: 0, y: 0 }),
        visibleCanvasCenter(screenToFlowPosition),
      );
      useAppStore.getState().showToast(`Added ${component.label}`, "success");
      onComponentAdded?.();
    },
    [screenToFlowPosition, placeNode, onComponentAdded],
  );

  const query = search.toLowerCase().trim();

  const matches = (c: SystemComponent) =>
    query === "" ||
    c.label.toLowerCase().includes(query) ||
    c.description.toLowerCase().includes(query);

  const totalMatches = query ? allComponents.filter(matches).length : allComponents.length;

  const handleDeleteCustom = (e: React.MouseEvent, id: string, label: string) => {
    e.stopPropagation();
    e.preventDefault();
    deleteCustomComponent(id);
    useAppStore.getState().showToast(`Removed ${label}`, "info");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            aria-label="Search components"
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 py-2 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors focus:border-cyan-500"
          />
        </div>
        {query && (
          <p className="mt-1.5 text-[10px] text-zinc-400">
            {totalMatches === 0
              ? "No matches"
              : `${totalMatches} component${totalMatches === 1 ? "" : "s"} match "${search}"`}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-4 p-3">
          {onCreateCustomComponent && (
            <button
              onClick={onCreateCustomComponent}
              className="group flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-700 bg-zinc-800/40 px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:border-cyan-500/50 hover:bg-zinc-800 hover:text-cyan-300"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span className="flex-1 text-left">Create custom component</span>
              <Plus className="h-3 w-3 shrink-0 text-zinc-500 group-hover:text-cyan-400" />
            </button>
          )}
          {COMPONENT_CATEGORIES.map((cat) => {
            const items = allComponents.filter((c) => c.category === cat.key && matches(c));
            if (query !== "" && items.length === 0) return null;
            return (
              <div key={cat.key}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    {cat.label}
                  </p>
                  <span className="flex h-4 min-w-4 items-center justify-center rounded bg-zinc-800 px-1 text-[10px] font-medium tabular-nums text-zinc-500">
                    {items.length}
                  </span>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>
                <TooltipProvider>
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const Icon = ICON_MAP[item.icon] ?? Server;
                      const accent = CATEGORY_ACCENT[item.category] ?? "text-cyan-400";
                      const iconBg = CATEGORY_BG[item.category] ?? "bg-cyan-400/10";
                      const concept = CONCEPT_LIBRARY[item.id];
                      const tipText = concept?.whenToUse[0] ?? item.description;
                      const isCustom = customIds.has(item.id);
                      return (
                        <Tooltip key={item.id}>
                          <TooltipTrigger
                            render={
                              <PaletteDraggable
                                dragId={`${dragIdPrefix}:${item.id}`}
                                componentId={item.id}
                                // On touch, a quick tap adds the component; press-and-hold drags it
                                onClick={isCoarse ? () => handleQuickAdd(item.id) : undefined}
                              >
                                <GripVertical className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
                                <div
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${iconBg}`}
                                >
                                  <Icon
                                    className={`h-3.5 w-3.5 shrink-0 transition-colors ${accent}`}
                                  />
                                </div>
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {isCustom && (
                                  <span className="shrink-0 rounded bg-cyan-500/15 px-1 text-[9px] font-semibold uppercase tracking-wider text-cyan-400">
                                    Custom
                                  </span>
                                )}
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">
                                  {item.maxQPS === Infinity
                                    ? "\u221e"
                                    : item.maxQPS < 1000
                                      ? String(item.maxQPS)
                                      : `${(item.maxQPS / 1000).toFixed(0)}k`}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickAdd(item.id);
                                  }}
                                  className={`flex ${isCoarse ? "h-9 w-9" : "h-5 w-5"} shrink-0 items-center justify-center rounded text-zinc-500 opacity-60 transition-[opacity,color,background-color] hover:bg-zinc-700 hover:text-cyan-400 hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100`}
                                  title="Add to canvas"
                                  aria-label={`Add ${item.label} to canvas`}
                                >
                                  <Plus className={isCoarse ? "h-4 w-4" : "h-3 w-3"} />
                                </button>
                                {isCustom && (
                                  <button
                                    onClick={(e) => handleDeleteCustom(e, item.id, item.label)}
                                    className={`flex ${isCoarse ? "h-9 w-9" : "h-5 w-5"} shrink-0 items-center justify-center rounded text-zinc-500 opacity-60 transition-[opacity,color,background-color] hover:bg-zinc-700 hover:text-rose-400 hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100`}
                                    title="Delete custom component"
                                    aria-label={`Delete ${item.label}`}
                                  >
                                    <Trash2 className={isCoarse ? "h-4 w-4" : "h-3 w-3"} />
                                  </button>
                                )}
                              </PaletteDraggable>
                            }
                          />
                          <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
                            <p className="text-xs leading-relaxed">{tipText}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </TooltipProvider>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A palette row that can be dragged onto the canvas (see PaletteDndProvider). */
function PaletteDraggable({
  dragId,
  componentId,
  onClick,
  children,
  ref,
  ...rest
}: {
  dragId: string;
  componentId: string;
  onClick?: () => void;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: dragId,
    data: { componentId } satisfies PaletteDragData,
  });
  // The tooltip trigger passes its own ref (for anchoring) — keep both
  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
    },
    [setNodeRef, ref],
  );
  return (
    <div
      {...rest}
      ref={mergedRef}
      {...listeners}
      onClick={onClick}
      data-palette-item={componentId}
      style={{ touchAction: "manipulation" }}
      className={`group flex cursor-grab items-center gap-2 rounded-md px-2 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
    >
      {children}
    </div>
  );
}
