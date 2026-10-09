import type { Edge } from "@xyflow/react";

/**
 * The return of a call (guided-ui, RET-*): a synchronous call is TWO canvas
 * edges, the request (A → B) and its response (B → A). The response is an edge
 * of its own with `data.responseTo = <request id>`, id `ret:<request id>`, and
 * the handles `ret-out` (on B) and `ret-in` (on A). A request without a
 * response is async, so "sync" lives in one place only: the response's
 * existence. The engine never sees responses (`compileGraph` drops them).
 */

/** Source handle of a response (on the callee) and target handle (on the caller). */
export const RETURN_SOURCE_HANDLE = "ret-out";
export const RETURN_TARGET_HANDLE = "ret-in";

const RETURN_ID_PREFIX = "ret:";

type EdgeLike = { id: string; data?: unknown };

/** The request an edge answers, when the edge is a response. */
export function responseToOf(edge: { data?: unknown }): string | undefined {
  const to = (edge.data as { responseTo?: unknown } | undefined)?.responseTo;
  return typeof to === "string" && to !== "" ? to : undefined;
}

export function isReturnEdge(edge: { data?: unknown }): boolean {
  return responseToOf(edge) !== undefined;
}

/** Deterministic id of the response to a request (undo, quick fixes and tests need stable ids). */
export function returnIdOf(requestId: string): string {
  return `${RETURN_ID_PREFIX}${requestId}`;
}

/** The response edge to `request`: reversed ends, dashed return handles, no parameters of its own. */
export function makeReturnEdge(request: Pick<Edge, "id" | "source" | "target">): Edge {
  return {
    id: returnIdOf(request.id),
    type: "animated",
    source: request.target,
    target: request.source,
    sourceHandle: RETURN_SOURCE_HANDLE,
    targetHandle: RETURN_TARGET_HANDLE,
    data: { responseTo: request.id },
  };
}

/** The requests only: every edge that is not a response. */
export function requestEdges<E extends EdgeLike>(edges: readonly E[]): E[] {
  return edges.filter((e) => !isReturnEdge(e));
}

/** Response edge by the id of the request it answers. */
export function responseOf<E extends EdgeLike>(edges: readonly E[]): Map<string, E> {
  const out = new Map<string, E>();
  for (const e of edges) {
    const to = responseToOf(e);
    if (to !== undefined && !out.has(to)) out.set(to, e);
  }
  return out;
}

/**
 * Ids of the requests that have no response: the async ones. A legacy
 * `data.async === true` flag (a v3 payload not migrated yet) also counts.
 */
export function asyncRequestIds(edges: readonly EdgeLike[]): Set<string> {
  const answered = new Set<string>();
  for (const e of edges) {
    const to = responseToOf(e);
    if (to !== undefined) answered.add(to);
  }
  const out = new Set<string>();
  for (const e of edges) {
    if (isReturnEdge(e)) continue;
    const legacy = (e.data as { async?: unknown } | undefined)?.async === true;
    if (legacy || !answered.has(e.id)) out.add(e.id);
  }
  return out;
}

/**
 * The requests of `edges` as the rest of the app reads them: each carries
 * `data.async`, true when nothing answers it (or the legacy flag says so).
 * Scoring, the advisor and the panels take this view at their boundary, so
 * "sync" has one source of truth, the response, and `isAsyncEdge` keeps working.
 */
export function requestsWithAsync<E extends Edge>(edges: readonly E[]): E[] {
  const asyncIds = asyncRequestIds(edges);
  return edges
    .filter((e) => !isReturnEdge(e))
    .map((e) =>
      (e.data as { async?: unknown } | undefined)?.async === asyncIds.has(e.id)
        ? e
        : { ...e, data: { ...e.data, async: asyncIds.has(e.id) } },
    );
}

/**
 * `edges` plus the response of every request that does not already have one
 * and is not async (`isAsync` decides; default: the legacy `data.async` flag).
 * Idempotent; the migration, the reference loader and the quick fixes share it.
 */
export function withReturns<E extends Edge>(
  edges: readonly E[],
  isAsync: (edge: E) => boolean = (e) =>
    (e.data as { async?: unknown } | undefined)?.async === true,
): Edge[] {
  const answered = new Set(responseOf(edges).keys());
  const out: Edge[] = [...edges];
  for (const e of edges) {
    if (isReturnEdge(e) || answered.has(e.id) || isAsync(e)) continue;
    out.push(makeReturnEdge(e));
  }
  return out;
}
