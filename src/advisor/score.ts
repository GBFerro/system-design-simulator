/**
 * The last score's lost points as findings (Spec 12, ADV-01), with the same
 * explanation the Score tab and the interview report give. Informational:
 * the targeted findings (structure, load) carry the severity and the fixes.
 */
import type { ScoreResult } from "@/types/scoring";
import type { Finding } from "./types";

export function scoreFindings(score: ScoreResult | null | undefined): Finding[] {
  if (!score) return [];
  return score.categories.flatMap((c) =>
    c.feedback.map((text, i): Finding => ({
      id: `score:${c.category}:${i}`,
      severity: "info",
      title: `${c.category} (${c.score}/${c.maxScore})`,
      detail: text,
      targetIds: [],
      source: "scoring",
    })),
  );
}
