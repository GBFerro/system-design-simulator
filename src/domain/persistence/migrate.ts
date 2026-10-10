import { getComponentById } from "@/data/components";
import { PARAM, sanitizeParams } from "@/domain/components/registry";
import {
  defaultEdgeRule,
  edgeRuleV2Of,
  migrateEdgeRuleV2toV3,
  sanitizeEdgeRule,
} from "@/domain/graph/edgeRules";
import { isReturnEdge, makeReturnEdge } from "@/domain/graph/returns";

/**
 * Persistence migrations (Spec 05, PER-01).
 *
 * v1 component nodes carried `maxQPS` / `latencyMs` / `replicas` (plus the
 * runtime `utilization` / `status` / `isBottleneck`) directly in `node.data`,
 * and edges had no call rule. v2 moves the numbers into schema-validated
 * `params` and gives every edge an `EdgeRule` in `edge.data.rule`.
 *
 * v3 (request-flow) turns each edge rule into the link plus a list of calls
 * (`migrateGraphV2toV3`): one call with the same condition, `on_miss` kept
 * (read-through); no edge is created, removed or moved.
 *
 * v4 (guided-ui) gives every synchronous call its response, an edge of its own
 * (`migrateGraphV3toV4`); an async call is a request without one. `migrateGraph`
 * runs the whole chain v1 → v2 → v3 → v4 and is what every entry path uses.
 *
 * `migrateV1toV2` is pure, idempotent (`migrate(migrate(x))` deep-equals
 * `migrate(x)`) and never throws. It works on both shapes that hold a graph:
 * live ReactFlow nodes/edges (canvas store, tabs) and the serialized ones
 * (saved designs, JSON export) — every field it doesn't own is preserved.
 * The persisted stores, the JSON import and (Phase 6) the share link reuse it.
 */

export { SCHEMA_VERSION } from "./version";

/** v1 top-level field → v2 param key. */
const LEGACY_PARAM_FIELDS: Record<string, string> = {
  maxQPS: PARAM.capacityPerInstance,
  latencyMs: PARAM.serviceTimeMs,
  replicas: PARAM.instances,
};

/** Simulation output that v1 wrote into node.data (lives in the runtime store in v2). */
const RUNTIME_FIELDS = ["utilization", "status", "isBottleneck"] as const;

export interface MigrateOptions {
  /**
   * Schema version the data was saved with. From 4 on a request without a
   * response is deliberately async, so the v3 → v4 step is skipped (it would
   * answer it). Unknown (undefined): the step still guards itself.
   */
  fromVersion?: number;
  /** Is this component id known (catalog or custom component)? Defaults to `getComponentById`. */
  isKnownComponent?: (componentId: string) => boolean;
  /** Called once per recoverable problem (unknown type, dropped edge, …). */
  onWarning?: (message: string) => void;
}

/** A node as stored anywhere: only `id`, `type`, `position` and `data` are interpreted. */
export interface MigratedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MigratedEdge {
  id: string;
  source: string;
  target: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MigratedGraph {
  nodes: MigratedNode[];
  edges: MigratedEdge[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function defaultIsKnown(componentId: string): boolean {
  return getComponentById(componentId) !== undefined;
}

function migrateComponentData(
  nodeId: string,
  raw: unknown,
  isKnown: (id: string) => boolean,
  warn: (message: string) => void,
): Record<string, unknown> {
  const data = isRecord(raw) ? raw : {};
  const rest: Record<string, unknown> = { ...data };
  for (const field of RUNTIME_FIELDS) delete rest[field];

  let componentId = typeof data.componentId === "string" ? data.componentId : "";
  if (!componentId || !isKnown(componentId)) {
    warn(`Node "${nodeId}": unknown component type "${componentId || "(none)"}", kept as "custom"`);
    componentId = "custom";
  }

  // v1 numbers seed the params; explicit v2 params win over them.
  const seeded: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(LEGACY_PARAM_FIELDS)) {
    if (field in rest) {
      seeded[key] = rest[field];
      delete rest[field];
    }
  }
  const params = sanitizeParams(componentId, {
    ...seeded,
    ...(isRecord(data.params) ? data.params : {}),
  });

  const catalog = getComponentById(componentId);
  return {
    ...rest,
    componentId,
    label: typeof data.label === "string" ? data.label : (catalog?.label ?? "Component"),
    icon: typeof data.icon === "string" ? data.icon : (catalog?.icon ?? "Box"),
    category: typeof data.category === "string" ? data.category : (catalog?.category ?? "compute"),
    scalable: typeof data.scalable === "boolean" ? data.scalable : (catalog?.scalable ?? true),
    params,
  };
}

function migrateNodes(
  rawNodes: unknown,
  isKnown: (id: string) => boolean,
  warn: (message: string) => void,
): MigratedNode[] {
  if (!Array.isArray(rawNodes)) return [];
  const seen = new Set<string>();
  const nodes: MigratedNode[] = [];
  rawNodes.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) {
      warn(`Dropped node ${i}: missing id`);
      return;
    }
    if (seen.has(raw.id)) {
      warn(`Dropped duplicate node "${raw.id}"`);
      return;
    }
    seen.add(raw.id);

    const pos = raw.position;
    const position =
      isRecord(pos) && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)
        ? (pos as { x: number; y: number })
        : { x: 0, y: 0 };
    if (position !== pos) warn(`Node "${raw.id}": invalid position reset to (0, 0)`);

