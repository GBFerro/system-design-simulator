/**
 * Design-pattern findings (Spec 12, ADV-01): read-heavy traffic reaching a
 * database with no cache in front, and the request path waiting on slow work
 * that belongs behind a queue. Read from the graph (and the problem's read
 * mix), with the last run's numbers in the explanation when there are any.
 */
import type { Edge } from "@xyflow/react";
import { suggestedInstances } from "@/cost/rightSize";
import {
  capacityPerInstanceOf,
  PARAM,
  routingFor,
  serviceTimeMsOf,
} from "@/domain/components/registry";
import { DATABASES } from "@/domain/components/traits";
import { freePositionNear, nodeRect } from "@/lib/placement";
import { ms, pct, rps } from "@/scoring/steady";
import type { EdgeCall } from "@/domain/components/types";
import { edgeRuleOf, isAsyncEdge, sanitizeEdgeRule } from "@/domain/graph/edgeRules";
import {
  emptyDiff,
  insertBetween,
  isSyncRequest,
  newComponentNode,
  newEdge,
  uniqueId,
  withResponse,
} from "./graph";
import type { AdvisorContext, CanvasGraph, Finding, GraphDiff } from "./types";
import type { DesignView } from "./view";

/** Read share above which a database's reads deserve a cache. */
export const READ_HEAVY_RATIO = 0.7;
/** A synchronous hop at least this slow (service time) on deferrable work. */
export const SLOW_WORK_MS = 50;

/** Work a user request rarely needs the result of: it can be queued and done later. */
const DEFERRABLE = new Set([
  "worker-pool",
  "notification-service",
  "task-scheduler",
  "stream-processor",
  "data-warehouse",
]);

export function patternFindings(view: DesignView, ctx: AdvisorContext): Finding[] {
  return [...readCacheFindings(view, ctx), ...asyncFindings(view, ctx)];
}

/* ---------- reads without a cache ---------- */

function readCacheFindings(view: DesignView, ctx: AdvisorContext): Finding[] {
  if (ctx.readRatio < READ_HEAVY_RATIO) return [];
  const { graph, byId, path } = view;
  const componentOf = (id: string) => byId.get(id)?.data.componentId ?? "";
  const findings: Finding[] = [];

  for (const db of view.comps) {
    if (!DATABASES.has(db.data.componentId) || !path.onPath.has(db.id)) continue;
    const into = graph.edges.filter((e) => e.target === db.id && byId.has(e.source));
    // Already cached: a cache in line, or a caller that also reads a cache (look-aside).
    const cached = into.some(
      (e) =>
        routingFor(componentOf(e.source)) === "cache" ||
        graph.edges.some((c) => c.source === e.source && componentOf(c.target) === "cache"),
    );
    if (cached) continue;
    const readers = into.filter((e) => {
      if (isAsyncEdge(e) || !path.onPath.has(e.source)) return false;
      if (routingFor(componentOf(e.source)) !== "service") return false;
      return edgeRuleOf(graph, e).calls.some((c) => c.kind === "always" || c.kind === "reads");
    });
    if (readers.length === 0) continue;

    const load = ctx.load?.[db.id];
    const reads = load !== undefined && load > 0 ? load * ctx.readRatio : undefined;
    const label = db.data.label;
    findings.push({
      id: `read-cache:${db.id}`,
      severity: "warning",
      title: `Every read reaches ${label}`,
      detail: `${pct(ctx.readRatio)} of requests are reads and nothing caches them${
        reads !== undefined ? ` (≈${rps(reads)} reads/s hit ${label})` : ""
      }. The database is the hardest tier to scale (stateful, one writer); a cache in front answers hot reads in about a millisecond, and a 90% hit rate leaves the database a tenth of them. Writes still go straight to it.`,
      targetIds: [db.id, ...new Set(readers.map((e) => e.source))],
      source: "structure",
      fix: {
        label: `Add a cache for reads in front of ${label}`,
        preview: (g) =>
          readCacheDiff(
            g,
            db.id,
            readers.map((e) => e.id),
            reads,
          ),
      },
    });
  }
  return findings;
}

/**
 * Look-aside cache (FLW-23): each caller reads the cache (`reads`) and calls
 * the database for its writes and for the reads that missed that cache
 * (`after_miss`); nothing goes from the cache to the database. The caller's
 * database edge keeps its id, label and link but moves after the new cache
 * edge, so the plan runs the cache call first (no step warning).
 */
