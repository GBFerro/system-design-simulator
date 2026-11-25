/**
 * Isometric models (specs/2026-11-24-redesign-papel-quente.md, slice 2): which of the 15
 * archetypes and 7 tints a component draws with, its headline metric, and the pure geometry
 * of the mockup (`pt` around the origin (80, 104) of a 160x160 viewBox). No React here.
 */
import { abbrev, fmtMs, fmtPct } from "@/lib/runtimeMetrics";

export type IsoArchetype =
  | "client"
  | "dns"
  | "cdn"
  | "lb"
  | "gateway"
  | "api"
  | "worker"
  | "cache"
  | "db"
  | "replica"
  | "bucket"
  | "search"
  | "queue"
  | "monitor"
  | "control";

export type IsoTint = "client" | "network" | "compute" | "cache" | "data" | "messaging" | "infra";

export type IsoHeadline = "p99" | "utilization" | "rpsIn";

const ARCHETYPE_IDS: Record<IsoArchetype, readonly string[]> = {
  client: ["client"],
  dns: ["dns"],
  cdn: ["cdn", "origin-shield"],
  lb: ["load-balancer", "reverse-proxy"],
  gateway: ["api-gateway", "waf", "rate-limiter"],
  api: ["app-server", "auth-service", "websocket-server", "notification-service", "custom"],
  worker: ["worker-pool", "task-scheduler", "stream-processor"],
  cache: ["cache"],
  db: ["sql-db", "nosql-db", "graph-db", "timeseries-db", "data-warehouse"],
  replica: ["read-replica"],
  bucket: ["object-storage", "file-store"],
  search: ["search", "vector-db", "geospatial-index"],
  queue: ["message-queue", "dlq", "pub-sub"],
  monitor: ["monitoring"],
  control: [
    "service-mesh",
    "autoscaler",
    "service-discovery",
    "distributed-lock",
    "circuit-breaker",
    "coordination-service",
    "id-generator",
    "sharded-counter",
    "config-service",
  ],
};

const ARCHETYPE_TINT: Record<IsoArchetype, IsoTint> = {
  client: "client",
  dns: "network",
  cdn: "network",
  lb: "network",
  gateway: "network",
  api: "compute",
  worker: "compute",
  cache: "cache",
  db: "data",
  replica: "data",
  bucket: "data",
  search: "data",
  queue: "messaging",
  monitor: "infra",
  control: "infra",
};

const HEADLINE: Record<IsoArchetype, IsoHeadline> = {
  api: "p99",
  worker: "p99",
  gateway: "p99",
  cache: "utilization",
  db: "utilization",
  replica: "utilization",
  search: "utilization",
  queue: "utilization",
  client: "rpsIn",
  dns: "rpsIn",
  cdn: "rpsIn",
  lb: "rpsIn",
  bucket: "rpsIn",
  monitor: "rpsIn",
  control: "rpsIn",
};

const BY_ID = new Map<string, IsoArchetype>(
  (Object.keys(ARCHETYPE_IDS) as IsoArchetype[]).flatMap((a) =>
    ARCHETYPE_IDS[a].map((id): [string, IsoArchetype] => [id, a]),
  ),
);

/** Fallback tint of an id the table does not know, by component category. */
const CATEGORY_TINT: Record<string, IsoTint> = {
  networking: "network",
  compute: "compute",
  storage: "data",
  messaging: "messaging",
  infrastructure: "infra",
};

/** The archetype of a catalog id; a custom component or any unknown id is an `api`. */
export function isoArchetypeOf(componentId: string): IsoArchetype {
  return BY_ID.get(componentId) ?? "api";
}

/**
 * The tint of a component. A catalog id takes its archetype's tint; any other id falls back to
 * its category's tint, and to `compute` (the tint of `api`) when the category is unknown too.
 */
export function isoTintOf(componentId: string, category?: string): IsoTint {
  const a = BY_ID.get(componentId);
  if (a) return ARCHETYPE_TINT[a];
  return (category !== undefined ? CATEGORY_TINT[category] : undefined) ?? "compute";
}

