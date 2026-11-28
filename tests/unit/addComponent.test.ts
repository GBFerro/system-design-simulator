import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { addComponentNode } from "@/lib/addComponent";
import { DEFAULT_NODE_SIZE } from "@/lib/placement";
import { clearNodeAdded, useMotionStore } from "@/store/motionStore";

// Papel quente slice 4 (specs/2026-11-24-redesign-papel-quente.md, criteria 29, 30, 36): the one
// function every add from the dock and the palette goes through. It returns the new node's id.

function setCanvas(readOnly = false) {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    history: [],
    future: [],
    clipboard: null,
    isDragging: false,
    tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly }],
    activeTabId: "t",
  });
  useAppStore.setState({ toast: null, announcement: null });
}

const nodes = () => useCanvasStore.getState().nodes;
const announcement = () => useAppStore.getState().announcement?.text ?? null;
const identity = (p: { x: number; y: number }) => p;

beforeEach(() => setCanvas());
afterEach(() => vi.unstubAllGlobals());

describe("a drop (criterion 30)", () => {
  it("adds one node centered under the pointer, announces it, and returns its id", () => {
    const id = addComponentNode("app-server", { drop: { x: 500, y: 300 } });
    expect(nodes()).toHaveLength(1);
    expect(id).toBe(nodes()[0].id);
    expect(nodes()[0].data).toMatchObject({ componentId: "app-server" });
    expect(nodes()[0].position).toEqual({
      x: 500 - DEFAULT_NODE_SIZE.width / 2,
      y: 300 - DEFAULT_NODE_SIZE.height / 2,
    });
    expect(announcement()).toBe("Added App Server");
  });

  it("is one undo entry", () => {
    addComponentNode("cache", { drop: { x: 0, y: 0 } });
    expect(useCanvasStore.getState().history).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(nodes()).toHaveLength(0);
  });

  it("starts the node with the technology it was dragged with", () => {
    addComponentNode("nosql-db", { drop: { x: 0, y: 0 } }, "cassandra");
    expect((nodes()[0].data as { params: Record<string, unknown> }).params.technology).toBe(
      "cassandra",
    );
  });
});

describe("a tap (criterion 29)", () => {
  it("places one node at the visible center, announces it, and returns its id", () => {
    // no canvas on screen: the center is the window's
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    vi.stubGlobal("document", {
      querySelector: () => null,
      querySelectorAll: () => [],
    });
    const id = addComponentNode("load-balancer", { tap: identity });
    expect(nodes()).toHaveLength(1);
    expect(id).toBe(nodes()[0].id);
    expect(nodes()[0].position).toEqual({
      x: 500 - DEFAULT_NODE_SIZE.width / 2,
      y: 400 - DEFAULT_NODE_SIZE.height / 2,
    });
    expect(announcement()).toBe("Added Load Balancer");
    expect(useCanvasStore.getState().history).toHaveLength(1);
  });
});

describe("what adds nothing", () => {
  it("a reference tab (criterion 36): a toast, no node, no announcement, no id", () => {
    setCanvas(true);
    expect(addComponentNode("app-server", { drop: { x: 0, y: 0 } })).toBeNull();
    expect(nodes()).toHaveLength(0);
    expect(useAppStore.getState().toast?.message).toBe("Reference tabs are read-only");
    expect(announcement()).toBeNull();
  });

  it("an unknown component", () => {
    expect(addComponentNode("no-such-thing", { drop: { x: 0, y: 0 } })).toBeNull();
    expect(nodes()).toHaveLength(0);
    expect(announcement()).toBeNull();
  });
});

describe("the motion mark (criteria 32, 35, 37)", () => {
  beforeEach(() => clearNodeAdded());
  afterEach(() => clearNodeAdded());

  it("marks the new node, and only it, in the unpersisted motion store", () => {
    const id = addComponentNode("app-server", { drop: { x: 0, y: 0 } });
    expect(useMotionStore.getState().node?.id).toBe(id);
    expect(JSON.stringify(nodes()[0])).not.toMatch(/landing|motion|animat/i);
    expect(useCanvasStore.getState().history).toHaveLength(1);
  });

  it("marks nothing when nothing was added", () => {
    addComponentNode("no-such-thing", { drop: { x: 0, y: 0 } });
    setCanvas(true);
    addComponentNode("app-server", { drop: { x: 0, y: 0 } });
    expect(useMotionStore.getState().node).toBeNull();
  });

  it("marks nothing when the user prefers reduced motion, but still adds and announces", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const id = addComponentNode("app-server", { drop: { x: 0, y: 0 } });
    expect(id).toBe(nodes()[0].id);
    expect(announcement()).toBe("Added App Server");
    expect(useMotionStore.getState().node).toBeNull();
  });
});

describe("announce", () => {
  it("a repeated message is a new announcement, so a screen reader says it again", () => {
    addComponentNode("client", { drop: { x: 0, y: 0 } });
    const first = useAppStore.getState().announcement;
    addComponentNode("client", { drop: { x: 300, y: 0 } });
    const second = useAppStore.getState().announcement;
    expect(second?.text).toBe(first?.text);
    expect(second?.n).toBeGreaterThan(first!.n);
  });

  it("is never persisted", () => {
    addComponentNode("client", { drop: { x: 0, y: 0 } });
    const saved = useAppStore.persist.getOptions().partialize?.(useAppStore.getState());
    expect(saved).not.toHaveProperty("announcement");
  });
});
