import type { Edge, Node } from "@xyflow/react";
import type { EdgeRule, Params } from "@/domain/components/types";
import { responseToOf } from "@/domain/graph/returns";

/**
 * Canvas graph ⇄ storage shape (saved designs, JSON export, share link).
 * Only structural fields are kept: selection, measured size and runtime
 * metrics never reach storage.
 */

export interface SerializedComponentData {
  componentId: string;
  label: string;
  icon: string;
  category: string;
  scalable: boolean;
  params: Params;
}

export interface SerializedTextData {
  text: string;
  fontSize?: "sm" | "base" | "lg";
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: SerializedComponentData | SerializedTextData;
}

export interface SerializedEdgeData {
  /** A response (v4): the id of the request it answers. Carries no other field. */
  responseTo?: string;
  label?: string;
  protocol?: string;
  async?: boolean;
  /** Call rule (Spec 03). Always present after migration. */
  rule?: EdgeRule;
}

export interface SerializedEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: SerializedEdgeData;
}

type FontSize = SerializedTextData["fontSize"];

function fontSizeOf(v: unknown): FontSize {
  return v === "sm" || v === "base" || v === "lg" ? v : undefined;
}

/** Anything with the node fields we read (ReactFlow nodes or migrated records). */
type NodeLike = Pick<Node, "id" | "type" | "position" | "data">;
type EdgeLike = Pick<
  Edge,
  "id" | "type" | "source" | "target" | "sourceHandle" | "targetHandle"
> & {
  data?: Record<string, unknown>;
};

export function serializeNodes(nodes: readonly NodeLike[]): SerializedNode[] {
  return nodes.map((n) => {
    const base = {
      id: n.id,
      type: n.type ?? "component",
      position: { x: n.position.x, y: n.position.y },
    };

    if (n.type === "text") {
      return {
        ...base,
        data: {
          text: typeof n.data.text === "string" ? n.data.text : "",
          fontSize: fontSizeOf(n.data.fontSize),
        },
      };
    }

    return {
      ...base,
      data: {
        componentId: n.data.componentId as string,
        label: n.data.label as string,
        icon: n.data.icon as string,
        category: n.data.category as string,
        scalable: n.data.scalable as boolean,
        params: { ...(n.data.params as Params) },
      },
    };
  });
}

export function serializeEdges(edges: readonly EdgeLike[]): SerializedEdge[] {
  return edges.map((e) => ({
    id: e.id,
    type: e.type,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    data: responseToOf(e)
      ? { responseTo: responseToOf(e) }
      : {
          label: typeof e.data?.label === "string" ? e.data.label : "",
          protocol: typeof e.data?.protocol === "string" ? e.data.protocol : "http",
          async: e.data?.async === true,
          ...(e.data?.rule ? { rule: e.data.rule as EdgeRule } : {}),
        },
  }));
}

/** Serialized nodes → canvas nodes. */
export function deserializeNodes(nodes: readonly SerializedNode[]): Node[] {
  return nodes.map((n) => {
    if (n.type === "text") {
      const data = n.data as SerializedTextData;
      return {
        id: n.id,
        type: n.type,
        position: { ...n.position },
        connectable: false,
        data: { text: data.text ?? "", fontSize: data.fontSize },
      };
    }
    const data = n.data as SerializedComponentData;
    return {
      id: n.id,
      type: n.type,
      position: { ...n.position },
      data: { ...data, params: { ...data.params } },
    };
  });
}

/** Serialized edges → canvas edges (edge.data keeps label/protocol/async/rule). */
export function deserializeEdges(edges: readonly SerializedEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    type: e.type,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    data: e.data?.responseTo
      ? { responseTo: e.data.responseTo }
      : {
          label: e.data?.label ?? "",
          protocol: e.data?.protocol ?? "http",
          async: e.data?.async ?? false,
          ...(e.data?.rule ? { rule: { ...e.data.rule } } : {}),
        },
  }));
}