/** The one runtime figure a model shows in its headline row. */
export function headlineMetricOf(archetype: IsoArchetype): IsoHeadline {
  return HEADLINE[archetype];
}

/**
 * The tint table: each family's pastel as a CSS value. The one owner of what used to be two
 * category color tables (the node's and the palette's): the node's faces (`--iso-<tint>-*`, derived
 * from the same pastels) and the palette's icon chips read the tint of `isoTintOf`.
 */
export const ISO_TINT_VAR: Record<IsoTint, string> = {
  client: "var(--sf-cat-client)",
  network: "var(--sf-cat-network)",
  compute: "var(--sf-cat-compute)",
  cache: "var(--sf-cat-cache)",
  data: "var(--sf-cat-data)",
  messaging: "var(--sf-cat-messaging)",
  infra: "var(--sf-cat-infra)",
};

/** The figures a headline row can show (the fields of `NodeRuntimeMetrics` it reads). */
export type HeadlineSource = { rpsIn: number; p99: number; utilization: number };

/** The headline text of a node: its field, formatted with the runtime metrics' formatters. */
export function formatHeadline(field: IsoHeadline, m: HeadlineSource): string {
  switch (field) {
    case "p99":
      return `p99 ${fmtMs(m.p99)}`;
    case "utilization":
      return `util ${fmtPct(Math.max(0, m.utilization), 0)}`;
    case "rpsIn":
      return `${abbrev(m.rpsIn)}/s`;
  }
}

/* ---------- geometry ---------- */

export type Point = readonly [number, number];

/** The model origin in the 160x160 viewBox. */
export const ISO_ORIGIN: Point = [80, 104];

/** Projects (u, v, z) around `o`: x grows with u - v, y with u + v, z lifts. */
export function pt(o: Point, u: number, v: number, z: number): [number, number] {
  return [o[0] + 0.866 * (u - v), o[1] + 0.5 * (u + v) - z];
}

/** SVG `points` string of a polygon, one decimal. */
export function quad(points: readonly Point[]): string {
  return points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}

/** The three visible faces of a box centred on `o` (half-sizes a, b; height h; base z). */
export function boxFaces(
  o: Point,
  a: number,
  b: number,
  h: number,
  z: number,
): { top: string; left: string; right: string } {
  const L = pt(o, -a, b, z);
  const F = pt(o, a, b, z);
  const R = pt(o, a, -b, z);
  const B = pt(o, -a, -b, z);
  const up = (p: Point): Point => [p[0], p[1] - h];
  return {
    top: quad([up(L), up(F), up(R), up(B)]),
    left: quad([L, F, up(F), up(L)]),
    right: quad([F, R, up(R), up(F)]),
  };
}

/** A quad on the left-facing plane v = b. */
export function lq(o: Point, b: number, u0: number, u1: number, z0: number, z1: number): string {
  return quad([pt(o, u0, b, z0), pt(o, u1, b, z0), pt(o, u1, b, z1), pt(o, u0, b, z1)]);
}

/** A quad on the right-facing plane u = a. */
export function rq(o: Point, a: number, v0: number, v1: number, z0: number, z1: number): string {
  return quad([pt(o, a, v0, z0), pt(o, a, v1, z0), pt(o, a, v1, z1), pt(o, a, v0, z1)]);
}

/** A quad on the horizontal plane at height z. */
export function tq(o: Point, u0: number, u1: number, v0: number, v1: number, z: number): string {
  return quad([pt(o, u0, v0, z), pt(o, u1, v0, z), pt(o, u1, v1, z), pt(o, u0, v1, z)]);
}

/** A ground diamond of half-size a at height z around the model origin. */
export function diamond(a: number, z: number): string {
  const C = ISO_ORIGIN;
  return quad([pt(C, -a, a, z), pt(C, a, a, z), pt(C, a, -a, z), pt(C, -a, -a, z)]);
}
