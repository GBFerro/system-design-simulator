/**
 * Advisor findings (Spec 12). Phase 3 ships the structure hints (ADV-03);
 * findings from scoring/metrics and quick fixes with preview (ADV-01/02)
 * come in Phase 5 and extend this shape (`fix?: QuickFix`).
 */

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  /** Stable per rule + target, to deduplicate. */
  id: string;
  severity: Severity;
  title: string;
  /** Why it matters. */
  detail: string;
  /** Nodes/edges to highlight and focus. */
  targetIds: string[];
  source: "structure" | "scoring" | "metrics" | "chaos";
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
