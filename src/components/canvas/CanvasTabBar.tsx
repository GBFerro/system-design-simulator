"use client";

import { X } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";

export function CanvasTabBar() {
  const tabs = useCanvasStore((s) => s.tabs);
  const activeTabId = useCanvasStore((s) => s.activeTabId);
  const switchTab = useCanvasStore((s) => s.switchTab);
  const closeTab = useCanvasStore((s) => s.closeTab);

  // Don't render if only 1 tab (default "My Design")
  if (tabs.length <= 1) return null;

  return (
    <div
      data-canvas-tabs
      className="flex h-8 shrink-0 items-center gap-0.5 border-b border-zinc-800 bg-zinc-950 px-2 overflow-x-auto"
    >
      {tabs.map((tab) => (
        // div[role=button] so the close X can be a real, focusable <button>
        // (nesting a button inside a button is invalid HTML)
        <div
          key={tab.id}
          role="button"
          tabIndex={0}
          onClick={() => switchTab(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              switchTab(tab.id);
            }
          }}
          className={`group flex h-6 cursor-pointer items-center gap-1 rounded-md px-2.5 text-[11px] transition-colors ${
            tab.id === activeTabId
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          }`}
        >
          <span className="truncate max-w-[140px]">{tab.label}</span>
          {tab.readOnly && (
            <span className="rounded bg-cyan-500/10 px-1 py-0.5 text-[8px] font-medium text-cyan-400">
              REF
            </span>
          )}
          {tab.id !== "my-design" && (
            <button
              type="button"
              tabIndex={0}
              aria-label={`Close ${tab.label} tab`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              onKeyDown={(e) => {
                // Don't let Enter/Space bubble up and switch the tab
                if (e.key === "Enter" || e.key === " ") e.stopPropagation();
              }}
              className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded opacity-60 transition-opacity hover:bg-zinc-700 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
