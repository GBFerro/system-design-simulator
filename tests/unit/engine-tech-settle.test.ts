import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { SimGraph } from "@/domain/graph/compile";
import { probSojournExceeds, station } from "@/engine/core/queueing";
import { forwardEdges } from "@/engine/core/routing";
import { settle, sampleNodesFor, type FlowView, type Topology } from "@/engine/core/settle";
import { slowShareOf } from "@/engine/core/slo";
import { classTail, techExceeds, techSteadyFlow } from "@/engine/core/tech";
import { comp, compileV3, wire } from "./engineFixtures";

function topologyOf(graph: SimGraph, readRatio = 0.9): Topology {
  return {
    byId: new Map(graph.nodes.map((n) => [n.id, n])),
    order: graph.order,
    entries: graph.entryIds,
    out: forwardEdges(graph.edges),
    readRatio,
  };
}

/** A generic node's flow at `offered` (what analyze() builds for it). */
function genericFlow(graph: SimGraph, id: string, offered: number): FlowView {
  const node = graph.nodes.find((n) => n.id === id)!;
  const st = station({
    lambda: offered,
    instances: node.instances,
    capacityPerInstance: node.capacityPerInstance,
    serviceTimeMs: node.serviceTimeMs,
    maxQueue: Infinity,
    horizonSec: 10,
  });
  return { st, offered, served: st.servedRps, dropped: offered - st.servedRps };
}

/** A node with a technology: its classes at `offered` with write share `ws`. */
function techFlow(graph: SimGraph, id: string, offered: number, ws: number): FlowView {
  const node = graph.nodes.find((n) => n.id === id)!;
  const steady = techSteadyFlow({
    profile: node.tech!,
    core: node,
    offered,
    writeShare: ws,
    maxQueue: Infinity,
    horizonSec: 10,
  });
  return {
    st: steady.stations[0],
    offered,
    served: steady.served,
    dropped: offered - steady.served,
    tech: steady.view,
  };
}

function twoNodes(target: Node, appParams: Record<string, number> = {}): SimGraph {
  return compileV3([comp("app", "app-server", appParams), target], [wire("app", target.id)]);
}

