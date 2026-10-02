"use client";

import { useCallback, useEffect, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import type { QuickFix } from "@/advisor/types";
import { GHOST_PREFIX } from "@/components/canvas/previewGraph";
import { paddingAboveSheet } from "@/lib/placement";
import { applyPreview, setFixPreview, useAdvisorStore } from "@/store/advisorStore";

/**
 * Quick-fix preview UI shared by the Advisor (Spec 12) and the Chaos tab's
 * mitigations (Spec 08, CHS-06): a banner while a fix is drawn on the
 * canvas, Preview/Apply buttons, and framing the fix's nodes. The preview
 * itself lives in `advisorStore` (`preview`).
 */

export const FIX_BUTTON =
  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export const READ_ONLY_TITLE = "Reference designs are read-only";

/**
 * Frame nodes on the canvas from a panel (above the mobile bottom sheet).
 * `framePreview` waits a frame so the preview's ghost nodes are mounted.
 */
export function useFrameNodes(from: RefObject<Element | null>) {
  const { fitView } = useReactFlow();
  const frame = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      void fitView({
        nodes: ids.map((id) => ({ id })),
        duration: 300,
        padding: paddingAboveSheet(from.current, 0.6),
        maxZoom: 1.2,
      });
    },
    [fitView, from],
  );
  const framePreview = useCallback(
    (targetIds: string[]) => {
      const ghosts = (useAdvisorStore.getState().preview?.diff.addNodes ?? []).map(
        (n) => GHOST_PREFIX + n.id,
      );
      requestAnimationFrame(() => frame([...targetIds, ...ghosts]));
    },
    [frame],
  );
  return { frame, framePreview };
}

/** The preview ends when the panel showing it unmounts, and on Escape. */
export function useEndPreviewOnLeave(): void {
  const previewing = useAdvisorStore((s) => s.preview !== null);
  useEffect(() => () => setFixPreview("", null), []);
  useEffect(() => {
    if (!previewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFixPreview("", null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewing]);
}

/** "Previewing: …" with Apply / Cancel, while a fix is drawn on the canvas. */
export function FixPreviewBanner({ readOnly }: { readOnly: boolean }) {
  const label = useAdvisorStore((s) => s.preview?.label);
  if (!label) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-violet-500/40 bg-violet-950/30 px-2.5 py-2"
      role="status"
      data-testid="advisor-preview"
    >
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-violet-100">
        Previewing: {label}. Dashed violet is new or changed, dashed rose goes away.
      </p>
      <button
        type="button"
        onClick={applyPreview}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        className={`${FIX_BUTTON} bg-violet-500 text-white hover:bg-violet-400`}
      >
        Apply
      </button>
      <button
        type="button"
        onClick={() => setFixPreview("", null)}
        className={`${FIX_BUTTON} text-zinc-300 hover:bg-zinc-700`}
      >
        Cancel
      </button>
    </div>
  );
}

/** A fix's label with Preview (toggle) and Apply. */
export function FixActions({
  fix,
  previewing,
  readOnly,
  onPreview,
  onApply,
}: {
  fix: QuickFix;
  previewing: boolean;
  readOnly: boolean;
  onPreview: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Wand2 className="h-3 w-3 shrink-0 text-violet-300" aria-hidden />
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-300">{fix.label}</span>
      <button
        type="button"
        onClick={onPreview}
        aria-pressed={previewing}
        aria-label={`${previewing ? "Hide preview" : "Preview"}: ${fix.label}`}
        className={`${FIX_BUTTON} flex items-center gap-1 ${
          previewing
            ? "bg-violet-500/30 text-violet-100"
            : "text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
        }`}
      >
        {previewing ? (
          <EyeOff className="h-3 w-3" aria-hidden />
        ) : (
          <Eye className="h-3 w-3" aria-hidden />
        )}
        {previewing ? "Hide" : "Preview"}
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined}
        aria-label={`Apply: ${fix.label}`}
        className={`${FIX_BUTTON} bg-violet-500/20 text-violet-200 hover:bg-violet-500/30`}
      >
        Apply
      </button>
    </div>
  );
}
