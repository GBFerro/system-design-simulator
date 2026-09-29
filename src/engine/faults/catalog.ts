/**
 * Fault catalog (Spec 08, CHS-02 MVP). Each type declares its label, the
 * targets it accepts, the meaning and range of its intensity, and how it
 * compiles into modifiers (relative to the fault's start). Pure: the only
 * inputs are the spec (already sanitized) and the compiled graph.
 */
import { PARAM } from "@/domain/components/params";
import type { SimEdge, SimGraph, SimNode } from "@/domain/graph/compile";
import { hitRateOf, paramNumber } from "../core/routing";
import type { FaultCategory, FaultSpec, FaultTargetKind, FaultType, ModifierKind } from "./types";

export interface IntensitySpec {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  format: "count" | "multiplier" | "ms" | "percent" | "sec";
}

/** A modifier relative to the fault's start (seconds). */
export interface RelativeModifier {
  kind: ModifierKind;
  targetIds: string[];
  onEdges?: boolean;
  value: number;
  /** Seconds after the start; default 0. */
  from?: number;
  /** Seconds after the start; default: until the fault ends. */
  until?: number;
  recover?: { to: number; tauSec: number };
}

export interface BuildContext {
  graph: SimGraph;
  byId: ReadonlyMap<string, SimNode>;
  readRatio: number;
}

export interface Built {
  modifiers: RelativeModifier[];
  notes: string[];
}

export interface FaultTypeSpec {
  type: FaultType;
  label: string;
  category: FaultCategory;
  description: string;
  targets: readonly FaultTargetKind[];
  intensity?: IntensitySpec;
  /** Suggested auto-heal duration (s); undefined = the fault ends by itself. */
  defaultDurationSec?: number;
  /** Nodes this fault can target (UI filter and validation). Default: any. */
  nodeFilter?: (node: SimNode, graph: SimGraph) => boolean;
  /** Edges this fault can target. Default: any forward edge. */
  edgeFilter?: (edge: SimEdge, graph: SimGraph) => boolean;
  /** Why no node qualifies, shown when the filter leaves nothing. */
  targetHint?: string;
  /** `spec.intensity` is already clamped to `intensity`. Returns an error message when it can't apply. */
  build(spec: FaultSpec, target: string | undefined, ctx: BuildContext): Built | string;
}

export const FAULT_CATEGORIES: { id: FaultCategory; label: string }[] = [
  { id: "compute", label: "Compute" },
  { id: "network", label: "Network" },
  { id: "data", label: "Data" },
  { id: "traffic", label: "Traffic" },
];

/** Where a cache-flushed node's hit rate is back to 99% of steady state: 5τ (e^{-5} < 0.7%). */
export const CACHE_WARM_TAUS = 5;

const node = (ctx: BuildContext, id: string | undefined) => (id ? ctx.byId.get(id) : undefined);

/** Seconds an upstream LB keeps routing to a dead target: interval × unhealthy threshold. */
export function lbDetectionSec(lb: SimNode): number {
  const interval = Math.max(0, paramNumber(lb, PARAM.healthCheckIntervalSec, 30));
  const threshold = Math.max(1, Math.floor(paramNumber(lb, PARAM.unhealthyThreshold, 2)));
  return interval * threshold;
}

function upstreamLbs(ctx: BuildContext, id: string): SimNode[] {
  const out: SimNode[] = [];
  for (const e of ctx.graph.edges) {
    if (e.target !== id || e.back) continue;
    const src = ctx.byId.get(e.source);
    if (src?.routing === "lb") out.push(src);
  }
  return out;
}

/**
 * A whole node down: every LB in front that has other targets takes it out
 * of rotation once its health check notices (interval × unhealthy threshold),
 * so the survivors get its share. Until then its share of requests fails.
 */
function nodeDown(ctx: BuildContext, n: SimNode): Built {
  const modifiers: RelativeModifier[] = [{ kind: "nodeDown", targetIds: [n.id], value: 1 }];
  const notes: string[] = [];
  for (const e of ctx.graph.edges) {
    if (e.target !== n.id || e.back) continue;
    const lb = ctx.byId.get(e.source);
    if (lb?.routing !== "lb") continue;
    const others = ctx.graph.edges.some(
      (x) => x.source === lb.id && x.id !== e.id && !x.back && !x.async,
    );
    if (!others) continue;
    const detect = lbDetectionSec(lb);
    modifiers.push({ kind: "drainEdge", targetIds: [e.id], onEdges: true, value: 1, from: detect });
    notes.push(
      `${lb.label} routes around it after its health check fails (${fmtSec(detect)}); until then its share of requests fails.`,
    );
  }
  return { modifiers, notes };
}

function hasQueueUpstream(n: SimNode, graph: SimGraph): boolean {
  return graph.edges.some(
    (e) =>
      e.target === n.id &&
      !e.back &&
      graph.nodes.find((s) => s.id === e.source)?.routing === "queue",
  );
}