    if (raw.type === "text") {
      // Text nodes are untouched (only a missing data object is repaired).
      const untouched = isRecord(raw.data) && position === pos;
      nodes.push(
        untouched
          ? (raw as MigratedNode)
          : {
              ...raw,
              id: raw.id,
              type: "text",
              position,
              data: isRecord(raw.data) ? raw.data : { text: "" },
            },
      );
      return;
    }

    nodes.push({
      ...raw,
      id: raw.id,
      type: "component",
      position,
      data: migrateComponentData(raw.id, raw.data, isKnown, warn),
    });
  });
  return nodes;
}

function migrateEdges(
  rawEdges: unknown,
  nodes: MigratedNode[],
  warn: (message: string) => void,
): MigratedEdge[] {
  if (!Array.isArray(rawEdges)) return [];
  const componentOf = new Map<string, string | undefined>(
    nodes.map((n) => [
      n.id,
      typeof n.data.componentId === "string" && n.type !== "text" ? n.data.componentId : undefined,
    ]),
  );
  const seen = new Set<string>();
  const edges: MigratedEdge[] = [];
  rawEdges.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.source !== "string" || typeof raw.target !== "string") {
      warn(`Dropped edge ${i}: missing source or target`);
      return;
    }
    const { source, target } = raw;
    if (!componentOf.has(source) || !componentOf.has(target)) {
      warn(`Dropped edge ${i} (${source} → ${target}): points to a missing node`);
      return;
    }
    const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `e-${source}-${target}`;
    if (seen.has(id)) {
      warn(`Dropped duplicate edge "${id}"`);
      return;
    }
    seen.add(id);

    // label / protocol / async (and anything else) are preserved as-is.
    const data = isRecord(raw.data) ? raw.data : {};
    // A response (v4) carries no rule of its own: it only answers its request.
    if (isReturnEdge(raw)) {
      edges.push({ ...raw, id, source, target, data });
      return;
    }
    // Schema v2 stores the flat rule (one condition per edge). A rule already
    // in the v3 call-list shape is left to the v2 → v3 step (never flattened:
    // no call is lost, and its warnings are reported once).
    const rule =
      isRecord(data.rule) && "calls" in data.rule
        ? data.rule
        : edgeRuleV2Of(
            sanitizeEdgeRule(
              data.rule,
              defaultEdgeRule(componentOf.get(source), componentOf.get(target), data.protocol),
            ),
          );
    edges.push({ ...raw, id, source, target, data: { ...data, rule } });
  });
  return edges;
}

/** Migrate a node/edge list pair. Never throws; bad entries are dropped with a warning. */
export function migrateGraphV1toV2(
  nodes: unknown,
  edges: unknown,
  options: MigrateOptions = {},
): MigratedGraph {
  const warn = options.onWarning ?? (() => {});
  const isKnown = options.isKnownComponent ?? defaultIsKnown;
  try {
    const migratedNodes = migrateNodes(nodes, isKnown, warn);
    return { nodes: migratedNodes, edges: migrateEdges(edges, migratedNodes, warn) };
  } catch (err) {
    // Defensive: nothing above should throw, but a migration must never
    // take the app down. Keep what we were given.
    warn(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      nodes: (Array.isArray(nodes) ? nodes : []) as MigratedNode[],
      edges: (Array.isArray(edges) ? edges : []) as MigratedEdge[],
    };
  }
}

