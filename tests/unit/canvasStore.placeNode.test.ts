import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { createComponentNode, createTextNode } from "@/lib/nodeFactory";
import { nodeRect, nodeSize, TEXT_NODE_SIZE } from "@/lib/placement";
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

  it("places a note with the note's footprint, not the component default", () => {
    s().placeNode(createTextNode({ x: 0, y: 0 }), { x: 0, y: 0 });
    const note = s().nodes[0];
    const size = nodeSize(note);
    expect(size).toEqual(TEXT_NODE_SIZE);
    expect(note.position).toEqual({ x: -size.width / 2, y: -size.height / 2 });
  });

  it("a second note lands clear of the first by the note's own width and height", () => {
    s().placeNode(createTextNode({ x: 0, y: 0 }), { x: 0, y: 0 });
    s().placeNode(createTextNode({ x: 0, y: 0 }), { x: 0, y: 0 });
    const [a, b] = s().nodes.map(nodeRect);
    const apart = a.x + a.width + 24 <= b.x || b.x + b.width + 24 <= a.x;
    const apartY = a.y + a.height + 24 <= b.y || b.y + b.height + 24 <= a.y;
    expect(apart || apartY).toBe(true);
  });

  it("without blocked rects centers the node on the point", () => {
    s().placeNode(createComponentNode(appServer, { x: 0, y: 0 }), { x: 0, y: 0 });
    expect(s().nodes[0].position).toEqual({ x: -80, y: -60 });
  });
});
