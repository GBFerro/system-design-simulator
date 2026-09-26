import type { Node, XYPosition } from "@xyflow/react";
import type { SystemComponent } from "@/types/component";
import type { ComponentNodeData } from "@/store/canvasStore";
import { defaultParams } from "@/domain/components/registry";

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

export function createComponentNode(
  component: SystemComponent,
  position: XYPosition,
): Node<ComponentNodeData> {
  return {
    id: `${component.id}-${randomId()}`,
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
