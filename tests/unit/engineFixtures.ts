import type { Edge, Node } from "@xyflow/react";
import { defaultParams } from "@/domain/components/registry";
import type { EdgeRule, Params } from "@/domain/components/types";
import { defaultEdgeRule } from "@/domain/graph/edgeRules";

/** Component node as the canvas stores it (params from the schema defaults + overrides). */
export function comp(id: string, componentId: string, params: Params = {}): Node {
  return {
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      componentId,
      label: id,
      icon: "Box",
      category: "compute",
      scalable: true,
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
  opts: { rule?: Partial<EdgeRule>; async?: boolean; sourceComponent?: string } = {},
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
      rule: opts.rule ? { ...base, ...opts.rule } : undefined,
    },
  };
}
