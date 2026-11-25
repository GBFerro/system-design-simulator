import type { RuntimeNodeStatus } from "@/engine/types";
import { cssVar } from "@/lib/themeColors";

/** Minimap color of a node by its runtime status (no status yet: muted). */
export function minimapNodeColor(status: RuntimeNodeStatus | undefined): string {
  if (status === "critical" || status === "down") return cssVar("err");
  if (status === "warn") return cssVar("slow");
  if (status === "ok") return cssVar("ok");
  return "var(--sf-muted)";
}
