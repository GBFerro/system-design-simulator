import type { RuntimeNodeStatus } from "@/engine/types";
import { cssVar } from "@/lib/themeColors";

/** Minimap color of a node by its runtime status (no status yet: muted). */
export function minimapNodeColor(status: RuntimeNodeStatus | undefined): string {
  if (status === "critical" || status === "down") return cssVar("err");
  if (status === "warn") return cssVar("slow");
  if (status === "ok") return cssVar("ok");
  return "var(--sf-muted)";
}

/** Minimap fill of a node: its status in the latest snapshot's nodes (none yet, or unknown: muted). */
export function minimapFill(
  nodeId: string,
  nodes: Readonly<Record<string, { status: RuntimeNodeStatus } | undefined>> | undefined,
): string {
  return minimapNodeColor(nodes?.[nodeId]?.status);
}
