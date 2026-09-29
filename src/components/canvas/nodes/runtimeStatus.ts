import { CircleCheck, CircleX, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RuntimeNodeStatus } from "@/engine/types";

/** Node status is shown by color AND icon + label (a11y NFR, Spec 07). */
export const RUNTIME_STATUS_META: Record<
  RuntimeNodeStatus,
  { label: string; Icon: LucideIcon; text: string; bar: string; dot: string; stroke: string }
> = {
  ok: {
    label: "OK",
    Icon: CircleCheck,
    text: "text-emerald-400",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    stroke: "#34d399",
  },
  warn: {
    label: "Warning",
    Icon: TriangleAlert,
    text: "text-amber-400",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    stroke: "#fbbf24",
  },
  critical: {
    label: "Critical",
    Icon: OctagonAlert,
    text: "text-rose-400",
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    stroke: "#fb7185",
  },
  down: {
    label: "Down",
    Icon: CircleX,
    text: "text-red-400",
    bar: "bg-red-600",
    dot: "bg-red-600",
    stroke: "#f87171",
  },
};

/** Utilization bar color: green < 50%, amber < 80%, rose above. */
export function utilizationBarClass(u: number): string {
  return u > 0.8 ? "bg-rose-500" : u > 0.5 ? "bg-amber-500" : "bg-emerald-500";
}
