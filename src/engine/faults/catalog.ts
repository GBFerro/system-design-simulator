/**
 * Fault catalog (Spec 08: the CHS-02 MVP and the CHS-03 additions). Each type declares its label, the
 * targets it accepts, the meaning and range of its intensity, and how it
 * compiles into modifiers (relative to the fault's start). Pure: the only
 * inputs are the spec (already sanitized) and the compiled graph.
 */
import { PARAM } from "@/domain/components/params";
import type { SimEdge, SimGraph, SimNode } from "@/domain/graph/compile";
import { hitRateOf, lookupShareOf, paramNumber } from "../core/routing";
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

/**
 * k of a node's instances die. Capacity drops by k/n; an LB in front keeps
 * sending them their share (failing) until its health check notices. All of
 * them is the node down.
 */
function killInstances(ctx: BuildContext, n: SimNode, k: number): Built {
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
}

/** The same modifiers, `seconds` later (a crash at the end of a memory leak). */
function delayed(modifiers: RelativeModifier[], seconds: number): RelativeModifier[] {
  return modifiers.map((m) => ({
    ...m,
    from: (m.from ?? 0) + seconds,
    ...(m.until !== undefined ? { until: m.until + seconds } : {}),
  }));
}

/**
 * Share of the calls on `e` that write to its target: a queue's every
 * publish, a `writes` edge entirely, `always`/`fraction` by the write share,
 * `reads` and `on_miss` (cache misses are reads) none.
 */
function writeShareOf(e: SimEdge, target: SimNode, readRatio: number): number {
  if (target.routing === "queue") return 1;
  if (e.rule.kind === "writes") return 1;
  if (e.rule.kind === "reads" || e.rule.kind === "on_miss") return 0;
  return 1 - readRatio;
}

/** Error modifiers failing `share` of the writes on every edge into `n`. */
function failWrites(
  ctx: BuildContext,
  n: SimNode,
  share: number,
  until?: number,
): RelativeModifier[] {
  const out: RelativeModifier[] = [];
  for (const e of ctx.graph.edges) {
    if (e.target !== n.id || e.back || !ctx.byId.has(e.source)) continue;
    const w = writeShareOf(e, n, ctx.readRatio) * share;
    if (w > 0) {
      out.push({
        kind: "errorRate",
        targetIds: [e.id],
        onEdges: true,
        value: w,
        ...(until !== undefined ? { until } : {}),
      });
    }
  }
  return out;
}

/** Nodes that persist data on disk (databases, search, queues, files). */
const DISK_NODES = new Set([
  "sql-db",
  "nosql-db",
  "read-replica",
  "search",
  "timeseries-db",
  "graph-db",
  "vector-db",
  "data-warehouse",
  "file-store",
  "message-queue",
  "dlq",
]);

/**
 * Managed services spread over every zone by the provider (and the traffic
 * source): a zone outage doesn't take them down. Same set as the scorer's
 * `INHERENTLY_REDUNDANT` (`scoring/paths.ts`).
 */
const MULTI_ZONE_MANAGED = new Set(["client", "dns", "cdn", "object-storage"]);

