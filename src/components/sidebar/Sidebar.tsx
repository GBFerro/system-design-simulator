"use client";

import { ComponentPalette } from "./ComponentPalette";

interface SidebarProps {
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

  // The dock's "All components" panel (`ComponentDock`) sizes, shows and hides it: this fills it.
  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <SidebarPalette
        onCreateCustomComponent={onCreateCustomComponent}
        onComponentAdded={onComponentAdded}
      />
    </aside>
  );
}
