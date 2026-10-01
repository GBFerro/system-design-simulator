/**
 * Monthly cost of a design (Spec 10, CST-01/02). Pure: the caller supplies
 * the load each node handles (the latest snapshot's `rpsIn`, or `analyze()`'s
 * `offeredRps` when scoring).
 *
 *   cost/month = Σ nodes ( instances × perInstanceHour × 730
 *                          + baseMonthly
 *                          + λ × 2.592 × perMillionRequests )
 *
 * 730 h per month; λ req/s × 2,592,000 s per month (30 days) ÷ 10⁶ = λ × 2.592
 * million requests per month.
 */
import type { Node } from "@xyflow/react";
import { getSchema, instancesOf, numParam, PARAM } from "@/domain/components/registry";
import type { PricingSpec } from "@/domain/components/types";
import type { ComponentNodeData } from "@/store/canvasStore";

export const HOURS_PER_MONTH = 730;
/** Million requests per month for each req/s (30 days × 86,400 s ÷ 10⁶). */
export const MILLION_REQUESTS_PER_RPS_MONTH = 2.592;

export type CostArea = "compute" | "data" | "network" | "messaging" | "infrastructure";

export const COST_AREAS: readonly { id: CostArea; label: string }[] = [
  { id: "compute", label: "Compute" },
  { id: "data", label: "Data" },
  { id: "network", label: "Network" },
  { id: "messaging", label: "Messaging" },
  { id: "infrastructure", label: "Infrastructure" },
];

/** Catalog category → breakdown area. */
const AREA_OF_CATEGORY: Record<string, CostArea> = {
  compute: "compute",
  storage: "data",
  networking: "network",
  messaging: "messaging",
  infrastructure: "infrastructure",
};

export interface CostLine {
  nodeId: string;
  label: string;
  componentId: string;
  area: CostArea;
  instances: number;
  /** Requests per second this node is billed for. */
  billedRps: number;
  instanceMonthly: number;
  baseMonthly: number;
  requestMonthly: number;
  monthly: number;
  pricing: PricingSpec;
}

export interface CostEstimate {
  monthly: number;
  /** Most expensive first. */
  lines: CostLine[];
  byArea: Record<CostArea, number>;
}

const finiteRps = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Cost of one component node handling `rps` req/s. */
export function costLine(node: Node<ComponentNodeData>, rps: number): CostLine {
  const { data } = node;
  const pricing = getSchema(data.componentId).pricing;
  const instances = instancesOf(data);
  // A resolver is billed only for the lookups no cache answered (Spec 09, DNS).
  const lookupShare = Math.min(1, Math.max(0, numParam(data, PARAM.lookupShare, 1)));
  const billedRps = finiteRps(rps) * lookupShare;
  const instanceMonthly = instances * pricing.perInstanceHour * HOURS_PER_MONTH;
  const baseMonthly = pricing.baseMonthly;
  const requestMonthly = billedRps * MILLION_REQUESTS_PER_RPS_MONTH * pricing.perMillionRequests;
  return {
    nodeId: node.id,
    label: data.label,
    componentId: data.componentId,
    area: AREA_OF_CATEGORY[data.category] ?? "compute",
    instances,
    billedRps,
    instanceMonthly,
    baseMonthly,
    requestMonthly,
    monthly: instanceMonthly + baseMonthly + requestMonthly,
    pricing,
  };
}

const isComponent = (n: Node): n is Node<ComponentNodeData> =>
  n.type !== "text" && typeof (n.data as Partial<ComponentNodeData>)?.componentId === "string";

/**
 * Cost of every component node on the canvas (text nodes are skipped).
 * Unreachable nodes cost money too: deployed is deployed.
 */
export function estimateCost(
  nodes: readonly Node[],
  rpsOf: (nodeId: string) => number,
): CostEstimate {
  const byArea: Record<CostArea, number> = {
    compute: 0,
    data: 0,
    network: 0,
    messaging: 0,
    infrastructure: 0,
  };
  const lines: CostLine[] = [];
  for (const n of nodes) {
    if (!isComponent(n)) continue;
    const line = costLine(n, rpsOf(n.id));
    lines.push(line);
    byArea[line.area] += line.monthly;
  }
  lines.sort((a, b) => b.monthly - a.monthly);
  return { monthly: lines.reduce((sum, l) => sum + l.monthly, 0), lines, byArea };
}

/** $ per million user requests at `entryRps`; null without traffic. */
export function costPerMillionRequests(monthly: number, entryRps: number): number | null {
  const millions = finiteRps(entryRps) * MILLION_REQUESTS_PER_RPS_MONTH;
  return millions > 0 ? monthly / millions : null;
}