/** How long the health-check flapping fault keeps toggling without an auto-heal. */
const FLAP_HORIZON_SEC = 900;

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
      return killInstances(ctx, n, Math.min(Math.round(spec.intensity ?? 1), n.instances));
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
  {
    type: "zone-failure",
    label: "Availability zone outage",
    category: "compute",
    description:
      "One of the zones the design runs in goes dark. Instances are spread round-robin over the zones, so every tier loses its share — and a tier with a single instance loses everything. Managed multi-zone services (DNS, CDN, object storage) ride it out.",
    targets: ["global"],
    intensity: { label: "Zones", min: 2, max: 6, step: 1, default: 3, format: "count" },
    defaultDurationSec: 120,
    build(spec, _id, ctx) {
      const zones = Math.round(spec.intensity ?? 3);
      const modifiers: RelativeModifier[] = [];
      const gone: string[] = [];
      for (const n of ctx.graph.nodes) {
        if (MULTI_ZONE_MANAGED.has(n.componentId)) continue;
        // The lost zone held instances 0, z, 2z, … of every tier.
        const lost = Math.ceil(n.instances / zones);
        if (lost >= n.instances) gone.push(n.label);
        modifiers.push(...killInstances(ctx, n, lost).modifiers);
      }
      return {
        modifiers,
        notes: [
          `Instances spread over ${zones} zones: the lost zone held ⌈n/${zones}⌉ of each tier's n instances; load balancers route around them after their health checks.`,
          gone.length > 0
            ? `Down with the zone (no instance elsewhere): ${gone.join(", ")}.`
            : "Every tier keeps instances in the other zones.",
        ],
      };
    },
  },
  {
    type: "memory-leak",
    label: "Memory leak",
    category: "compute",
    description:
      "Every instance leaks memory at the same rate: garbage collection pauses grow (service time ×1.25 → ×3 in four steps) until they all run out of memory and crash together.",
    targets: ["node"],
    nodeFilter: (n) => n.componentId !== "client",
    intensity: {
      label: "Time to out-of-memory",
      min: 20,
      max: 900,
      step: 10,
      default: 60,
      format: "sec",
    },
    defaultDurationSec: 90,
    build(spec, id, ctx) {
      const n = node(ctx, id)!;
      const oom = spec.intensity ?? 60;
      const steps = [1.25, 1.5, 2, 3];
      const modifiers: RelativeModifier[] = steps.map((value, i) => ({
        kind: "latencyMultiplier",
        targetIds: [n.id],
        value,
        from: (oom * i) / steps.length,
        until: (oom * (i + 1)) / steps.length,
      }));
      const crash = nodeDown(ctx, n);
      modifiers.push(...delayed(crash.modifiers, oom));
      return {
        modifiers,
        notes: [
          `GC pauses grow for ${fmtSec(oom)}, then every instance runs out of memory at once and the node is down until it restarts (the heal).`,
          ...crash.notes,
        ],
      };
    },
  },
  {
    type: "thread-pool-exhausted",
    label: "Thread pool exhausted",
    category: "compute",
    description:
      "Most worker threads are stuck waiting on something (a slow call with no timeout): the node still answers health checks, but only the free threads serve, so requests queue up.",
    targets: ["node"],
    nodeFilter: (n) => n.routing === "service" && n.componentId !== "client",
    targetHint: "Needs a service (app server, gateway, worker…).",
    intensity: {
      label: "Threads stuck",
      min: 0.5,
      max: 1,
      step: 0.05,
      default: 0.9,
      format: "percent",
    },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [
        { kind: "capacityMultiplier", targetIds: [id!], value: 1 - (spec.intensity ?? 0.9) },
      ],
      notes: ["Health checks still pass, so load balancers keep sending it its full share."],
    }),
  },
  {
    type: "transient-errors",
    label: "Transient errors (retry storm)",
    category: "compute",
    description:
      "A share of requests fails fast (a flaky dependency, a bad deploy). Callers with retries send them again — R retries can multiply the load by up to R + 1 and turn a blip into a retry storm.",
    targets: ["node"],
    nodeFilter: (n) => n.componentId !== "client",
    intensity: {
      label: "Error rate",
      min: 0.05,
      max: 0.9,
      step: 0.05,
      default: 0.3,
      format: "percent",
    },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [{ kind: "errorRate", targetIds: [id!], value: spec.intensity ?? 0.3 }],
      notes: [
        "A caller with R retries resends a failing share f: λ(1 − f^(R+1))/(1 − f) calls in total.",
      ],
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
  {
    type: "tls-expired",
    label: "TLS certificate expired",
    category: "network",
    description:
      "The node's certificate expired: every TLS handshake to it fails at once. Health checks on a plain port still pass, so nothing routes around it.",
    targets: ["node"],
    nodeFilter: (n, g) => g.edges.some((e) => e.target === n.id && !e.back),
    targetHint: "Needs a node something calls.",
    defaultDurationSec: 60,
    build(_spec, id, ctx) {
      const modifiers: RelativeModifier[] = ctx.graph.edges
        .filter((e) => e.target === id && !e.back && ctx.byId.has(e.source))
        .map((e) => ({ kind: "errorRate", targetIds: [e.id], onEdges: true, value: 1 }));
      return {
        modifiers,
        notes: ["Every call to it fails until the certificate is renewed (the heal)."],
      };
    },
  },
  {
    type: "dns-outage",
    label: "DNS outage",
    category: "network",
    description:
      "The resolver stops answering. Answers already cached (browser, OS, resolvers) keep working until their TTL runs out; every request that needs a fresh lookup fails.",
    targets: ["node"],
    nodeFilter: (n) => n.componentId === "dns",
    targetHint: "Needs a DNS node.",
    defaultDurationSec: 60,
    build(_spec, id, ctx) {
      const n = node(ctx, id)!;
      const share = lookupShareOf(n);
      const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
      return {
        modifiers: [{ kind: "errorRate", targetIds: [n.id], value: 1 }],
        notes: [
          `${pct(share)} of requests need a fresh lookup and fail; the cached ${pct(1 - share)} go through.`,
        ],
      };
    },
  },
  {
    type: "health-check-flapping",
    label: "Health check flapping",
    category: "network",
    description:
      "A load balancer's health check to one target passes and fails in turn (a tight threshold, a slow health endpoint): the target drops in and out of rotation, and the others take its share while it's out.",
    targets: ["edge"],
    edgeFilter: (e, g) =>
      g.nodes.find((n) => n.id === e.source)?.routing === "lb" &&
      g.edges.some((x) => x.source === e.source && x.id !== e.id && !x.back && !x.async),
    targetHint: "Needs a load balancer with two or more targets.",
    intensity: { label: "Flap period", min: 4, max: 120, step: 2, default: 10, format: "sec" },
    defaultDurationSec: 60,
    build(spec, id) {
      const period = spec.intensity ?? 10;
      const horizon = spec.durationSec ?? FLAP_HORIZON_SEC;
      const modifiers: RelativeModifier[] = [];
      for (let t = 0; t < horizon; t += period) {
        modifiers.push({
          kind: "drainEdge",
          targetIds: [id!],
          onEdges: true,
          value: 1,
          from: t + period / 2,
          until: t + period,
        });
      }
      return { modifiers, notes: [`Out of rotation for half of every ${fmtSec(period)}.`] };
    },
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
        ...failWrites(ctx, n, 1, failover),
      ];
      return {
        modifiers,
        notes: [
          `Writes fail for the failover time (${fmtSec(failover)}); afterwards ${n.instances - 1} of ${n.instances} instances serve.`,
        ],
      };
    },
  },

  {
    type: "disk-full",
    label: "Disk full",
    category: "data",
    description:
      "The node's disk fills up (logs, WAL, a missed retention policy): every write fails, reads keep working.",
    targets: ["node"],
    nodeFilter: (n) => DISK_NODES.has(n.componentId),
    targetHint: "Needs a database, search index, queue or file store.",
    defaultDurationSec: 120,
    build(_spec, id, ctx) {
      const modifiers = failWrites(ctx, node(ctx, id)!, 1);
      return {
        modifiers,
        notes: [
          modifiers.length > 0
            ? "Writes fail until space is freed (the heal); reads are served."
            : "Nothing writes to it in this design, so nothing fails.",
        ],
      };
    },
  },
  {
    type: "iops-throttle",
    label: "IOPS throttled",
    category: "data",
    description:
      "The volume hits its provisioned IOPS (or its burst credits run out): the node does a fraction of its usual work, so requests queue and latency climbs.",
    targets: ["node"],
    nodeFilter: (n) => DISK_NODES.has(n.componentId),
    targetHint: "Needs a database, search index, queue or file store.",
    intensity: {
      label: "Throughput left",
      min: 0.05,
      max: 0.9,
      step: 0.05,
      default: 0.25,
      format: "percent",
    },
    defaultDurationSec: 60,
    build: (spec, id) => ({
      modifiers: [{ kind: "capacityMultiplier", targetIds: [id!], value: spec.intensity ?? 0.25 }],
      notes: [],
    }),
  },
  {
    type: "deadlock",
    label: "Deadlocks",
    category: "data",
    description:
      "Transactions lock rows in conflicting orders: the database aborts a share of them (the deadlock victims) and the rest wait longer on locks.",
    targets: ["node"],
    nodeFilter: (n) => n.componentId === "sql-db",
    targetHint: "Needs a SQL database.",
    intensity: {
      label: "Writes aborted",
      min: 0.05,
      max: 1,
      step: 0.05,
      default: 0.3,
      format: "percent",
    },
    defaultDurationSec: 60,
    build(spec, id, ctx) {
      const n = node(ctx, id)!;
      return {
        modifiers: [
          { kind: "latencyMultiplier", targetIds: [n.id], value: 1.5 },
          ...failWrites(ctx, n, spec.intensity ?? 0.3),
        ],
        notes: ["Writes are aborted as deadlock victims; lock waits make every query ×1.5 slower."],
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