/**
 * v2 → v3: every edge rule becomes `{ calls, networkLatencyMs, packetLoss }`
 * (`migrateEdgeRuleV2toV3`), normalized against the edge's connect default;
 * what the normalization fixes in a v3 list (too many calls, a step out of
 * range, an unknown condition) is reported per edge. Nodes, edge ids and
 * endpoints are untouched. Pure, idempotent, never throws.
 */
export function migrateGraphV2toV3(
  graph: MigratedGraph,
  options: MigrateOptions = {},
): MigratedGraph {
  const warn = options.onWarning ?? (() => {});
  try {
    const componentOf = new Map<string, string>();
    for (const n of graph.nodes) {
      if (typeof n.data?.componentId === "string") componentOf.set(n.id, n.data.componentId);
    }
    const edges = graph.edges.map((e) => {
      if (isReturnEdge(e)) return e;
      const data = isRecord(e.data) ? e.data : {};
      const rule = sanitizeEdgeRule(
        migrateEdgeRuleV2toV3(data.rule),
        defaultEdgeRule(componentOf.get(e.source), componentOf.get(e.target), data.protocol),
        (m) => warn(`Edge "${e.id}": ${m}`),
      );
      return { ...e, data: { ...data, rule } };
    });
    return { nodes: graph.nodes, edges };
  } catch (err) {
    warn(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    return graph;
  }
}

/**
 * v3 → v4: every edge between component nodes that is not async gets its
 * response (`ret:<id>`, see `domain/graph/returns.ts`) and loses the `async`
 * flag: from here on a call is async because nothing answers it. Nothing else
 * changes: text nodes, strokes and the edges touching text nodes are left as
 * they are. Pure and never throws. v3 had no responses, so a graph that holds
 * one is already v4 and comes back untouched (this is what makes a second pass
 * a no-op); `migrateGraph` skips the step by `fromVersion` too, because a v4
 * design whose calls are all async has no response to tell it apart.
 */
export function migrateGraphV3toV4(
  graph: MigratedGraph,
  options: MigrateOptions = {},
): MigratedGraph {
  const warn = options.onWarning ?? (() => {});
  try {
    if (graph.edges.some((e) => isReturnEdge(e))) return graph;
    const component = new Set(graph.nodes.filter((n) => n.type !== "text").map((n) => n.id));
    const answered = new Set(graph.edges.map((e) => e.id));
    const added: MigratedEdge[] = [];
    const edges = graph.edges.map((e) => {
      if (!component.has(e.source) || !component.has(e.target)) return e;
      const { async: flag, ...data } = isRecord(e.data) ? e.data : ({} as Record<string, unknown>);
      if (flag !== true) {
        const response = makeReturnEdge(e) as unknown as MigratedEdge;
        if (!answered.has(response.id)) {
          answered.add(response.id);
          added.push(response);
        }
      }
      return { ...e, data };
    });
    return { nodes: graph.nodes, edges: [...edges, ...added] };
  } catch (err) {
    warn(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    return graph;
  }
}

/** The whole chain, v1 → v2 → v3 → v4, on a node/edge list pair. Never throws. */
export function migrateGraph(
  nodes: unknown,
  edges: unknown,
  options: MigrateOptions = {},
): MigratedGraph {
  const v3 = migrateGraphV2toV3(migrateGraphV1toV2(nodes, edges, options), options);
  return options.fromVersion !== undefined && options.fromVersion >= 4
    ? v3
    : migrateGraphV3toV4(v3, options);
}

/**
 * Migrate anything that carries `nodes` + `edges` (a design, a tab, an
 * export envelope). Every other field — name, strokes, text nodes, … — is
 * kept verbatim.
 */
export function migrateV1toV2<T extends object>(
  design: T,
  options: MigrateOptions = {},
): Omit<T, "nodes" | "edges"> & MigratedGraph {
  const source = (isRecord(design) ? design : {}) as Record<string, unknown>;
  return {
    ...(source as Omit<T, "nodes" | "edges">),
    ...migrateGraphV1toV2(source.nodes, source.edges, options),
  };
}
