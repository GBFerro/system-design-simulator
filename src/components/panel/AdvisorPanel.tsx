"use client";

import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  CircleCheck,
  Eye,
  EyeOff,
  Info,
  OctagonAlert,
  TriangleAlert,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { Finding, Severity } from "@/advisor/types";
import { GHOST_PREFIX } from "@/components/canvas/previewGraph";
import {
  applyAllFindings,
  applyFinding,
  setAdvisorPreview,
  useAdvisorStore,
} from "@/store/advisorStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { useRuntimeStore } from "@/store/runtimeStore";
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

const FIX_BUTTON =
  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Advisor (Spec 12): structure hints recomputed as you edit (ADV-03),
 * findings from the last run's load and the last score (ADV-01), and quick
 * fixes (ADV-02) previewed as ghosts on the canvas and applied — one or all —
 * as a single undo step. Clicking a finding selects and frames its nodes.
 */
export function AdvisorPanel() {
  const findings = useAdvisorStore((s) => s.findings);
  const preview = useAdvisorStore((s) => s.preview);
  const hasNodes = useCanvasStore((s) => s.nodes.some((n) => n.type !== "text"));
  const hasRun = useRuntimeStore((s) => s.latest !== null);
  const selectOnly = useCanvasStore((s) => s.selectOnly);
  const readOnly = useIsActiveTabReadOnly();
  const { fitView } = useReactFlow();
  const sectionRef = useRef<HTMLElement>(null);

  const design = findings.filter((f) => f.source !== "scoring");
  const score = findings.filter((f) => f.source === "scoring");
  const fixable = design.filter((f) => f.fix);

  // The preview belongs to this tab: leaving it (or Escape) ends it.
  useEffect(() => () => setAdvisorPreview(null), []);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdvisorPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const frame = (ids: string[]) => {
    if (ids.length === 0) return;
    // On mobile the panel is a bottom sheet over the canvas: frame above it.
    const sheet = sectionRef.current?.closest("[data-bottom-sheet]")?.getBoundingClientRect();
    const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
    const covered = sheet && canvas ? Math.max(0, canvas.bottom - sheet.top) : 0;
    void fitView({
      nodes: ids.map((id) => ({ id })),
      duration: 300,
      padding:
        covered > 0 ? { top: "10%", left: "10%", right: "10%", bottom: `${covered + 16}px` } : 0.6,
      maxZoom: 1.2,
    });
  };

  const focus = (f: Finding) => {
    if (f.targetIds.length === 0) return;
    selectOnly(f.targetIds);
    frame(f.targetIds);
  };

  const togglePreview = (f: Finding) => {
    if (preview?.findingId === f.id) return setAdvisorPreview(null);
    setAdvisorPreview(f.id);
    const ghosts = (useAdvisorStore.getState().preview?.diff.addNodes ?? []).map(
      (n) => GHOST_PREFIX + n.id,
    );
    // Ghost nodes mount on the next render: frame them after it.
    requestAnimationFrame(() => frame([...f.targetIds, ...ghosts]));
  };

  return (
    <section
      ref={sectionRef}
      aria-label="Advisor"
      className="space-y-3"
      data-testid="advisor-panel"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className={SECTION_TITLE}>Advisor</p>
          {fixable.length > 0 && (
            <button
              type="button"
              onClick={applyAllFindings}
              disabled={readOnly}
              title={
                readOnly
                  ? "Reference designs are read-only"
                  : "Apply every fix in order of severity, as one undo step"
              }
              data-testid="advisor-apply-all"
              className={`${FIX_BUTTON} bg-violet-500/20 text-violet-200 hover:bg-violet-500/30`}
            >
              Apply all fixes ({fixable.length})
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-zinc-400">
          Problems in the design: its structure as you edit,{" "}
          {hasRun ? "the last run's load" : "the load once you Simulate"} and the last score.
          Preview a fix to see it on the canvas; applying it is one undo step.
        </p>
      </div>

      {preview && (
        <div
          className="flex items-start gap-2 rounded-md border border-violet-500/40 bg-violet-950/30 px-2.5 py-2"
          role="status"
          data-testid="advisor-preview"
        >
          <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-violet-100">
            Previewing: {preview.label}. Dashed violet is new or changed, dashed rose goes away.
          </p>
          <button
            type="button"
            onClick={() => applyFinding(preview.findingId)}
            disabled={readOnly}
            className={`${FIX_BUTTON} bg-violet-500 text-white hover:bg-violet-400`}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setAdvisorPreview(null)}
            className={`${FIX_BUTTON} text-zinc-300 hover:bg-zinc-700`}
          >
            Cancel
          </button>
        </div>
      )}

      {design.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <p className="text-[11px] leading-snug text-emerald-200">
            {!hasNodes
              ? "Add components to the canvas to get advice."
              : hasRun
                ? "No structural issues, and the last run's load looks healthy on every tier."
                : "No structural issues: every component is reachable and no stateful tier is a single point of failure. Simulate to check the load too."}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5" data-testid="advisor-findings">
          {design.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              previewing={preview?.findingId === f.id}
              readOnly={readOnly}
              onFocus={() => focus(f)}
              onPreview={() => togglePreview(f)}
            />
          ))}
        </ul>
      )}

      {score.length > 0 && (
        <details className="group" data-testid="advisor-score">
          <summary className="cursor-pointer select-none text-[11px] text-zinc-400 hover:text-zinc-200">
            From the last score ({score.length})
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {score.map((f) => (
              <li
                key={f.id}
                data-finding={f.id}
                className={`rounded-md border px-2.5 py-2 ${SEVERITY_META.info.border}`}
              >
                <span className="block text-xs font-medium leading-snug text-zinc-100">
                  {f.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                  {f.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function FindingCard({
  finding: f,
  previewing,
  readOnly,
  onFocus,
  onPreview,
}: {
  finding: Finding;
  previewing: boolean;
  readOnly: boolean;
  onFocus: () => void;
  onPreview: () => void;
}) {
  const meta = SEVERITY_META[f.severity];
  return (
    <li
      data-finding={f.id}
      className={`rounded-md border ${previewing ? "border-violet-400/60 bg-violet-950/20" : meta.border}`}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-label={`${meta.label}: ${f.title}. ${f.detail}`}
        className="w-full px-2.5 py-2 text-left transition-colors hover:brightness-125"
      >
        <span className="flex items-start gap-2">
          <meta.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.text}`} aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-medium leading-snug text-zinc-100">{f.title}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">{f.detail}</span>
          </span>
        </span>
      </button>
      {f.fix && (
        <div className="flex items-center gap-1.5 border-t border-zinc-700/50 px-2.5 py-1.5">
          <Wand2 className="h-3 w-3 shrink-0 text-violet-300" aria-hidden />
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-300">
            {f.fix.label}
          </span>
          <button
            type="button"
            onClick={onPreview}
            aria-pressed={previewing}
            aria-label={`${previewing ? "Hide preview" : "Preview"}: ${f.fix.label}`}
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
            onClick={() => applyFinding(f.id)}
            disabled={readOnly}
            title={readOnly ? "Reference designs are read-only" : undefined}
            aria-label={`Apply: ${f.fix.label}`}
            className={`${FIX_BUTTON} bg-violet-500/20 text-violet-200 hover:bg-violet-500/30`}
          >
            Apply
          </button>
        </div>
      )}
    </li>
  );
}
