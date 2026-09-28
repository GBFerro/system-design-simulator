"use client";

import { X } from "lucide-react";
import { ModalShell } from "./ModalShell";
import { MOD_KEY } from "@/components/canvas/canvasEvents";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Canvas",
    items: [
      ["Click · Shift/⌘/Ctrl+click", "Select · add to selection"],
      ["Drag on empty canvas", "Box select"],
      ["Space+drag · middle drag · scroll", "Pan"],
      [`${MOD_KEY}scroll · pinch`, "Zoom"],
      ["Right-click · long-press · Shift+F10", "Context menu"],
      ["Tab", "Move focus between nodes"],
    ],
  },
  {
    title: "Edit",
    items: [
      ["Delete · Backspace", "Delete selection"],
      [`${MOD_KEY}C · ${MOD_KEY}V`, "Copy · paste"],
      [`${MOD_KEY}D`, "Duplicate"],
      [`${MOD_KEY}A`, "Select all"],
      ["Arrows · Shift+arrows", "Move 16 px · 64 px"],
      [`${MOD_KEY}Z · ${MOD_KEY}Shift+Z`, "Undo · redo"],
      ["Esc", "Clear selection"],
    ],
  },
  {
    title: "App",
    items: [
      [`${MOD_KEY}K`, "Command palette"],
      [`${MOD_KEY}↵`, "Simulate"],
      ["P", "Play · pause live traffic"],
      [`${MOD_KEY}Shift+S`, "Score"],
      [`${MOD_KEY}S · ${MOD_KEY}O`, "Save · load"],
      ["?", "This list"],
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      ariaLabel="Keyboard shortcuts"
      panelClassName="max-w-lg"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
        <h2 className="font-display text-base font-bold tracking-tight text-zinc-50">
          Keyboard shortcuts
        </h2>
        <button
          onClick={onClose}
          data-autofocus
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-5 px-5 py-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {g.title}
            </p>
            <dl className="space-y-1.5">
              {g.items.map(([keys, action]) => (
                <div key={action} className="flex items-center justify-between gap-4 text-xs">
                  <dt className="text-zinc-300">{action}</dt>
                  <dd className="text-right font-mono text-[11px] text-zinc-400">{keys}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </ModalShell>
  );
}
