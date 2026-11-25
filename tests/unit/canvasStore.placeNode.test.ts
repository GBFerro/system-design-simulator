import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { createComponentNode } from "@/lib/nodeFactory";
import { nodeRect } from "@/lib/placement";
import { useCanvasStore } from "@/store/canvasStore";

const appServer = SYSTEM_COMPONENTS.find((c) => c.id === "app-server")!;
const s = () => useCanvasStore.getState();

describe("canvasStore placeNode", () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      history: [],
      future: [],
      tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly: false }],
      activeTabId: "t",
    });
  });

  it("keeps the new node out of the blocked rects it is given", () => {
    const blocked = [{ x: -100, y: -100, width: 200, height: 200 }];
    s().placeNode(createComponentNode(appServer, { x: 0, y: 0 }), { x: 0, y: 0 }, blocked);
    const p = nodeRect(s().nodes[0]);
    const clear = p.x >= 100 || p.x + p.width <= -100 || p.y >= 100 || p.y + p.height <= -100;
    expect(clear).toBe(true);
  });

  it("without blocked rects centers the node on the point", () => {
    s().placeNode(createComponentNode(appServer, { x: 0, y: 0 }), { x: 0, y: 0 });
    expect(s().nodes[0].position).toEqual({ x: -80, y: -60 });
  });
});