describe("settle with nodes that have a technology (T25)", () => {
  it("a call into a blown quota fails in the proportion throttled / λ (S3, TEC-37)", () => {
    // (a caller that waits long enough for the 30 ms GETs never to time out)
    const graph = twoNodes(comp("s3", "object-storage", { technology: "s3", prefixes: 1 }), {
      timeoutMs: 300_000,
    });
    const edge = graph.edges[0];
    const flows = new Map([
      // (the caller's own flow is synthetic: light enough to serve everything)
      ["app", genericFlow(graph, "app", 100)],
      ["s3", techFlow(graph, "s3", 10_000, 0)],
    ]);
    const reads = settle(topologyOf(graph), flows, new Map(), new Map([[edge.id, 0]]));
    // 10,000 GET/s on one prefix: 4,500 throttled.
    expect(reads.failure.get(edge.id)).toBeCloseTo(4_500 / 10_000, 9);
    // The same node called with writes only (none of them throttled) doesn't fail.
    const writes = settle(topologyOf(graph), flows, new Map(), new Map([[edge.id, 1]]));
    expect(writes.failure.get(edge.id)).toBeCloseTo(0, 9);
    // The caller's success follows the failed calls.
    expect(reads.success.get("app")).toBeCloseTo(1 - 0.45, 6);
  });

  it("an API Gateway past its throttle fails 1 − L/λ of the calls (TEC-38)", () => {
    const graph = twoNodes(comp("gw", "api-gateway", { technology: "aws-api-gateway" }));
    const flows = new Map([
      ["app", genericFlow(graph, "app", 15_000)],
      ["gw", techFlow(graph, "gw", 15_000, 0.2)],
    ]);
    const settled = settle(topologyOf(graph), flows, new Map());
    expect(settled.failure.get(graph.edges[0].id)).toBeCloseTo(5_000 / 15_000, 9);
  });

  it("a timeout into a kth target uses the class mix of the EDGE's write share (TEC-29)", () => {
    const graph = twoNodes(
      comp("db", "nosql-db", { technology: "cassandra", instances: 3, consistencyLevel: "quorum" }),
      { timeoutMs: 6 },
    );
    const edge = graph.edges[0];
    const flows = new Map([
      ["app", genericFlow(graph, "app", 100)],
      ["db", techFlow(graph, "db", 100, 0.2)],
    ]);
    const db = flows.get("db")!.tech!;
    const t = 6 - 2 * edge.rule.networkLatencyMs;
    const settled = settle(topologyOf(graph), flows, new Map(), new Map([[edge.id, 0.7]]));
    const expected = 0.3 * classTail(db.read, t) + 0.7 * classTail(db.write, t);
    expect(expected).toBeGreaterThan(0.01);
    expect(settled.failure.get(edge.id)).toBeCloseTo(expected, 12);
    expect(settled.failure.get(edge.id)).toBeCloseTo(techExceeds(db, 0.7, t), 12);
    // Without an edge share, the node's own mix.
    const own = settle(topologyOf(graph), flows, new Map());
    expect(own.failure.get(edge.id)).toBeCloseTo(techExceeds(db, 0.2, t), 12);
  });

  it("generic nodes: the same success and availability bit for bit, write shares or not", () => {
    const graph = compileV3(
      [
        comp("client", "client"),
        comp("app", "app-server", { timeoutMs: 40, maxRetries: 1 }),
        comp("cache", "cache"),
        comp("db", "sql-db"),
      ],
      [
        wire("client", "app"),
        wire("app", "cache", { rule: { kind: "reads" } }),
        wire("app", "db", { rule: { kind: "writes" } }),
      ],
    );
    const flows = new Map(
      ["client", "app", "cache", "db"].map((id) => [id, genericFlow(graph, id, 900)] as const),
    );
    const without = settle(topologyOf(graph), flows, new Map());
    const withShares = settle(
      topologyOf(graph),
      flows,
      new Map(),
      new Map(graph.edges.map((e) => [e.id, 0.5])),
    );
    expect(withShares).toEqual(without);
    // And the calls into them time out by the sojourn tail, as before.
    const db = flows.get("db")!;
    const toDb = graph.edges.find((e) => e.target === "db")!;
    expect(without.failure.get(toDb.id)).toBe(
      1 -
        (1 - toDb.rule.packetLoss) *
          (1 - probSojournExceeds(db.st, 40 - 2 * toDb.rule.networkLatencyMs)),
    );
    // No sample node of a generic design carries a class.
    const nodes = sampleNodesFor(topologyOf(graph), flows, new Map());
    expect([...nodes.values()].every((n) => !("tech" in n))).toBe(true);
  });

  it("sampleNodesFor gives a node with a technology its read and write classes", () => {
    const graph = twoNodes(comp("s3", "object-storage", { technology: "s3" }));
    const flows = new Map([
      ["app", genericFlow(graph, "app", 8_000)],
      ["s3", techFlow(graph, "s3", 8_000, 0.25)],
    ]);
    const nodes = sampleNodesFor(topologyOf(graph), flows, new Map());
    const s3 = nodes.get("s3")!;
    expect(s3.tech?.read).toBe(flows.get("s3")!.tech!.read);
    expect(s3.tech?.write).toBe(flows.get("s3")!.tech!.write);
    expect("tech" in nodes.get("app")!).toBe(false);
  });
});

describe("scoped latency SLO by class (T25)", () => {
  it("a node with a technology counts P(hop > threshold) by its class mix; a generic one by its sojourn tail", () => {
    const graph = compileV3(
      [
        comp("app", "app-server"),
        comp("db", "nosql-db", { technology: "cassandra", instances: 3, consistencyLevel: "all" }),
      ],
      [wire("app", "db")],
    );
    const flows = new Map([
      ["app", genericFlow(graph, "app", 500)],
      ["db", techFlow(graph, "db", 500, 0.3)],
    ]);
    const db = flows.get("db")!;
    const scoped = slowShareOf({ thresholdMs: 4, scope: "nosql-db" }, 0, graph.nodes, flows);
    expect(scoped).toBeCloseTo(techExceeds(db.tech!, 0.3, 4), 12);
    expect(scoped).toBeGreaterThan(0);
    const app = flows.get("app")!;
    const generic = slowShareOf({ thresholdMs: 4, scope: "app-server" }, 0, graph.nodes, flows);
    expect(generic).toBe(probSojournExceeds(app.st, 4));
  });
});
