import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Edge, Node } from "@xyflow/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PARAM } from "@/domain/components/registry";

// Spec 05 acceptance: a real v1 localStorage (built from the persisted shapes
// of canvasStore / savedDesignsStore / penStore before the v2 contract)
// opens in v2 with no loss of nodes, edges, labels, protocols, async or strokes.

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/v1-localStorage.json", import.meta.url)), "utf8"),
) as Record<string, string>;

type V1Node = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};
type V1Edge = { id: string; source: string; target: string; data?: Record<string, unknown> };
type Graph = { nodes: V1Node[]; edges: V1Edge[] };

const v1Canvas = JSON.parse(FIXTURE["systemsim-canvas"]).state as Graph & {
  tabs: (Graph & { id: string; label: string; readOnly?: boolean })[];
  activeTabId: string;
};
const v1Saved = JSON.parse(FIXTURE["systemsim-saved-designs"]).state as {
  designs: (Graph & { id: string; name: string; strokes: unknown[] })[];
};
const v1Pen = JSON.parse(FIXTURE["systemsim-pen-strokes"]).state as { strokes: unknown[] };

const storage = new Map<string, string>();

beforeAll(() => {
  for (const [k, v] of Object.entries(FIXTURE)) storage.set(k, v);
  // safeLocalStorage reads window.localStorage; there is no IndexedDB in
  // Node, so saved designs take the localStorage fallback path here (the
  // IndexedDB move is covered by persistence.storage and the E2E test).
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every v1 node/edge is present in `graph` with its structural data intact. */
function expectNoLoss(v1: Graph, graph: { nodes: Node[] | V1Node[]; edges: Edge[] | V1Edge[] }) {
  expect(graph.nodes.map((n) => n.id)).toEqual(v1.nodes.map((n) => n.id));
  for (const before of v1.nodes) {
    const after = (graph.nodes as V1Node[]).find((n) => n.id === before.id)!;
    expect(after.position).toEqual(before.position);
    if (before.type === "text") {
      expect(after.data).toEqual(before.data);
      continue;
    }
    const d = before.data;
    expect(after.data).toMatchObject({
      componentId: d.componentId,
      label: d.label,
      icon: d.icon,
      category: d.category,
      scalable: d.scalable,
    });
    expect(after.data.params).toMatchObject({
      [PARAM.capacityPerInstance]: d.maxQPS,
      [PARAM.serviceTimeMs]: d.latencyMs,
      [PARAM.instances]: d.replicas,
    });
    for (const f of ["maxQPS", "latencyMs", "replicas", "utilization", "status", "isBottleneck"])
      expect(after.data).not.toHaveProperty(f);
  }

  expect(graph.edges.map((e) => e.id)).toEqual(v1.edges.map((e) => e.id));
  for (const before of v1.edges) {
    const after = (graph.edges as V1Edge[]).find((e) => e.id === before.id)!;
    expect(after.source).toBe(before.source);
    expect(after.target).toBe(before.target);
    expect(after.data).toMatchObject(before.data ?? {});
    expect(after.data?.rule).toMatchObject({ callsPerRequest: 1 });
  }
}

describe("v1 localStorage → v2 stores", () => {
  it("canvas: live graph and every tab migrate without loss", async () => {
    const { useCustomComponentsStore } = await import("@/store/customComponentsStore");
    const { useCanvasStore } = await import("@/store/canvasStore");
    await useCustomComponentsStore.persist.rehydrate();
    await useCanvasStore.persist.rehydrate();

    const state = useCanvasStore.getState();
    expect(state.activeTabId).toBe("my-design");
    expectNoLoss(v1Canvas, state);
    // ReactFlow fields survive too
    expect(state.nodes[0]).toMatchObject({ measured: { width: 180, height: 76 } });

    // cache → db is on_miss; the async pubsub edge keeps async/protocol
    const rule = (id: string) => state.edges.find((e) => e.id === id)!.data!.rule;
    expect(rule("xy-edge__cache-27ab4c-sql-db-6c7d8e")).toMatchObject({ kind: "on_miss" });
    expect(rule("xy-edge__load-balancer-5f1c2a-app-server-9d0e11")).toMatchObject({
      kind: "always",
    });

    const ref = state.tabs.find((t) => t.id === "ref-url-shortener")!;
    expect(ref.readOnly).toBe(true);
    expectNoLoss(v1Canvas.tabs[1], ref);
    // Active tab snapshot is rebuilt from the live graph
    expect(state.tabs.find((t) => t.id === "my-design")!.nodes).toBe(state.nodes);

    // Written back as v2
    const persisted = JSON.parse(storage.get("systemsim-canvas")!);
    expect(persisted.version).toBe(2);
    expect(persisted.state.nodes[1].data.params[PARAM.instances]).toBe(4);
  });

  it("saved designs: every design migrates without loss", async () => {
    const { useSavedDesignsStore } = await import("@/store/savedDesignsStore");
    await useSavedDesignsStore.persist.rehydrate();
    const { designs } = useSavedDesignsStore.getState();
    expect(designs.map((d) => d.id)).toEqual(v1Saved.designs.map((d) => d.id));
    designs.forEach((design, i) => {
      const before = v1Saved.designs[i];
      expect(design.name).toBe(before.name);
      expect(design.strokes).toEqual(before.strokes);
      expectNoLoss(before, design as unknown as Graph);
    });
    expect(JSON.parse(storage.get("systemsim-saved-designs")!).version).toBe(2);
  });

  it("pen strokes and app state pass through unchanged", async () => {
    const { usePenStore } = await import("@/store/penStore");
    const { useAppStore } = await import("@/store/appStore");
    await usePenStore.persist.rehydrate();
    await useAppStore.persist.rehydrate();
    expect(usePenStore.getState().strokes).toEqual(v1Pen.strokes);
    expect(useAppStore.getState().selectedProblemId).toBe("url-shortener");
    expect(JSON.parse(storage.get("systemsim-pen-strokes")!).version).toBe(2);
  });

  it("loading a migrated saved design puts the same graph on the canvas", async () => {
    const { useSavedDesignsStore } = await import("@/store/savedDesignsStore");
    const { useCanvasStore } = await import("@/store/canvasStore");
    const { usePenStore } = await import("@/store/penStore");
    const design = useSavedDesignsStore.getState().designs[0];
    useSavedDesignsStore.getState().loadDesign(design.id);
    const state = useCanvasStore.getState();
    expectNoLoss(v1Saved.designs[0], state);
    expect(usePenStore.getState().strokes).toEqual(v1Saved.designs[0].strokes);
  });

  it("imports a v1 JSON export into saved designs and exports it back as v2", async () => {
    const { useSavedDesignsStore } = await import("@/store/savedDesignsStore");
    const v1File = JSON.stringify({
      schemaVersion: 1,
      ...JSON.parse(FIXTURE["systemsim-saved-designs"]).state.designs[0],
    });
    const result = useSavedDesignsStore.getState().importDesign(v1File);
    expect(result).toEqual({ ok: true, warnings: [] });
    const imported = useSavedDesignsStore.getState().designs[0];
    expect(imported.name).toBe("URL shortener v3 (imported)");
    expectNoLoss(v1Saved.designs[0], imported as unknown as Graph);

    const exported = JSON.parse(useSavedDesignsStore.getState().exportDesign(imported.id));
    expect(exported.schemaVersion).toBe(2);
    expect(exported.nodes).toEqual(imported.nodes);
    expect(exported.edges).toEqual(imported.edges);
    expect(exported.strokes).toEqual(imported.strokes);
  });
});
