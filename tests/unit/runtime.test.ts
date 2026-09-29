import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { steadyStateToSnapshot } from "@/engine/snapshot";
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
    const steady = analyze(compileGraph(nodes, edges), 5000);
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
