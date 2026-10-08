import type { Edge, Node } from "@xyflow/react";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { defaultParams } from "@/domain/components/registry";
import type { EdgeRuleKind, EdgeRuleV2, Params } from "@/domain/components/types";
import { defaultEdgeRule, edgeRuleV2Of, migrateEdgeRuleV2toV3 } from "@/domain/graph/edgeRules";
import { mulberry32, type Rng } from "@/engine/core/rng";

/**
 * Component node as the canvas stores it: icon/category/`scalable` from the
 * catalog entry (the scorer and the advisor read `scalable`), params from
 * the schema defaults + overrides. Unknown ids fall back to a generic
 * scalable compute node.
 */
export function comp(id: string, componentId: string, params: Params = {}): Node {
  const spec = SYSTEM_COMPONENTS.find((c) => c.id === componentId);
  return {
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId,
      label: id,
      icon: spec?.icon ?? "Box",
      category: spec?.category ?? "compute",
      scalable: spec?.scalable ?? true,
      params: { ...defaultParams(componentId), ...params },
    },
  };
}

export function text(id: string): Node {
  return { id, type: "text", position: { x: 0, y: 0 }, data: { text: "note" } };
}

export function wire(
  source: string,
  target: string,
  opts: { rule?: Partial<EdgeRuleV2>; async?: boolean; sourceComponent?: string } = {},
): Edge {
  const base = defaultEdgeRule(opts.sourceComponent, undefined, "http");
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    data: {
      label: "",
      protocol: "http",
      async: opts.async ?? false,
      // (fixtures write the flat fields; the edge stores the call-list shape)
      rule: opts.rule ? migrateEdgeRuleV2toV3({ ...edgeRuleV2Of(base), ...opts.rule }) : undefined,
    },
  };
}

/* ---------- random canvases (property tests) ---------- */

const GARBAGE: unknown[] = [NaN, -1, 0, Infinity, -Infinity, "abc", null, undefined, 1e12, 0.5];
const RULE_KINDS: EdgeRuleKind[] = ["always", "on_miss", "reads", "writes", "fraction"];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

function randomNumber(rng: Rng, max: number): unknown {
  return rng() < 0.15 ? pick(rng, GARBAGE) : Math.floor(rng() * max) + 1;
}

/** Random canvas: cycles, text nodes, dangling edges, duplicates, garbage params and rules. */
export function randomCanvas(seed: number): { nodes: Node[]; edges: Edge[]; rps: number } {
  const rng = mulberry32(seed);
  const count = 1 + Math.floor(rng() * 25);
  const ids = [...SYSTEM_COMPONENTS.map((c) => c.id), "client", "not-a-component"];
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    if (rng() < 0.1) {
      nodes.push(text(`n${i}`));
      continue;
    }
    const node = comp(`n${i}`, pick(rng, ids));
    const params = (node.data as { params: Record<string, unknown> }).params;
    params.instances = randomNumber(rng, 20);
    params.capacityPerInstance = randomNumber(rng, 20_000);
    params.serviceTimeMs = randomNumber(rng, 200);
    if (rng() < 0.3) params.maxRetries = randomNumber(rng, 5);
    if (rng() < 0.3) params.timeoutMs = randomNumber(rng, 2000);
    if (rng() < 0.3) params.maxQueue = rng() < 0.3 ? 0 : randomNumber(rng, 10_000);
    if (rng() < 0.3) params.hitRate = rng() < 0.2 ? pick(rng, GARBAGE) : rng();
    if (rng() < 0.2) params.lbAlgorithm = pick(rng, ["least-connections", "weighted", "hash", 42]);
    if (rng() < 0.2) params.consumers = randomNumber(rng, 8);
    if (rng() < 0.2) params.limitRps = randomNumber(rng, 50_000);
    nodes.push(node);
  }
  const edges: Edge[] = [];
  const edgeCount = Math.floor(rng() * count * 2.5);
  for (let i = 0; i < edgeCount; i++) {
    const source = rng() < 0.05 ? "ghost" : `n${Math.floor(rng() * count)}`;
    const target = rng() < 0.05 ? "ghost" : `n${Math.floor(rng() * count)}`;
    edges.push({
      id: `e${i}`,
      source,
      target,
      data: {
        async: rng() < 0.2,
        protocol: pick(rng, ["http", "grpc", "pubsub", "bogus"]),
        rule:
          rng() < 0.3
            ? undefined
            : {
                kind: rng() < 0.1 ? "bogus" : pick(rng, RULE_KINDS),
                fraction: rng() < 0.1 ? NaN : rng(),
                callsPerRequest: rng() < 0.1 ? pick(rng, GARBAGE) : rng() * 3,
                networkLatencyMs: rng() < 0.1 ? -5 : rng() * 5,
                packetLoss: rng() < 0.1 ? 2 : rng() * 0.05,
              },
      },
    });
  }
  const rps = rng() < 0.1 ? (pick(rng, GARBAGE) as number) : Math.floor(rng() * 500_000);
  return { nodes, edges, rps };
}
