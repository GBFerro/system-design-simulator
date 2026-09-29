import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import { instancesOf } from "@/domain/components/registry";
import type { CategoryScore, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE } from "../budget";

/** Max points per check; sums to CATEGORY_MAX_SCORE (checked in tests/unit/scoring.test.ts). */
export const BUDGET = {
  loadBalancer: 3,
  scalableCompute: 3,
  cache: 3,
  queue: 3,
  dbScaling: 3,
  cdn: 3,
  lbToCompute: 2,
} as const;

export function scoreScalability(
  nodes: Node<ComponentNodeData>[],
  _edges: Edge[],
  graph: ScoringGraph,
): CategoryScore {
  const feedback: string[] = [];
  const passed: string[] = [];
  let score = 0;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const connectedNodes = nodes.filter((n) => graph.reachable.has(n.id));
  const connectedIds = new Set(connectedNodes.map((n) => n.data.componentId));
  const placedIds = new Set(nodes.map((n) => n.data.componentId));

  const hasLB = connectedIds.has("load-balancer");
  const hasCache = connectedIds.has("cache");
  const hasQueue = connectedIds.has("message-queue");
  const hasCDN = connectedIds.has("cdn");
  const hasScalableCompute = connectedNodes.some(
    (n) => n.data.category === "compute" && n.data.scalable,
  );
  const placedScalableCompute = nodes.some((n) => n.data.category === "compute" && n.data.scalable);
  // NoSQL databases scale horizontally out of the box (replicas=1 is fine);
  // SQL needs explicit read replicas to scale reads.
  const isDBScalingNode = (n: Node<ComponentNodeData>) =>
    n.data.componentId === "nosql-db" ||
    (n.data.componentId === "sql-db" && instancesOf(n.data) > 1);
  const hasDBScaling = connectedNodes.some(isDBScalingNode);
  const placedDBScaling = nodes.some(isDBScalingNode);

  // Check load balancer
  if (hasLB) {
    score += BUDGET.loadBalancer;
    passed.push("Load balancer distributes traffic across servers, enabling horizontal scaling");
  } else if (placedIds.has("load-balancer")) {
    feedback.push(
      "You placed a Load Balancer but it isn't connected to the request path. Wire traffic through it (entry → Load Balancer → App Servers) so it can actually distribute load.",
    );
  } else {
    feedback.push(
      "Add a Load Balancer (e.g., AWS ALB, Nginx) to distribute traffic across multiple servers. Without one, a single server handles all requests and becomes a bottleneck — you can't scale horizontally.",
    );
  }

  // Check horizontal scaling
  if (hasScalableCompute) {
    score += BUDGET.scalableCompute;
    passed.push("Horizontally scalable compute layer allows adding capacity on demand");
  } else if (placedScalableCompute) {
    feedback.push(
      "You placed scalable compute (e.g., App Server) but it isn't connected to the request path. Connect it behind your load balancer so it can serve traffic.",
    );
  } else {
    feedback.push(
      "Add stateless App Servers that can scale horizontally behind the load balancer. Stateless servers let you spin up new instances in seconds during traffic spikes, handling 10x load by simply adding more machines.",
    );
  }

  // Check caching
  if (hasCache) {
    score += BUDGET.cache;
    passed.push("Caching layer (Redis/Memcached) absorbs read traffic and reduces backend load");
  } else if (placedIds.has("cache")) {
    feedback.push(
      "You placed a Cache but it isn't connected to the request path. Connect your App Servers to it so reads can actually be absorbed by the cache.",
    );
  } else {
    feedback.push(
      "Add a caching layer (Redis/Memcached) between your App Servers and Database. This can reduce DB load by 80-90% for read-heavy workloads by serving frequently accessed data from memory (~1ms) instead of disk (~5-10ms).",
    );
  }

  // Check async processing
  if (hasQueue) {
    score += BUDGET.queue;
    passed.push("Message queue enables async processing and absorbs traffic spikes");
  } else if (placedIds.has("message-queue")) {
    feedback.push(
      "You placed a Message Queue but it isn't connected to the request path. Connect a producer (e.g., App Server) to it so heavy work can actually be offloaded.",
    );
  } else {
    feedback.push(
      "Add a Message Queue (Kafka, SQS, RabbitMQ) for asynchronous processing. Queues decouple producers from consumers, letting you buffer traffic spikes and process heavy tasks (email, transcoding, analytics) in the background without blocking user requests.",
    );
  }

  // Check DB read scaling
  if (hasDBScaling) {
    score += BUDGET.dbScaling;
    passed.push("Database layer supports read scaling via NoSQL or read replicas");
  } else if (placedDBScaling) {
    feedback.push(
      "You have a scalable database (NoSQL or replicated SQL) but it isn't connected to the request path. Connect your App Servers to it so queries actually reach it.",
    );
  } else {
    feedback.push(
      "Scale your database layer — use a NoSQL database (DynamoDB, Cassandra) for automatic horizontal scaling, or add SQL read replicas to distribute query load. A single SQL primary becomes a bottleneck beyond ~10K QPS.",
    );
  }

  // Check CDN for static content offloading
  if (hasCDN) {
    score += BUDGET.cdn;
    passed.push("CDN offloads static content delivery from origin servers");
  } else if (placedIds.has("cdn")) {
    feedback.push(
      "You placed a CDN but it isn't connected to the request path. Put it in front of your origin (e.g., DNS → CDN → Load Balancer) so static content is actually served from the edge.",
    );
  } else {
    feedback.push(
      "Add a CDN (CloudFront, Cloudflare) to offload static content delivery from your origin servers. CDNs serve cached content from 200+ edge locations worldwide, reducing origin load by 60-80% and cutting latency for global users from 200ms+ to under 20ms.",
    );
  }

  // Check LB→compute connectivity
  // True when the LB feeds a compute node directly, or feeds an API gateway /
  // rate limiter that itself reaches a compute node downstream.
  const reachesCompute = (startId: string): boolean => {
    const visited = new Set<string>([startId]);
    const queue: string[] = [startId];
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      for (const child of graph.adjacency.get(id) ?? []) {
        if (visited.has(child)) continue;
        visited.add(child);
        if (nodeMap.get(child)?.data.category === "compute") return true;
        queue.push(child);
      }
    }
    return false;
  };

  let lbToCompute = false;
  if (hasLB && hasScalableCompute) {
    outer: for (const [sourceId, children] of graph.adjacency) {
      if (nodeMap.get(sourceId)?.data.componentId !== "load-balancer") continue;
      for (const childId of children) {
        const target = nodeMap.get(childId);
        if (!target) continue;
        if (target.data.category === "compute") {
          lbToCompute = true;
          break outer;
        }
        if (
          (target.data.componentId === "api-gateway" ||
            target.data.componentId === "rate-limiter") &&
          reachesCompute(childId)
        ) {
          lbToCompute = true;
          break outer;
        }
      }
    }
  }
  if (lbToCompute) {
    score += BUDGET.lbToCompute;
    passed.push("Load balancer is properly connected to compute layer");
  } else if (hasLB && hasScalableCompute) {
    feedback.push(
      "Connect your Load Balancer to your App Servers (directly or via an API Gateway). Without this connection, the LB can't distribute traffic to your compute layer — it's like having a highway on-ramp that leads nowhere.",
    );
  }

  return { category: "Scalability", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}
