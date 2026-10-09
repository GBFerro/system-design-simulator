import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  INSTANCE_CARD_STEP,
  toEdgeChanges,
  toNodeChanges,
  withInstances,
} from "@/components/canvas/instanceGraph";

// OBS-04: an expanded node is drawn as one card per instance, its edges once
// per card; canvasStore only ever sees the single node and edge.

const comp = (id: string, componentId: string, instances: number, x = 0, y = 0): Node => ({
  id,
  type: "component",
  position: { x, y },
  data: { componentId, label: id, icon: "Server", category: "compute", params: { instances } },
});
const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "animated",
  data: { rule: { kind: "always", callsPerRequest: 1, networkLatencyMs: 1, packetLoss: 0 } },
});

describe("expanded nodes as instance cards (OBS-04)", () => {
  const nodes = [
    comp("lb", "load-balancer", 1),
    comp("app", "app-server", 45, 100, 50),
    comp("db", "sql-db", 1),
  ];
  const edges = [edge("lb", "app"), edge("app", "db")];

  it("leaves the graph alone when nothing is expanded", () => {
    const out = withInstances(nodes, edges, {});
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });

  it("opens a node into 4 cards plus a stacked one, each with its own edges", () => {
    const out = withInstances(nodes, edges, { app: true });
    const cards = out.nodes.filter((n) => n.type === "instance");
    expect(cards.map((c) => c.id)).toEqual([0, 1, 2, 3, 4].map((k) => `inst:app:${k}`));
    expect(out.nodes.some((n) => n.id === "app")).toBe(false);
    expect(cards[4].data).toMatchObject({ stacked: 41, instances: 45 });
    expect(cards[2].position).toEqual({ x: 100, y: 50 + 2 * INSTANCE_CARD_STEP });

    const into = out.edges.filter((e) => e.source === "lb");
    expect(into.map((e) => e.target)).toEqual(cards.map((c) => c.id));
    // Each copy carries its card's share; only one shows the label.
    expect(into[0].data).toMatchObject({ instanceOf: "lb->app", hideLabel: false });
    expect(into[0].data?.share).toBeCloseTo(1 / 45);
    expect(into[4].data?.share).toBeCloseTo(41 / 45);
    expect(into.slice(1).every((e) => e.data?.hideLabel)).toBe(true);
    expect(out.edges.filter((e) => e.target === "db")).toHaveLength(5);
  });

  it("a node with one instance doesn't expand", () => {
    const out = withInstances(nodes, edges, { db: true });
    expect(out.nodes).toBe(nodes);
  });

  it("maps a card's selection and drag back onto the node", () => {
    const changes = toNodeChanges(
      [
        { type: "select", id: "inst:app:3", selected: true },
        {
          type: "position",
          id: "inst:app:2",
          position: { x: 300, y: 400 + 2 * INSTANCE_CARD_STEP },
          dragging: true,
        },
        { type: "dimensions", id: "inst:app:1", dimensions: { width: 176, height: 68 } },
      ],
      nodes,
    );
    expect(changes).toEqual([
      { type: "select", id: "app", selected: true },
      { type: "position", id: "app", position: { x: 300, y: 400 }, dragging: true },
    ]);
  });

  it("maps an edge copy's selection back onto the edge and drops the rest", () => {
    expect(
      toEdgeChanges([
        { type: "select", id: "inst:lb->app:-1:2", selected: true },
        { type: "remove", id: "inst:lb->app:-1:3" },
      ]),
    ).toEqual([{ type: "select", id: "lb->app", selected: true }]);
  });
});

// guided-ui, RET-15: the response of a call is drawn once per card too.
describe("instance cards and responses (RET-15)", () => {
  const nodes = [comp("lb", "load-balancer", 1), comp("app", "app-server", 3)];
  const request = edge("lb", "app");
  const response: Edge = {
    id: "ret:lb->app",
    type: "animated",
    source: "app",
    target: "lb",
    sourceHandle: "ret-out",
    targetHandle: "ret-in",
    data: { responseTo: request.id },
  };

  it("an expanded node gets one copy of the response per card, each between the same cards as its request", () => {
    const out = withInstances(nodes, [request, response], { app: true });
    const requests = out.edges.filter(
      (e) => (e.data as { instanceOf?: string }).instanceOf === request.id,
    );
    const responses = out.edges.filter(
      (e) => (e.data as { instanceOf?: string }).instanceOf === response.id,
    );
    expect(requests).toHaveLength(3);
    expect(responses).toHaveLength(3);
    expect(responses.map((r) => [r.source, r.target])).toEqual(
      requests.map((r) => [r.target, r.source]),
    );
    expect(
      responses.every((r) => r.sourceHandle === "ret-out" && r.targetHandle === "ret-in"),
    ).toBe(true);
    expect(
      responses.every((r) => (r.data as { responseTo: string }).responseTo === request.id),
    ).toBe(true);
    expect(new Set(out.edges.map((e) => e.id)).size).toBe(out.edges.length);
    expect(responses.map((r) => (r.data as { share: number }).share)).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
  });
});
