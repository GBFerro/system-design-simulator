import type { Edge, Node } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { isReturnEdge, requestEdges, responseOf } from "@/domain/graph/returns";
import { createComponentNode, createTextNode } from "@/lib/nodeFactory";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";

// guided-ui, RET-01/02/03/30/31: drawing the response of a call.

const s = () => useCanvasStore.getState();

function node(componentId: string, id: string, label = id): Node {
  const c = SYSTEM_COMPONENTS.find((x) => x.id === componentId)!;
  const n = createComponentNode(c, { x: 0, y: 0 });
  return { ...n, id, data: { ...n.data, label } };
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

const request = (source: string, target: string) =>
  s().onConnect({ source, target, sourceHandle: null, targetHandle: null });
/** Drag from the return handle of `callee` to the return handle of `caller`. */
const respond = (callee: string, caller: string) =>
  s().onConnect({
    source: callee,
    target: caller,
    sourceHandle: "ret-out",
    targetHandle: "ret-in",
  });

describe("drawing the response of a call", () => {
  beforeEach(() => {
    setCanvas([node("client", "a", "Client"), node("app-server", "b", "App")]);
    useAppStore.setState({ toast: null });
  });

  it("a new connection has no response: it is an async call (RET-06)", () => {
    request("a", "b");
    expect(s().edges).toHaveLength(1);
    expect(responseOf(s().edges).size).toBe(0);
    expect((s().edges[0].data as { async?: boolean }).async).toBe(true);
  });

  it("dragging from B's return handle to A creates the response of A → B, in one undo step (RET-01)", () => {
    request("a", "b");
    const before = s().history.length;
    respond("b", "a");
    const edges = s().edges;
    expect(edges).toHaveLength(2);
    const ida = requestEdges(edges)[0];
    const volta = responseOf(edges).get(ida.id)!;
    expect([volta.id, volta.source, volta.target]).toEqual([`ret:${ida.id}`, "b", "a"]);
    expect([volta.sourceHandle, volta.targetHandle]).toEqual(["ret-out", "ret-in"]);
    expect((ida.data as { async?: boolean }).async).toBe(false);
    expect(s().history.length).toBe(before + 1);
    s().undo();
    expect(s().edges).toHaveLength(1);
    expect(isReturnEdge(s().edges[0])).toBe(false);
  });

  it("without a request A → B nothing is created and a toast explains it (RET-02)", () => {
    respond("b", "a");
    expect(s().edges).toHaveLength(0);
    expect(s().history).toHaveLength(0);
    expect(useAppStore.getState().toast?.message).toBe(
      "A response needs a request: connect Client → App first",
    );
  });

  it("a second response to the same request creates no edge and no undo entry (RET-03)", () => {
    request("a", "b");
    respond("b", "a");
    const history = s().history.length;
    const edges = s().edges;
    respond("b", "a");
    expect(s().edges).toEqual(edges);
    expect(s().history).toHaveLength(history);
  });

  it("to itself or to a text node creates nothing (RET-30)", () => {
    setCanvas([node("app-server", "b"), createTextNode({ x: 0, y: 0 })]);
    const text = s().nodes[1].id;
    respond("b", "b");
    respond("b", text);
    respond(text, "b");
    expect(s().edges).toEqual([]);
    expect(s().history).toHaveLength(0);
  });

  it("A → B and B → A each take their own response (RET-31)", () => {
    request("a", "b");
    request("b", "a");
    const [ab, ba] = s().edges.map((e) => e.id);
    respond("b", "a");
    expect([...responseOf(s().edges).keys()]).toEqual([ab]);
    respond("a", "b");
    expect([...responseOf(s().edges).keys()].sort()).toEqual([ab, ba].sort());
    expect(s().edges).toHaveLength(4);
  });

  it("does nothing on a read-only tab", () => {
    setCanvas([node("client", "a"), node("app-server", "b")], [], false);
    request("a", "b");
    useCanvasStore.setState({
      tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly: true }],
    });
    respond("b", "a");
    expect(s().edges).toHaveLength(1);
  });
});
