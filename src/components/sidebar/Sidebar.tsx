"use client";

import { ComponentPalette } from "./ComponentPalette";

interface SidebarProps {
  open?: boolean;
  onCreateCustomComponent?: () => void;
  /** Called after a component is added from the palette (closes the mobile drawer). */
  onComponentAdded?: () => void;
  variant?: "desktop" | "mobile";
}

/**
 * The palette: the Design step's tool (the Problem step has the problems and the
 * learning path on its own screen). The canvas stays editable in the other steps
 * through Props, the context menu, shortcuts and the advisor's fixes.
 */
function SidebarPalette({
  onCreateCustomComponent,
  onComponentAdded,
}: {
  onCreateCustomComponent?: () => void;
  onComponentAdded?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ComponentPalette
        onCreateCustomComponent={onCreateCustomComponent}
        onComponentAdded={onComponentAdded}
      />
    </div>
  );
}

export function Sidebar({
  open = true,
  onCreateCustomComponent,
  onComponentAdded,
  variant = "desktop",
}: SidebarProps) {
  if (variant === "mobile") {
    return (
      <div className="flex h-full w-full flex-col bg-zinc-900">
        <SidebarPalette
          onCreateCustomComponent={onCreateCustomComponent}
          onComponentAdded={onComponentAdded}
        />
      </div>
    );
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 overflow-hidden transition-all duration-200 md:flex ${
        open ? "w-[280px] opacity-100" : "w-0 opacity-0 border-r-0"
      }`}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div className="flex w-[280px] flex-1 flex-col min-h-0">
        <SidebarPalette onCreateCustomComponent={onCreateCustomComponent} />
      </div>
    </aside>
  );
}
