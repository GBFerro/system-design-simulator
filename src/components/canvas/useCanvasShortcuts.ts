"use client";

import { useEffect } from "react";
import type { XYPosition } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { usePenStore } from "@/store/penStore";
import { isTypingTarget } from "./canvasEvents";

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
const NUDGE = 16; // one grid step; Shift = 4 steps (matches ReactFlow's own focused-node nudge)

/**
 * Editing shortcuts that act on the canvas selection. Lives inside the
 * ReactFlow provider because paste needs screen→flow conversion. This is the
 * ONLY delete path (ReactFlow runs with deleteKeyCode={null}).
 */
export function useCanvasShortcuts({
  getPasteCenter,
  openMenuForSelection,
}: {
  getPasteCenter: () => XYPosition;
  openMenuForSelection: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // Already handled — e.g. ReactFlow moved a focused node with the arrows
      if (e.defaultPrevented) return;
      if (usePenStore.getState().mode !== "off") return;

      const s = useCanvasStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const hasSelection = s.nodes.some((n) => n.selected) || s.edges.some((ed) => ed.selected);

      if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        if (hasSelection) {
          e.preventDefault();
          s.deleteSelection();
        }
        return;
      }

      if (mod && !e.altKey && !e.shiftKey) {
        if (key === "c") {
          // Leave real text selections (e.g. in the panel) to the browser
          if (window.getSelection()?.toString()) return;
          const copied = s.copySelection();
          if (copied) {
            e.preventDefault();
            useAppStore
              .getState()
              .showToast(`Copied ${copied} item${copied > 1 ? "s" : ""}`, "info");
          }
          return;
        }
        if (key === "v") {
          if (!s.clipboard) return;
          e.preventDefault();
          s.pasteClipboard(getPasteCenter());
          return;
        }
        if (key === "d") {
          e.preventDefault(); // browser bookmark
          s.duplicateSelection();
          return;
        }
        if (key === "a") {
          e.preventDefault();
          s.selectAll();
          return;
        }
      }

      if (!mod && e.key in ARROWS && s.nodes.some((n) => n.selected)) {
        e.preventDefault();
        const [dx, dy] = ARROWS[e.key];
        const step = e.shiftKey ? NUDGE * 4 : NUDGE;
        s.nudgeSelection(dx * step, dy * step);
        return;
      }

      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        openMenuForSelection();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getPasteCenter, openMenuForSelection]);
}
