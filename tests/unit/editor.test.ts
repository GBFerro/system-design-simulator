import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MUTATING_ACTIONS, READ_ONLY_EXEMPT_ACTIONS, useCanvasStore } from "@/store/canvasStore";
import { DEFAULT_NODE_SIZE, findFreePosition, freePositionNear, nodeRect } from "@/lib/placement";
import { createComponentNode } from "@/lib/nodeFactory";
import { SYSTEM_COMPONENTS } from "@/data/components";

const comp = (id: string) => SYSTEM_COMPONENTS.find((c) => c.id === id)!;

function node(id: string, x: number, y: number, selected = false): Node {
  return { ...createComponentNode(comp("app-server"), { x, y }), id, selected };
}

function edge(source: string, target: string, selected = false): Edge {
  return { id: `${source}->${target}`, source, target, selected };
}

function setCanvas(nodes: Node[], edges: Edge[] = [], readOnly = false) {
  useCanvasStore.setState({
    nodes,
    edges,
    history: [],
    future: [],
    clipboard: null,
    isDragging: false,
    tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly }],
    activeTabId: "t",
  });
}

type Store = ReturnType<typeof useCanvasStore.getState>;
type MutatingAction = (typeof MUTATING_ACTIONS)[number];

const s = () => useCanvasStore.getState();
const overlap = (a: Node, b: Node) => {
  const r1 = nodeRect(a);
  const r2 = nodeRect(b);
  return (
    r1.x < r2.x + r2.width &&
    r2.x < r1.x + r1.width &&
    r1.y < r2.y + r2.height &&
    r2.y < r1.y + r1.height
  );
};

describe("placement", () => {
  it("returns the target when it is free", () => {
    expect(findFreePosition({ x: 0, y: 0 }, DEFAULT_NODE_SIZE, [])).toEqual({ x: 0, y: 0 });
  });

  it("spirals out until nothing overlaps", () => {
    const placed: Node[] = [];
    for (let i = 0; i < 25; i++) {
      placed.push(node(`n${i}`, 0, 0));
      placed[i].position = freePositionNear({ x: 0, y: 0 }, placed.slice(0, i));
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlap(placed[i], placed[j]), `${i}/${j}`).toBe(false);
  });
});

