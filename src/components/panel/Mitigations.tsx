"use client";

import { useMemo, type RefObject } from "react";
import { ShieldCheck } from "lucide-react";
import { mitigationsFor } from "@/advisor/mitigation";
import type { FaultSpec } from "@/engine/faults/types";
import {
  advisorContext,
  applyQuickFix,
  setFixPreview,
  useAdvisorStore,
} from "@/store/advisorStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { FixActions, useFrameNodes } from "./FixPreview";

/** Stable key of a fault's target, for preview keys. */
function faultKey(fault: FaultSpec): string {
  return `${fault.type}@${fault.target.kind}:${fault.target.id ?? ""}`;
}

/**
 * How to limit a fault's damage (Spec 08, CHS-06): the fault type's tips for
 * this design, with the advisor's quick fixes (Spec 12) where one applies —
 * previewed on the canvas and applied as one undo step, live runs included
 * (the engine hot-swaps the graph and the fault stays on its target).
 */
export function Mitigations({
  fault,
  frameFrom,
  open = false,
}: {
  fault: FaultSpec;
  /** Element inside the panel, to frame the fix above the mobile sheet. */
  frameFrom: RefObject<Element | null>;
  open?: boolean;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const readOnly = useIsActiveTabReadOnly();
  // The run's load, the read mix and the design: what the fixes size from.
  const contextVersion = useAdvisorStore((s) => s.contextVersion);
  const previewKey = useAdvisorStore((s) => (s.preview?.fromFinding ? null : s.preview?.key));
  const { framePreview } = useFrameNodes(frameFrom);
  const tips = useMemo(
    // `contextVersion` is the change signal for `advisorContext()`.
    () => (contextVersion >= 0 ? mitigationsFor(fault, { nodes, edges }, advisorContext()) : []),
    [fault, nodes, edges, contextVersion],
  );
  if (tips.length === 0) return null;
  const base = faultKey(fault);
  const targets = fault.target.id && fault.target.kind === "node" ? [fault.target.id] : [];

  return (
    <details className="group" open={open} data-testid="chaos-mitigations">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> How to mitigate ({tips.length})
      </summary>
      <ul className="mt-1.5 space-y-1.5">
        {tips.map((t) => {
          const key = `${base}#${t.id}`;
          const previewing = previewKey === key;
          return (
            <li
              key={t.id}
              data-mitigation={t.id}
              className={`space-y-1 rounded-md border px-2 py-1.5 ${
                previewing
                  ? "border-violet-400/60 bg-violet-950/20"
                  : "border-zinc-700/70 bg-zinc-800/40"
              }`}
            >
              <p className="text-[11px] leading-snug text-zinc-300">{t.text}</p>
              {t.fix && (
                <FixActions
                  fix={t.fix}
                  previewing={previewing}
                  readOnly={readOnly}
                  onPreview={() => {
                    if (previewing) return setFixPreview(key, null);
                    setFixPreview(key, t.fix!);
                    framePreview(targets);
                  }}
                  onApply={() => applyQuickFix(t.fix!)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