const fmtSec = (s: number) => `${Math.round(s * 10) / 10} s`;

export const FAULT_CATALOG: readonly FaultTypeSpec[] = [
  /* ---------- compute ---------- */
  {
    type: "kill-instances",
    label: "Kill instances",
    category: "compute",
    description:
      "Some instances of the node die. Capacity drops by k/n; a load balancer in front keeps sending them traffic (errors) until its health check marks them down.",
    targets: ["node"],
    intensity: {
      label: "Instances killed",
      min: 1,
      max: 100,
      step: 1,
      default: 1,
      format: "count",
    },
    defaultDurationSec: 120,
    build(spec, id, ctx) {
      const n = node(ctx, id)!;
      const k = Math.min(Math.round(spec.intensity ?? 1), n.instances);
      if (k >= n.instances) {
        const down = nodeDown(ctx, n);
        return {
          modifiers: down.modifiers,
          notes: [`All ${n.instances} instance(s) killed: the node is down.`, ...down.notes],
        };
      }
      const share = k / n.instances;
      const modifiers: RelativeModifier[] = [
        { kind: "capacityMultiplier", targetIds: [n.id], value: 1 - share },
      ];
      const lbs = upstreamLbs(ctx, n.id);
      const notes = [`${k} of ${n.instances} instances down: capacity ×${(1 - share).toFixed(2)}.`];
      if (lbs.length > 0) {
        const detect = Math.max(...lbs.map(lbDetectionSec));
        if (detect > 0) {
          modifiers.push({ kind: "errorRate", targetIds: [n.id], value: share, until: detect });
          notes.push(
            `The load balancer keeps routing ${Math.round(share * 100)}% of requests to the dead instances until its health check marks them down (interval × unhealthy threshold = ${fmtSec(detect)}).`,
          );
        }
      } else {
        notes.push("No load balancer in front: the survivors take the traffic right away.");
      }
      return { modifiers, notes };
    },
  },
  {
    type: "kill-node",
    label: "Kill node",
    category: "compute",
    description:
      "Every instance of the node is gone: all requests to it fail. A load balancer with other targets routes around it once its health check notices.",
    targets: ["node"],
    defaultDurationSec: 60,
    build: (_spec, id, ctx) => nodeDown(ctx, node(ctx, id)!),
  },
  {
    type: "slow-node",
    label: "Slow node (grey failure)",
    category: "compute",
    description:
      "The node answers, but slowly: service time ×N with the same concurrency, so capacity ÷N. No errors, so health checks don't catch it.",
    targets: ["node"],
    intensity: {
      label: "Slowdown",
      min: 1.5,
      max: 50,
      step: 0.5,
      default: 5,
      format: "multiplier",
    },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [{ kind: "latencyMultiplier", targetIds: [id!], value: spec.intensity ?? 5 }],
      notes: [],
    }),
  },
  {
    type: "consumer-stopped",
    label: "Consumer stopped",
    category: "compute",
    description:
      "A queue consumer stops pulling (crash loop, poison message, stuck deploy): the queue keeps accepting messages and the lag grows.",
    targets: ["node"],
    nodeFilter: hasQueueUpstream,
    targetHint: "Needs a node that consumes from a queue (queue → worker).",
    defaultDurationSec: 60,
    build: (_spec, id) => ({
      modifiers: [{ kind: "capacityMultiplier", targetIds: [id!], value: 0 }],
      notes: ["Consumption stops; messages pile up as queue lag until it is healed."],
    }),
  },

  /* ---------- network ---------- */
  {
    type: "edge-latency",
    label: "Latency on a link",
    category: "network",
    description:
      "Extra one-way network delay on a connection. Callers with a timeout start timing out once the round trip eats the budget.",
    targets: ["edge"],
    intensity: { label: "Extra latency", min: 10, max: 5000, step: 10, default: 200, format: "ms" },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [
        { kind: "latencyAddMs", targetIds: [id!], onEdges: true, value: spec.intensity ?? 200 },
      ],
      notes: [],
    }),
  },
  {
    type: "packet-loss",
    label: "Packet loss",
    category: "network",
    description:
      "A share of the calls on a connection is lost. Callers with retries try again (more load); without them the request fails.",
    targets: ["edge"],
    intensity: { label: "Loss", min: 0.01, max: 1, step: 0.01, default: 0.1, format: "percent" },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [
        { kind: "errorRate", targetIds: [id!], onEdges: true, value: spec.intensity ?? 0.1 },
      ],
      notes: [],
    }),
  },
  {
    type: "partition",
    label: "Network partition",
    category: "network",
    description:
      "The connection is cut: nothing reaches the target over it and every call fails (or times out).",
    targets: ["edge"],
    defaultDurationSec: 60,
    build: (_spec, id) => ({
      modifiers: [{ kind: "severEdge", targetIds: [id!], onEdges: true, value: 1 }],
      notes: [],
    }),
  },

  /* ---------- data ---------- */
  {
    type: "cache-flush",
    label: "Cache flush (stampede)",
    category: "data",
    description:
      "The cache loses its content: the hit rate drops to 0 and recovers as h(t) = h·(1 − e^(−t/τ)). Meanwhile every miss hits the backend.",
    targets: ["node"],
    nodeFilter: (n) => n.routing === "cache",
    targetHint: "Needs a cache, CDN or origin shield.",
    intensity: { label: "Warm-up τ", min: 1, max: 600, step: 1, default: 30, format: "sec" },
    build(spec, id, ctx) {
      const n = node(ctx, id)!;
      const tau = spec.intensity ?? 30;
      const h = hitRateOf(n);
      return {
        modifiers: [
          {
            kind: "hitRateOverride",
            targetIds: [n.id],
            value: 0,
            until: CACHE_WARM_TAUS * tau,
            recover: { to: h, tauSec: tau },
          },
        ],
        notes: [
          `Hit rate 0 → ${Math.round(h * 100)}% with τ = ${fmtSec(tau)}; back within 1% after ${fmtSec(CACHE_WARM_TAUS * tau)}.`,
        ],
      };
    },
  },
  {
    type: "db-primary-failure",
    label: "DB primary failure",
    category: "data",
    description:
      "The SQL primary dies. Writes fail until a standby is promoted (the node's failover time); reads keep going on the remaining instances. With one instance there is nothing to promote.",
    targets: ["node"],
    nodeFilter: (n) => n.componentId === "sql-db",
    targetHint: "Needs a SQL database.",
    defaultDurationSec: 180,
    build(_spec, id, ctx) {
      const n = node(ctx, id)!;
      if (n.instances <= 1) {
        return {
          modifiers: [{ kind: "nodeDown", targetIds: [n.id], value: 1 }],
          notes: ["Single instance: no standby to promote, so the database is down until healed."],
        };
      }
      const failover = Math.max(1, paramNumber(n, PARAM.failoverSec, 60));
      // Writes on the way in fail until the failover: `writes` edges entirely,
      // `always`/`fraction` edges by the write share, `reads` and `on_miss`
      // (cache misses are reads) not at all.
      const modifiers: RelativeModifier[] = [
        { kind: "capacityMultiplier", targetIds: [n.id], value: (n.instances - 1) / n.instances },
      ];
      for (const e of ctx.graph.edges) {
        if (e.target !== n.id || e.back || !ctx.byId.has(e.source)) continue;
        const writeShare =
          e.rule.kind === "writes"
            ? 1
            : e.rule.kind === "reads" || e.rule.kind === "on_miss"
              ? 0
              : 1 - ctx.readRatio;
        if (writeShare > 0) {
          modifiers.push({
            kind: "errorRate",
            targetIds: [e.id],
            onEdges: true,
            value: writeShare,
            until: failover,
          });
        }
      }
      return {
        modifiers,
        notes: [
          `Writes fail for the failover time (${fmtSec(failover)}); afterwards ${n.instances - 1} of ${n.instances} instances serve.`,
        ],
      };
    },
  },

  /* ---------- traffic ---------- */
  {
    type: "traffic-spike",
    label: "Traffic spike",
    category: "traffic",
    description: "Arrivals ×N: everywhere (global) or from one entry point.",
    targets: ["global", "node"],
    nodeFilter: (n, g) => g.entryIds.includes(n.id),
    targetHint: "Only entry points (nodes that receive the traffic) can be a spike source.",
    intensity: {
      label: "Multiplier",
      min: 1.5,
      max: 50,
      step: 0.5,
      default: 5,
      format: "multiplier",
    },
    defaultDurationSec: 30,
    build: (spec, id) => ({
      modifiers: [
        { kind: "trafficMultiplier", targetIds: id ? [id] : [], value: spec.intensity ?? 5 },
      ],
      notes: [],
    }),
  },
];

const BY_TYPE = new Map(FAULT_CATALOG.map((f) => [f.type, f]));

export function getFaultType(type: string): FaultTypeSpec | undefined {
  return BY_TYPE.get(type as FaultType);
}

/** Valid node targets of a fault type in a graph. */
export function nodeTargets(spec: FaultTypeSpec, graph: SimGraph): SimNode[] {
  if (!spec.targets.includes("node")) return [];
  return graph.nodes.filter((n) => !spec.nodeFilter || spec.nodeFilter(n, graph));
}

/** Valid edge targets (forward edges only: a back edge carries no load). */
export function edgeTargets(spec: FaultTypeSpec, graph: SimGraph): SimEdge[] {
  if (!spec.targets.includes("edge")) return [];
  return graph.edges.filter((e) => !e.back && (!spec.edgeFilter || spec.edgeFilter(e, graph)));
}
