import type { XYPosition } from "@xyflow/react";
import { getComponentById } from "@/data/components";
import { createComponentNode } from "@/lib/nodeFactory";
import { DEFAULT_NODE_SIZE, placeAtVisibleCenter } from "@/lib/placement";
import { useAppStore } from "@/store/appStore";
import { isActiveTabReadOnly, useCanvasStore } from "@/store/canvasStore";
import { markNodeAdded, prefersReducedMotion } from "@/store/motionStore";

/** Where a new component goes: the visible center of the canvas (a tap), or under the pointer (a drop). */
export type AddTarget =
  | {
      /** `screenToFlowPosition` of the React Flow instance: the node is placed at the visible center. */
      tap: (p: XYPosition) => XYPosition;
    }
  | {
      /** The pointer's position in flow space: the node is centered on it. */
      drop: XYPosition;
    };

/**
 * The one way a component from the dock or the palette gets onto the canvas: a click or a key on a
 * tile, a tap on a palette row, a drop. It creates the node (`lib/nodeFactory.ts`), places it, announces
 * it ("Added App Server", for the live region) and returns the new node's id, or `null` when nothing
 * was added (a reference tab, which gets a toast, or an unknown component). Marks that follow "the
 * node just added" (motion) hang off the id this returns, in this one place.
 *
 * A tap goes through `placeNode` at the visible center (clear of the other nodes and the floating
 * overlays); a drop goes through `addNode` at the pointer.
 */
export function addComponentNode(
  componentId: string,
  target: AddTarget,
  technology?: string,
): string | null {
  const component = getComponentById(componentId);
  if (!component) return null;
  const canvas = useCanvasStore.getState();
  if (isActiveTabReadOnly(canvas)) {
    useAppStore.getState().showToast("Reference tabs are read-only", "info");
    return null;
  }
  const at =
    "tap" in target
      ? { x: 0, y: 0 }
      : {
          x: target.drop.x - DEFAULT_NODE_SIZE.width / 2,
          y: target.drop.y - DEFAULT_NODE_SIZE.height / 2,
        };
  const node = createComponentNode(component, at, technology);
  if ("tap" in target) placeAtVisibleCenter(canvas.placeNode, node, target.tap);
  else canvas.addNode(node);
  // The landing (a view mark, never in node.data); a user who asked for reduced motion gets none.
  if (!prefersReducedMotion()) markNodeAdded(node.id);
  useAppStore.getState().announce(`Added ${component.label}`);
  return node.id;
}
