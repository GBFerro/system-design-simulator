import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { CategoryScore, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE } from "../budget";

/** Max points per check; sums to CATEGORY_MAX_SCORE (checked in tests/unit/scoring.test.ts). */
export const BUDGET = {
  cdn: 3,
  cacheBeforeDb: 4,
  hopCount: 4,
  dns: 1,
  asyncOffload: 4,
  loadBalancer: 2,
  lowLatencyStore: 2,
} as const;

/** Partial credit for a check that is only half met (always below its BUDGET). */
export const PARTIAL = {
  cacheBeforeDb: 1,
  hopCount: 2,
} as const satisfies Partial<Record<keyof typeof BUDGET, number>>;

export function scoreLatency(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  graph: ScoringGraph,
): CategoryScore {
  const feedback: string[] = [];
  const passed: string[] = [];
  let score = 0;

  const connectedNodes = nodes.filter((n) => graph.reachable.has(n.id));
  const connectedIds = new Set(connectedNodes.map((n) => n.data.componentId));
  const placedIds = new Set(nodes.map((n) => n.data.componentId));

  // CDN for static content
  if (connectedIds.has("cdn")) {
    score += BUDGET.cdn;
    passed.push(
      "CDN serves content from edge locations, cutting latency from 200ms+ to <20ms for static assets",
    );
  } else if (placedIds.has("cdn")) {
    feedback.push(
      "You placed a CDN but it isn't connected to the request path. Put it in front of your origin (e.g., DNS → CDN → Load Balancer) so users actually hit the edge first.",
    );
  } else {
    feedback.push(
      "Add a CDN (CloudFront, Cloudflare, Google Cloud CDN) to serve static content from edge locations close to users. Without a CDN, every request travels to your origin server — a user in Tokyo hitting a US-East server adds 150-200ms of network latency alone.",
    );
  }

  // Cache before DB
  const adj = graph.adjacency;
  const cacheNodes = connectedNodes.filter((n) => n.data.componentId === "cache");
  const dbNodes = connectedNodes.filter(
    (n) => n.data.componentId === "sql-db" || n.data.componentId === "nosql-db",
  );
  const cacheNodeIds = new Set(cacheNodes.map((c) => c.id));
  const dbNodeIds = new Set(dbNodes.map((d) => d.id));
  // (a) Look-through wiring: a DB is reachable within 2 hops from a cache
  const cacheInFront = cacheNodes.some((c) => {
    const hop1 = adj.get(c.id) ?? [];
    if (hop1.some((id) => dbNodeIds.has(id))) return true;
    return hop1.some((mid) => (adj.get(mid) ?? []).some((id) => dbNodeIds.has(id)));
  });
  // (b) Cache-aside wiring: some node fans out to both a cache and a DB
  //     (the app checks the cache first, falls back to the DB on a miss)
  const cacheAside = connectedNodes.some((n) => {
    const children = adj.get(n.id) ?? [];
    return children.some((id) => cacheNodeIds.has(id)) && children.some((id) => dbNodeIds.has(id));
  });
  const cacheBeforeDB = cacheNodes.length > 0 && dbNodes.length > 0 && (cacheInFront || cacheAside);
  if (cacheBeforeDB) {
    score += BUDGET.cacheBeforeDb;
    passed.push(
      "Cache intercepts reads before hitting the database — memory access (~1ms) vs disk (~5-10ms)",
    );
  } else if (cacheNodes.length > 0) {
    score += PARTIAL.cacheBeforeDb;
    feedback.push(
      "Your cache exists but isn't positioned to intercept reads before the database. Connect your App Server to both Cache and DB so it checks the cache first. A cache hit returns in ~1ms; a DB query takes 5-10ms or more — that's a 5-10x latency improvement on every cached read.",
    );
  } else if (placedIds.has("cache")) {
    feedback.push(
      "You placed a Cache but it isn't connected to the request path. Connect your App Server to both Cache and DB (cache-aside) so reads check the cache first.",
    );
  } else {
    feedback.push(
      "Add a Cache layer (Redis/Memcached) between your App Servers and Database. Reading from memory (~1ms) is 5-10x faster than reading from disk (~5-10ms). For read-heavy workloads, caching can serve 80-90% of requests without ever touching the database.",
    );
  }

  // Minimal hops on the synchronous request path (async edges excluded)
  const { depth: maxDepth, cyclic } = computeMaxDepth(nodes, edges);
  if (cyclic) {
    feedback.push(
      "Your design contains a cycle — requests could loop forever, so the hop count can't be credited. Break the cycle (for example, make the back-edge asynchronous via a queue) to earn these points.",
    );
  } else if (maxDepth <= 6) {
    score += BUDGET.hopCount;
    passed.push(
      "Request path has a lean hop count (" + maxDepth + " layers) — minimal serialized latency",
    );
  } else if (maxDepth <= 8) {
    score += PARTIAL.hopCount;
    passed.push("Request path has an acceptable hop count (" + maxDepth + " layers)");
  } else {
    feedback.push(
      `Request path has ${maxDepth} sequential hops — each hop adds latency (network round-trip + processing time). Consider whether all layers are necessary, or if some can be combined. Every unnecessary hop adds 2-10ms to p99 latency.`,
    );
  }

  // DNS entry point
  if (connectedIds.has("dns")) {
    score += BUDGET.dns;
    passed.push(
      "DNS-based geo-routing can direct users to the nearest region, reducing cross-region latency",
    );
  } else if (placedIds.has("dns")) {
    feedback.push(
      "You placed DNS but it isn't connected to the request path. Make it the entry point (DNS → CDN/Load Balancer) so geo-routing actually applies.",
    );
  } else {
    feedback.push(
      "Add DNS with geo-routing (Route 53, Cloud DNS) to direct users to the nearest region. DNS alone isn't a latency optimization, but DNS-based geo-routing can reduce cross-region latency by 50-150ms for international users.",
    );
  }

  // Async offloading heavy work
  if (connectedIds.has("message-queue")) {
    score += BUDGET.asyncOffload;
    passed.push(
      "Message queue offloads heavy processing from the request path, keeping responses fast",
    );
  } else if (placedIds.has("message-queue")) {
    feedback.push(
      "You placed a Message Queue but it isn't connected to the request path. Connect a producer (e.g., App Server) to it so heavy work can actually be enqueued instead of blocking responses.",
    );
  } else {
    feedback.push(
      "Add a Message Queue to offload heavy processing (transcoding, emails, analytics) from the synchronous request path. If your API handler does all the work inline, a 2-second transcoding job blocks the response for 2 seconds. Enqueue it and respond immediately.",
    );
  }

  // Load balancer for connection reuse
  if (connectedIds.has("load-balancer")) {
    score += BUDGET.loadBalancer;
    passed.push(
      "Load balancer enables connection pooling and keep-alive, though it adds an extra network hop",
    );
  } else if (placedIds.has("load-balancer")) {
    feedback.push(
      "You placed a Load Balancer but it isn't connected to the request path. Wire traffic through it so connection pooling and keep-alive actually apply.",
    );
  } else {
    feedback.push(
      "Add a Load Balancer for connection pooling and keep-alive support. LBs add an extra hop but maintain warm connections to backends, avoiding fresh TCP+TLS handshakes (30-100ms overhead) on each request.",
    );
  }

  // Low-latency data store choice — must be on a connected path
  const hasLowLatencyStore = connectedIds.has("cache") || connectedIds.has("nosql-db");
  if (hasLowLatencyStore) {
    score += BUDGET.lowLatencyStore;
    passed.push("Using low-latency data stores (in-memory cache or NoSQL) for fast data access");
  } else if (placedIds.has("cache") || placedIds.has("nosql-db")) {
    feedback.push(
      "You placed a low-latency store (Cache/NoSQL) but it isn't connected to the request path. Connect it so your hot path actually benefits from fast reads.",
    );
  } else {
    feedback.push(
      "Consider using low-latency data stores for your hot path. Redis serves reads in <1ms and DynamoDB in single-digit milliseconds, while a complex SQL JOIN can take 50-100ms. Pick the right store for your access pattern.",
    );
  }

  return { category: "Latency", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}

/**
 * Longest chain of synchronous hops. Async edges (queues, notifications,
 * monitoring) are excluded — they aren't user-facing latency. Edges touching
 * unknown nodes (text annotations) are ignored, and parallel edges deduped.
 * If a cycle prevents full processing, depth is reported as the worst case
 * (every node serialized) and flagged so the rule doesn't award hop bonuses.
 */
function computeMaxDepth(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
): { depth: number; cyclic: boolean } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.data?.async === true) continue; // async hops aren't user-facing latency
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Topological sort (Kahn's algorithm) — process each node only after all predecessors
  const dist = new Map<string, number>();
  const remaining = new Map(inDegree);
  const queue: string[] = [];

  for (const node of nodes) {
    if ((remaining.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
      dist.set(node.id, 1);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const child of adjacency.get(id) ?? []) {
      const newDist = (dist.get(id) ?? 1) + 1;
      if (newDist > (dist.get(child) ?? 0)) dist.set(child, newDist);
      const newDeg = (remaining.get(child) ?? 1) - 1;
      remaining.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  if (head < nodes.length) {
    // Some nodes never resolved — there's a cycle; assume worst-case depth.
    return { depth: nodes.length, cyclic: true };
  }
  return { depth: Math.max(0, ...dist.values()), cyclic: false };
}
