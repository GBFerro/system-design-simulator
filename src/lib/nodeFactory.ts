import type { Node, XYPosition } from "@xyflow/react";
import type { SystemComponent } from "@/types/component";
import type { ComponentNodeData } from "@/store/canvasStore";
import { defaultParams, sanitizeParams } from "@/domain/components/registry";
import { techPreset } from "@/domain/components/technologies";

/** crypto.randomUUID is unavailable on non-secure (http) origins, e.g. a phone on the LAN. */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the non-crypto fallback
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** A component node (not a text note): what scoring, cost and the advisor read. */
export function isComponentNode(n: Node): n is Node<ComponentNodeData> {
  return (
    n.type !== "text" && typeof (n.data as { componentId?: unknown })?.componentId === "string"
  );
}

/**
 * A new component node. With `technology` (component-technologies, TEC-21/22)
 * its params start from that technology's preset and its default class;
 * without one the node is `generic`, with the schema defaults (references
 * and quick fixes build nodes that way).
 */
export function createComponentNode(
  component: SystemComponent,
  position: XYPosition,
  technology?: string,
): Node<ComponentNodeData> {
  const node = componentNodeWithId(component, `${component.id}-${randomId()}`, position);
  if (!technology) return node;
  const params = sanitizeParams(component.id, {
    ...node.data.params,
    ...techPreset(component.id, technology),
  });
  return { ...node, data: { ...node.data, params } };
}

/** `createComponentNode` with a given id (pure: the advisor's quick fixes build nodes this way). */
export function componentNodeWithId(
  component: SystemComponent,
  id: string,
  position: XYPosition,
): Node<ComponentNodeData> {
  return {
    id,
    type: "component",
    position,
    data: {
      componentId: component.id,
      label: component.label,
      icon: component.icon,
      category: component.category,
      scalable: component.scalable,
      params: defaultParams(component.id),
    },
  };
}

export function createTextNode(position: XYPosition): Node {
  return {
    id: `text-${randomId()}`,
    type: "text",
    position,
    data: { text: "" },
    connectable: false,
  };
}
