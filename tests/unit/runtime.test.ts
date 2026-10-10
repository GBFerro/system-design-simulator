import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM } from "@/domain/components/params";
import type { Params } from "@/domain/components/types";
import { analyze, analyzeWithModel } from "@/engine/analyze";
import { simulateCanvas } from "@/engine/client";
import { TickSimulator } from "@/engine/core/tick";
import { FlowEngine } from "@/engine/engine";
import { compileFault } from "@/engine/faults/compile";
import { effectsAt } from "@/engine/faults/effects";
import { steadyStateToSnapshot } from "@/engine/snapshot";
import { comp, wire, compileV3 } from "./engineFixtures";
import { buildReferenceGraph } from "@/lib/loadReference";
import { RingBuffer } from "@/lib/ringBuffer";
import { useRuntimeStore } from "@/store/runtimeStore";

describe("RingBuffer", () => {
  it("keeps the newest items in order and overwrites the oldest", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) rb.push(i);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.toArray(2)).toEqual([4, 5]);
    expect(rb.at(0)).toBe(3);
    expect(rb.last()).toBe(5);
    rb.clear();
    expect(rb.size).toBe(0);
    expect(rb.last()).toBeUndefined();
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});

describe("steadyStateToSnapshot", () => {
  it("maps every node and edge of a reference solution, with finite metrics", () => {
    const { nodes, edges } = buildReferenceGraph(PROBLEMS[0]);
    const steady = analyze(compileV3(nodes, edges), 5000);
    const snap = steadyStateToSnapshot(steady, 1.5);
    expect(snap.t).toBe(1.5);
    expect(Object.keys(snap.nodes).sort()).toEqual(steady.nodes.map((n) => n.nodeId).sort());
    expect(Object.keys(snap.edges).sort()).toEqual(steady.edges.map((e) => e.edgeId).sort());
    for (const m of Object.values(snap.nodes)) {
      for (const v of [m.rpsIn, m.rpsOut, m.utilization, m.p50, m.p95, m.p99, m.errorRate]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(m.rpsOut).toBeLessThanOrEqual(m.rpsIn + 1e-9);
    }
    expect(snap.global.throughput).toBeLessThanOrEqual(snap.offeredRps + 1e-9);
  });
});

describe("global.readRatio (request-flow FLW-01: balls draw reads with it)", () => {
  // client → app → db: reads and writes split by the resolved read ratio.
  const design = (clientParams: Params = {}) =>
    compileV3(
      [comp("client", "client", clientParams), comp("app", "app-server"), comp("db", "sql-db")],
      [wire("client", "app"), wire("app", "db", { rule: { kind: "writes" } })],
    );
  const both = (graph: ReturnType<typeof design>, config?: { readRatio: number }) => ({
    analyze: steadyStateToSnapshot(analyze(graph, 1000, config), 0, graph, config).global.readRatio,
    tick: new TickSimulator(graph, config).step(1000).global.readRatio,
  });

  it("is the engine's default when nothing sets it, the same in analyze and the tick", () => {
    expect(both(design())).toEqual({ analyze: 0.9, tick: 0.9 });
  });

  it("follows the entry node's readRatio param in analyze and the tick", () => {
    expect(both(design({ [PARAM.readRatio]: 0.7 }))).toEqual({ analyze: 0.7, tick: 0.7 });
  });

  it("follows a config override in analyze and the tick", () => {
    expect(both(design({ [PARAM.readRatio]: 0.7 }), { readRatio: 0.25 })).toEqual({
      analyze: 0.25,
      tick: 0.25,
    });
  });
});

describe("edgeLinkFailure (request-flow FLW-05: the caller's timeout and link loss per edge)", () => {
  // client → app (timeout 5 ms) → db (200 ms per request, room to spare); the
  // client has no timeout, so only the link's loss counts on client → app.
  const design = (packetLoss = 0) => ({
    nodes: [
      comp("client", "client"),
      comp("app", "app-server", { timeoutMs: 5, maxRetries: 0, instances: 4 }),
      comp("db", "sql-db", { serviceTimeMs: 200, capacityPerInstance: 1000, instances: 4 }),
    ],
    edges: [wire("client", "app", { rule: { packetLoss } }), wire("app", "db")],
  });
  const tickOf = (d: ReturnType<typeof design>) =>
    new TickSimulator(compileV3(d.nodes, d.edges)).step(100);
  const analyzeOf = async (d: ReturnType<typeof design>) => {
    const { steady, graph, linkFailure } = await simulateCanvas(d.nodes, d.edges, 100);
    return steadyStateToSnapshot(steady, 0, graph, undefined, linkFailure);
  };

  it("is ≈ 1 on an edge whose caller times out, in the tick and in Analyze; 0 without timeout or loss", async () => {
    for (const snap of [tickOf(design()), await analyzeOf(design())]) {
      expect(snap.edgeLinkFailure?.["e-app-db"]).toBeGreaterThan(0.99);
      expect(snap.edgeLinkFailure?.["e-client-app"]).toBe(0);
      // The database itself is healthy: the failure is the caller's.
      expect(snap.nodes.db.errorRate).toBe(0);
    }
  });

  it("is the link's packet loss where the caller has no timeout", async () => {
    for (const snap of [tickOf(design(0.2)), await analyzeOf(design(0.2))]) {
      expect(snap.edgeLinkFailure?.["e-client-app"]).toBeCloseTo(0.2, 12);
    }
  });

  it("leaves out a target that fails on its own (a fault on the db), in the tick and in analyze", () => {
    const graph = compileV3(
      [
        comp("client", "client"),
        comp("app", "app-server", { maxRetries: 0, instances: 4 }),
        comp("db", "sql-db", { instances: 1, capacityPerInstance: 5000 }),
      ],
      [wire("client", "app"), wire("app", "db")],
    );
    const fault = {
      type: "transient-errors",
      target: { kind: "node", id: "db" },
      intensity: 0.9,
    } as const;

    const engine = new FlowEngine({ tickSamples: 200 });
    engine.load(graph, { seed: 3 });
    engine.setTraffic({ kind: "constant", rps: 1000 });
    engine.inject(fault);
    const tick = engine.step(20)!;

    const compiled = compileFault(fault, 0, { graph, readRatio: 0.9 });
    if (!compiled.ok) throw new Error(compiled.error);
    const { steady, linkFailure } = analyzeWithModel(
      graph,
      1000,
      undefined,
      effectsAt(compiled.modifiers, 1),
    );
    const analyzed = steadyStateToSnapshot(steady, 0, graph, undefined, linkFailure);

    for (const snap of [tick, analyzed]) {
      expect(snap.nodes.db.errorRate).toBeGreaterThan(0.8);
      expect(snap.edges["e-app-db"].status).toBe("error");
      expect(snap.edgeLinkFailure?.["e-app-db"]).toBeLessThan(1e-6);
    }
  });

  it("sits at the snapshot's top level, never inside the per-edge metrics", async () => {
    for (const snap of [tickOf(design()), await analyzeOf(design())]) {
      for (const m of Object.values(snap.edges)) {
        expect(Object.keys(m).sort()).toEqual(["rps", "status"]);
      }
    }
  });
});

describe("runtimeStore", () => {
  it("push updates latest and history; clear drops metrics but keeps speed/pattern", () => {
    const s = () => useRuntimeStore.getState();
    s().setSpeed(5);
    const snap = {
      t: 0,
      offeredRps: 1,
      nodes: {},
      edges: {},
      global: { throughput: 1, goodput: 1, errorRate: 0, p50: 1, p95: 1, p99: 1, availability: 1 },
    };
    const v0 = s().historyVersion;
    s().pushSnapshot(snap);
    expect(s().latest).toBe(snap);
    expect(s().history.size).toBe(1);
    expect(s().historyVersion).toBe(v0 + 1);
    s().clear();
    expect(s().latest).toBeNull();
    expect(s().history.size).toBe(0);
    expect(s().speed).toBe(5);
  });
});
