"use client";

import { useReactFlow } from "@xyflow/react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Finding, Severity } from "@/advisor/types";
import { useAdvisorStore } from "@/store/advisorStore";
import { useCanvasStore } from "@/store/canvasStore";
import { SECTION_TITLE } from "./styles";

export const SEVERITY_META: Record<
  Severity,
  { label: string; Icon: LucideIcon; text: string; border: string }
> = {
  critical: {
    label: "Critical",
    Icon: OctagonAlert,
    text: "text-rose-400",
    border: "border-rose-500/30 bg-rose-950/20",
  },
  warning: {
    label: "Warning",
    Icon: TriangleAlert,
    text: "text-amber-400",
    border: "border-amber-500/25 bg-amber-950/15",
  },
  info: {
    label: "Info",
    Icon: Info,
    text: "text-sky-400",
    border: "border-zinc-700 bg-zinc-800/50",
  },
};

/**
 * Advisor (Spec 12). Phase 3: structure hints (ADV-03) — no entry point,
 * disconnected nodes, single points of failure — recomputed as you edit.
 * Clicking a finding selects and frames its nodes.
 */
export function AdvisorPanel() {
  const findings = useAdvisorStore((s) => s.findings);
  const hasNodes = useCanvasStore((s) => s.nodes.some((n) => n.type !== "text"));
  const selectOnly = useCanvasStore((s) => s.selectOnly);
  const { fitView } = useReactFlow();

  const focus = (f: Finding) => {
    if (f.targetIds.length === 0) return;
    selectOnly(f.targetIds);
    void fitView({
      nodes: f.targetIds.map((id) => ({ id })),
      duration: 300,
      padding: 0.6,
      maxZoom: 1.2,
    });
  };

  return (
    <section aria-label="Advisor" className="space-y-3" data-testid="advisor-panel">
      <div>
        <p className={SECTION_TITLE}>Advisor</p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          Structural problems in the design, updated as you edit. Click one to find it on the
          canvas.
        </p>
      </div>

      {findings.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <p className="text-[11px] leading-snug text-emerald-200">
            {hasNodes
              ? "No structural issues: every component is reachable and no stateful tier is a single point of failure."
              : "Add components to the canvas to get advice."}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5" data-testid="advisor-findings">
          {findings.map((f) => {
            const meta = SEVERITY_META[f.severity];
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => focus(f)}
                  data-finding={f.id}
                  aria-label={`${meta.label}: ${f.title}. ${f.detail}`}
                  className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors hover:brightness-125 ${meta.border}`}
                >
                  <span className="flex items-start gap-2">
                    <meta.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.text}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium leading-snug text-zinc-100">
                        {f.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                        {f.detail}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
