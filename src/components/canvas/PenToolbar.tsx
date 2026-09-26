"use client";

import { useState } from "react";
import { Pen, Eraser, Trash2 } from "lucide-react";
import { usePenStore, PEN_COLORS, PEN_WIDTHS } from "@/store/penStore";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";

export function PenToolbar() {
  const mode = usePenStore((s) => s.mode);
  const color = usePenStore((s) => s.color);
  const width = usePenStore((s) => s.width);
  const strokes = usePenStore((s) => s.strokes);
  const setMode = usePenStore((s) => s.setMode);
  const setColor = usePenStore((s) => s.setColor);
  const setWidth = usePenStore((s) => s.setWidth);
  const clearAll = usePenStore((s) => s.clearAll);

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/90 p-1 shadow-lg backdrop-blur">
        <button
          onClick={() => setMode(mode === "pen" ? "off" : "pen")}
          className={`flex h-7 w-7 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 items-center justify-center rounded transition-colors ${
            mode === "pen"
              ? "bg-cyan-500/20 text-cyan-400"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
          title="Pen (draw on canvas)"
          aria-label="Pen tool"
          aria-pressed={mode === "pen"}
        >
          <Pen className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setMode(mode === "eraser" ? "off" : "eraser")}
          className={`flex h-7 w-7 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 items-center justify-center rounded transition-colors ${
            mode === "eraser"
              ? "bg-rose-500/20 text-rose-400"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
          title="Eraser"
          aria-label="Eraser tool"
          aria-pressed={mode === "eraser"}
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>

        {mode !== "off" && (
          <>
            <div className="mx-1 h-4 w-px bg-zinc-800" />

            <div className="flex items-center gap-1">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border transition-transform [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${
                    color === c ? "scale-110 border-white" : "border-zinc-700 hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                  aria-label={`Pen color ${c}`}
                />
              ))}
            </div>

            <div className="mx-1 h-4 w-px bg-zinc-800" />

            <div className="flex items-center gap-1">
              {PEN_WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  className={`flex h-5 w-5 items-center justify-center rounded transition-colors [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${
                    width === w ? "bg-zinc-700" : "hover:bg-zinc-800"
                  }`}
                  title={`${w}px stroke width`}
                  aria-label={`Stroke width ${w}px`}
                >
                  <div
                    className="rounded-full bg-zinc-300"
                    style={{
                      width: `${Math.min(w / 2 + 2, 14)}px`,
                      height: `${Math.min(w / 2 + 2, 14)}px`,
                    }}
                  />
                </button>
              ))}
            </div>
          </>
        )}

        {strokes.length > 0 && (
          <>
            <div className="mx-1 h-4 w-px bg-zinc-800" />
            <button
              onClick={() => setConfirmOpen(true)}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
              title="Clear all drawings"
              aria-label="Clear all drawings"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Clear all drawings?"
        message={`This will remove ${strokes.length} drawing${strokes.length === 1 ? "" : "s"} from the canvas. This can't be undone.`}
        confirmText="Clear all"
        danger
        onConfirm={clearAll}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
