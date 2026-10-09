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

  it("connecting another call keeps the responses already drawn", () => {
    setCanvas([node("client", "a"), node("app-server", "b"), node("sql-db", "c")]);
    request("a", "b");
    respond("b", "a");
    request("b", "c");
    expect(s().edges).toHaveLength(3);
    expect(responseOf(s().edges).size).toBe(1);
  });

  it("a new connection has no response: it is an async call (RET-06)", () => {
    request("a", "b");
    expect(s().edges).toHaveLength(1);
    expect(responseOf(s().edges).size).toBe(0);
    expect(s().edges[0].data).not.toHaveProperty("async"); // (the response is the only source of truth)
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

describe("deleting calls and responses (RET-07, RET-08)", () => {
  beforeEach(() => {
    setCanvas([node("client", "a"), node("app-server", "b"), node("sql-db", "c")]);
    request("a", "b");
    respond("b", "a");
  });

  const select = (ids: string[]) =>
    useCanvasStore.setState({
      edges: s().edges.map((e) => ({ ...e, selected: ids.includes(e.id) })),
    });

  it("deleting a request deletes its response in the same undo entry, and undo brings both back (RET-08)", () => {
    const ida = requestEdges(s().edges)[0];
    select([ida.id]);
    const history = s().history.length;
    s().deleteSelection();
    expect(s().edges).toEqual([]);
    expect(s().history).toHaveLength(history + 1);
    s().undo();
    expect(
      s()
        .edges.map((e) => e.id)
        .sort(),
    ).toEqual([ida.id, `ret:${ida.id}`].sort());
  });

  it("deleting only the response makes the request async (RET-07)", () => {
    const ida = requestEdges(s().edges)[0];
    select([`ret:${ida.id}`]);
    s().deleteSelection();
    expect(s().edges.map((e) => e.id)).toEqual([ida.id]);
    expect(responseOf(s().edges).size).toBe(0);
  });

  it("deleting a node takes the calls and responses touching it", () => {
    request("b", "c");
    respond("c", "b");
    expect(s().edges).toHaveLength(4);
    useCanvasStore.setState({ nodes: s().nodes.map((n) => ({ ...n, selected: n.id === "c" })) });
    s().deleteSelection();
    expect(s().edges).toHaveLength(2);
    expect(s().edges.every((e) => e.source !== "c" && e.target !== "c")).toBe(true);
  });

  it("onEdgesChange removals follow the same rule", () => {
    const ida = requestEdges(s().edges)[0];
    s().onEdgesChange([{ id: ida.id, type: "remove" }]);
    expect(s().edges).toEqual([]);
  });
});

describe("Sync / Async shortcut (RET-12, RET-13, RET-17)", () => {
  beforeEach(() => {
    setCanvas([node("client", "a"), node("app-server", "b")]);
    request("a", "b");
    useCanvasStore.setState({ history: [] });
  });

  it("Sync draws the response, in one undo step (RET-12)", () => {
    const ida = s().edges[0];
    const history = s().history.length;
    s().setEdgeSync(ida.id, true);
    expect(responseOf(s().edges).get(ida.id)?.id).toBe(`ret:${ida.id}`);
    expect(s().history).toHaveLength(history + 1);
    s().undo();
    expect(s().edges.map((e) => e.id)).toEqual([ida.id]);
  });

  it("Async deletes the response, in one undo step (RET-13)", () => {
    const ida = s().edges[0];
    s().setEdgeSync(ida.id, true);
    const history = s().history.length;
    s().setEdgeSync(ida.id, false);
    expect(s().edges.map((e) => e.id)).toEqual([ida.id]);
    expect(s().history).toHaveLength(history + 1);
    s().undo();
    expect(s().edges).toHaveLength(2);
  });

  it("asking for the state it already has changes nothing and records no undo entry", () => {
    const ida = s().edges[0];
    s().setEdgeSync(ida.id, false);
    expect(s().history).toHaveLength(0);
    s().setEdgeSync(ida.id, true);
    const history = s().history.length;
    const edges = s().edges;
    s().setEdgeSync(ida.id, true);
    expect(s().edges).toBe(edges);
    expect(s().history).toHaveLength(history);
  });

  it("accepts the id of the response too", () => {
    const ida = s().edges[0];
    s().setEdgeSync(ida.id, true);
    s().setEdgeSync(`ret:${ida.id}`, false);
    expect(s().edges.map((e) => e.id)).toEqual([ida.id]);
  });

  it("does nothing on a read-only tab (RET-17)", () => {
    useCanvasStore.setState({
      tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly: true }],
    });
    const edges = s().edges;
    s().setEdgeSync(edges[0].id, true);
    expect(s().edges).toBe(edges);
    expect(s().history).toHaveLength(0);
  });
});

describe("copy, paste and duplicate (RET-28)", () => {
  beforeEach(() => {
    setCanvas([node("client", "a"), node("app-server", "b"), node("sql-db", "c")]);
    request("a", "b");
    respond("b", "a");
    request("b", "c");
    useCanvasStore.setState({ history: [] });
  });

  const selectNodes = (ids: string[]) =>
    useCanvasStore.setState({
      nodes: s().nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    });

  it("duplicating two nodes copies the call, its response (linked to the new call) and the async call as it was", () => {
    selectNodes(["a", "b", "c"]);
    s().duplicateSelection();
    const edges = s().edges;
    const copies = edges.filter((e) => e.selected);
    expect(copies).toHaveLength(3);
    const copiedRequests = requestEdges(copies);
    expect(copiedRequests).toHaveLength(2);
    const answered = responseOf(copies);
    expect(copiedRequests.map((r) => answered.has(r.id))).toEqual([true, false]);
    const response = [...answered.values()][0];
    const request = copiedRequests[0];
    expect([response.id, response.source, response.target]).toEqual([
      `ret:${request.id}`,
      request.target,
      request.source,
    ]);
    expect(request.id).not.toBe(requestEdges(edges)[0].id);
    expect(s().history).toHaveLength(1);
  });

  it("a response whose call wasn't copied isn't pasted", () => {
    selectNodes(["b", "c"]);
    s().copySelection();
    s().pasteClipboard({ x: 900, y: 900 });
    const pasted = s().edges.filter((e) => e.selected);
    expect(pasted).toHaveLength(1);
    expect(isReturnEdge(pasted[0])).toBe(false);
  });

  it("a response selected alone isn't copied", () => {
    useCanvasStore.setState({ edges: s().edges.map((e) => ({ ...e, selected: isReturnEdge(e) })) });
    expect(s().copySelection()).toBe(0);
  });
});