function readCacheDiff(
  graph: CanvasGraph,
  dbId: string,
  readerEdgeIds: readonly string[],
  reads: number | undefined,
): GraphDiff {
  const db = graph.nodes.find((n) => n.id === dbId);
  const readers = graph.edges.filter((e) => readerEdgeIds.includes(e.id));
  const diff = emptyDiff();
  if (!db || readers.length === 0) return diff;

  const caller = graph.nodes.find((n) => n.id === readers[0].source);
  const a = nodeRect(db);
  const b = caller ? nodeRect(caller) : a;
  const near = { x: (a.x + a.width / 2 + b.x + b.width / 2) / 2, y: a.y - a.height };
  const capacity = capacityPerInstanceOf({ componentId: "cache", params: {} });
  const cache = newComponentNode(
    "cache",
    uniqueId(`cache-${dbId}`, graph),
    freePositionNear(near, graph.nodes),
    reads !== undefined ? { [PARAM.instances]: suggestedInstances(reads, capacity) } : {},
  );
  const nodes = [...graph.nodes, cache];
  const taken: string[] = [];
  const edgeId = (base: string) => {
    const id = uniqueId(base, graph, taken);
    taken.push(id);
    return id;
  };

  const added: Edge[] = [];
  for (const e of readers) {
    const rule = edgeRuleOf(graph, e);
    const readCall = rule.calls.find((c) => c.kind === "reads" || c.kind === "always")!;
    added.push(
      ...withResponse(
        newEdge(
          nodes,
          [...graph.edges, ...added],
          edgeId(`e-${e.source}-${cache.id}`),
          e.source,
          cache.id,
          { calls: [{ kind: "reads", callsPerRequest: readCall.callsPerRequest }] },
        ),
        isSyncRequest(graph.edges, e),
      ),
    );
    // Reads now go to the database only after a miss; `always` keeps its writes.
    const afterMiss = (c: EdgeCall): EdgeCall => ({
      kind: "after_miss",
      missOf: cache.id,
      callsPerRequest: c.callsPerRequest,
    });
    const calls = rule.calls.flatMap((c): EdgeCall[] =>
      c.kind === "always"
        ? [{ ...c, kind: "writes" }, afterMiss(c)]
        : c.kind === "reads"
          ? [afterMiss(c)]
          : [c],
    );
    diff.removeEdgeIds.push(e.id);
    added.push({ ...e, data: { ...e.data, rule: sanitizeEdgeRule({ ...rule, calls }, rule) } });
  }
  diff.addNodes.push(cache);
  diff.addEdges.push(...added);
  return diff;
}

/* ---------- slow work on the request path ---------- */

function asyncFindings(view: DesignView, ctx: AdvisorContext): Finding[] {
  const { graph, byId, path } = view;
  const findings: Finding[] = [];
  for (const e of graph.edges) {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target || isAsyncEdge(e) || !path.onPath.has(source.id)) continue;
    if (routingFor(source.data.componentId) === "queue") continue;
    if (!DEFERRABLE.has(target.data.componentId)) continue;
    const serviceMs = serviceTimeMsOf(target.data);
    if (serviceMs < SLOW_WORK_MS) continue;

    const load = ctx.load?.[target.id];
    const capacity = capacityPerInstanceOf({ componentId: "message-queue", params: {} });
    findings.push({
      id: `async:${e.id}`,
      severity: "warning",
      title: `${source.data.label} waits on ${target.data.label}`,
      detail: `${target.data.label} takes ~${ms(serviceMs)} per request and the user waits for all of it: it adds to the latency, and when ${target.data.label} slows down or fails, so does every request through ${source.data.label}. Work the user doesn't need the answer to (notifications, processing, reports) belongs behind a queue: enqueue in a few milliseconds, respond, and let ${target.data.label} drain it at its own pace.`,
      targetIds: [source.id, target.id],
      source: "structure",
      fix: {
        label: `Put a message queue between ${source.data.label} and ${target.data.label}`,
        preview: (g) => {
          const current = g.edges.find((x) => x.id === e.id);
          if (!current) return emptyDiff();
          return insertBetween(g, current, "message-queue", {
            idBase: `message-queue-${target.id}`,
            params:
              load !== undefined && load > 0
                ? { [PARAM.instances]: suggestedInstances(load, capacity) }
                : {},
            // The consumer handles each message once.
            outRule: { kind: "always", callsPerRequest: 1 },
          });
        },
      },
    });
  }
  return findings;
}