describe("canvas store editing", () => {
  beforeEach(() => setCanvas([]));

  it("deleteSelection removes nodes, selected edges and dangling edges in one undo step", () => {
    setCanvas(
      [node("a", 0, 0, true), node("b", 300, 0, true), node("c", 600, 0)],
      [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    );
    s().deleteSelection();
    expect(s().nodes.map((n) => n.id)).toEqual(["c"]);
    expect(s().edges).toEqual([]);
    expect(s().history).toHaveLength(1);
    s().undo();
    expect(s().nodes).toHaveLength(3);
    expect(s().edges).toHaveLength(3);
  });

  it("deleteSelection also removes a lone selected edge", () => {
    setCanvas([node("a", 0, 0), node("b", 300, 0)], [edge("a", "b", true)]);
    s().deleteSelection();
    expect(s().nodes).toHaveLength(2);
    expect(s().edges).toHaveLength(0);
  });

  it("copy/paste clones nodes and inner edges with fresh ids, selected, without overlap", () => {
    setCanvas(
      [node("a", 0, 0, true), node("b", 300, 0, true), node("c", 600, 0)],
      [edge("a", "b"), edge("b", "c")],
    );
    expect(s().copySelection()).toBe(2);
    s().pasteClipboard({ x: 150, y: 36 }); // right on top of a/b
    const { nodes, edges } = s();
    expect(nodes).toHaveLength(5);
    const pasted = nodes.slice(3);
    expect(pasted.every((n) => n.selected)).toBe(true);
    expect(nodes.slice(0, 3).some((n) => n.selected)).toBe(false);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(5);
    // Only the a->b edge is inside the copied subgraph
    expect(edges).toHaveLength(3);
    const newEdge = edges[2];
    expect(pasted.map((n) => n.id)).toEqual(
      expect.arrayContaining([newEdge.source, newEdge.target]),
    );
    for (const p of pasted) for (const o of nodes.slice(0, 3)) expect(overlap(p, o)).toBe(false);
    expect(s().history).toHaveLength(1);
  });

  it("duplicateSelection is one undo step", () => {
    setCanvas([node("a", 0, 0, true)]);
    s().duplicateSelection();
    expect(s().nodes).toHaveLength(2);
    s().undo();
    expect(s().nodes).toHaveLength(1);
  });

  it("consecutive nudges share one undo step", () => {
    setCanvas([node("a", 0, 0, true)]);
    s().nudgeSelection(16, 0);
    s().nudgeSelection(16, 0);
    s().nudgeSelection(0, 64);
    expect(s().nodes[0].position).toEqual({ x: 32, y: 64 });
    expect(s().history).toHaveLength(1);
    s().undo();
    expect(s().nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("changeReplicas clamps at 1", () => {
    setCanvas([node("a", 0, 0)]);
    s().changeReplicas("a", -1);
    expect(s().history).toHaveLength(0);
    s().changeReplicas("a", 1);
    expect((s().nodes[0].data.params as Record<string, unknown>).instances).toBe(2);
  });

  it("selectAll / selectOnly / clearSelection drive node.selected and edge.selected", () => {
    setCanvas([node("a", 0, 0), node("b", 300, 0)], [edge("a", "b")]);
    s().selectAll();
    expect(s().nodes.every((n) => n.selected) && s().edges.every((e) => e.selected)).toBe(true);
    s().selectOnly(["b"]);
    expect(s().nodes.map((n) => !!n.selected)).toEqual([false, true]);
    expect(s().edges[0].selected).toBe(false);
    s().clearSelection();
    expect(s().nodes.some((n) => n.selected)).toBe(false);
  });

  // One call per mutating action, aimed at something that exists, so a
  // missing gate would change the graph. Typed over MUTATING_ACTIONS: a new
  // entry there needs arguments here.
  const EDIT_CALLS: { [K in MutatingAction]: Parameters<Store[K]> } = {
    onNodesChange: [
      [
        { type: "position", id: "a", position: { x: 50, y: 50 }, dragging: true },
        { type: "remove", id: "b" },
        { type: "add", item: node("x", 900, 0) },
      ],
    ],
    onEdgesChange: [[{ type: "remove", id: "a->b" }]],
    onConnect: [{ source: "b", target: "a", sourceHandle: null, targetHandle: null }],
    addNode: [node("x", 900, 0)],
    placeNode: [node("x", 0, 0), { x: 0, y: 0 }],
    pasteClipboard: [{ x: 0, y: 0 }],
    duplicateSelection: [],
    nudgeSelection: [16, 0],
    changeReplicas: ["a", 1],
    updateNodeParams: ["a", { instances: 5 }],
    updateEdgeRule: ["a->b", { kind: "reads" }],
    updateNodeData: ["a", { label: "Renamed" }],
    updateEdgeData: ["a->b", { label: "renamed" }],
    clearCanvas: [],
    deleteSelection: [],
  };

  it("read-only tabs reject every edit", () => {
    setCanvas([node("a", 0, 0, true), node("b", 300, 0)], [edge("a", "b", true)], true);
    expect(s().copySelection()).toBe(1); // copying out of a reference is allowed
    const before = s();
    for (const action of MUTATING_ACTIONS) {
      (s()[action] as (...args: unknown[]) => void)(...EDIT_CALLS[action]);
      expect(s().nodes, action).toBe(before.nodes);
      expect(s().edges, action).toBe(before.edges);
      expect(s().history, action).toHaveLength(0);
    }
  });

  it("read-only tabs still select and measure nodes and edges", () => {
    setCanvas([node("a", 0, 0), node("b", 300, 0)], [edge("a", "b")], true);
    s().onNodesChange([
      { type: "select", id: "a", selected: true },
      { type: "dimensions", id: "b", dimensions: { width: 200, height: 80 } },
    ]);
    s().onEdgesChange([{ type: "select", id: "a->b", selected: true }]);
    expect(s().nodes[0].selected).toBe(true);
    expect(s().nodes[1].measured).toEqual({ width: 200, height: 80 });
    expect(s().edges[0].selected).toBe(true);
    expect(s().history).toHaveLength(0);
  });

  it("every store action is either gated on read-only tabs or explicitly exempt", () => {
    const actions = Object.keys(s()).filter((k) => typeof s()[k as keyof Store] === "function");
    const mutating = new Set<string>(MUTATING_ACTIONS);
    const exempt = new Set<string>(READ_ONLY_EXEMPT_ACTIONS);
    for (const action of actions)
      expect(mutating.has(action) !== exempt.has(action), `classify "${action}"`).toBe(true);
    expect([...mutating, ...exempt].sort()).toEqual([...actions].sort());
  });

  it("a nudge right after an undo starts a new undo step", () => {
    setCanvas([node("a", 0, 0, true)]);
    s().nudgeSelection(16, 0);
    s().undo();
    s().nudgeSelection(0, 16);
    expect(s().history).toHaveLength(1);
    s().undo();
    expect(s().nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});
