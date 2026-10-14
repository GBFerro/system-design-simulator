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
 * million requests per month. The price is `pricingOf` the node's technology
 * and class (component-technologies): a provisioned one is the class's
 * hourly price per instance (TEC-17); a managed one bills a fixed part per
 * resource, never times instances (TEC-51), plus reads and writes apart
 * (TEC-18):
 *
 *   (λ_r × readUnitsPerRead × perMillionReads + λ_w × perMillionWrites) × 2.592
 *
 * with λ_w the node's offered writes (the snapshot's `writeRps`), else
 * λ × (1 − the read ratio the engine resolved).
 */
import type { Node } from "@xyflow/react";
import { pricingOf } from "@/domain/components/pricing";
import { instancesOf, numParam, PARAM, resolvedParams } from "@/domain/components/registry";
import { technologyOf } from "@/domain/components/params";
import type { PricingSpec } from "@/domain/components/types";
import { isComponentNode } from "@/lib/nodeFactory";
import type { ComponentNodeData } from "@/store/canvasStore";

export const HOURS_PER_MONTH = 730;
/** Million requests per month for each req/s (30 days × 86,400 s ÷ 10⁶). */
export const MILLION_REQUESTS_PER_RPS_MONTH = 2.592;
/**
 * Read ratio when the caller has neither a node's writes nor the run's
 * resolved ratio: the engine's default (`DEFAULT_READ_RATIO`,
 * engine/core/routing.ts), not imported so the engine stays out of the
 * initial bundle.
 */
const FALLBACK_READ_RATIO = 0.9;

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
  /** Writes per second billed apart, when the price splits reads and writes (TEC-18). */
  billedWriteRps?: number;
  /** The node's technology, when it has one (TEC-19). */
  technology?: { id: string; label: string };
  /** Its instance class, for a technology billed per instance (TEC-19). */
  instanceClass?: string;
}

export interface CostEstimate {
  monthly: number;
  /** Most expensive first. */
  lines: CostLine[];
  byArea: Record<CostArea, number>;
}

const finiteRps = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Cost of one component node handling `rps` req/s, `writeRps` of them writes
 * (the snapshot's; without it, `readRatio` splits the load). Only a price
 * that splits reads and writes reads them.
 */
export function costLine(
  node: Node<ComponentNodeData>,
  rps: number,
  writeRps?: number,
  readRatio = FALLBACK_READ_RATIO,
): CostLine {
  const { data } = node;
  const params = resolvedParams(data);
  const pricing = pricingOf(data.componentId, params);
  const tech = technologyOf(data.componentId, params);
  const instances = instancesOf(data);
  // A resolver is billed only for the lookups no cache answered (Spec 09, DNS).
  const lookupShare = Math.min(1, Math.max(0, numParam(data, PARAM.lookupShare, 1)));
  const billedRps = finiteRps(rps) * lookupShare;
  // A managed service is not a fleet: its price never multiplies by instances (TEC-51).
  const instanceMonthly = pricing.managed
    ? 0
    : instances * pricing.perInstanceHour * HOURS_PER_MONTH;
  const baseMonthly = pricing.baseMonthly;
  const byClass = pricing.perMillionReads !== undefined || pricing.perMillionWrites !== undefined;
  let requestMonthly: number;
  let billedWriteRps: number | undefined;
  if (byClass) {
    const ratio = Number.isFinite(readRatio)
      ? Math.min(1, Math.max(0, readRatio))
      : FALLBACK_READ_RATIO;
    const writes = writeRps !== undefined ? finiteRps(writeRps) : billedRps * (1 - ratio);
    billedWriteRps = Math.min(billedRps, writes);
    requestMonthly =
      ((billedRps - billedWriteRps) *
        (pricing.readUnitsPerRead ?? 1) *
        (pricing.perMillionReads ?? 0) +
        billedWriteRps * (pricing.perMillionWrites ?? 0)) *
      MILLION_REQUESTS_PER_RPS_MONTH;
  } else {
    requestMonthly = billedRps * MILLION_REQUESTS_PER_RPS_MONTH * pricing.perMillionRequests;
  }
  const instanceClass =
    tech?.billing === "instance" && typeof params[PARAM.instanceClass] === "string"
      ? (params[PARAM.instanceClass] as string)
      : undefined;
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
    ...(billedWriteRps !== undefined ? { billedWriteRps } : {}),
    ...(tech ? { technology: { id: tech.id, label: tech.label } } : {}),
    ...(instanceClass ? { instanceClass } : {}),
  };
}

/**
 * Cost of every component node on the canvas (text nodes are skipped).
 * Unreachable nodes cost money too: deployed is deployed. `writeRpsOf` and
 * `readRatio` split the load of nodes priced by read and write (`costLine`).
 */
export function estimateCost(
  nodes: readonly Node[],
  rpsOf: (nodeId: string) => number,
  writeRpsOf?: (nodeId: string) => number | undefined,
  readRatio?: number,
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
    if (!isComponentNode(n)) continue;
    const line = costLine(n, rpsOf(n.id), writeRpsOf?.(n.id), readRatio);
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
