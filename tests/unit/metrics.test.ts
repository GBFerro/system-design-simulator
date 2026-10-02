import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { PARAM } from "@/domain/components/params";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { steadyStateToSnapshot } from "@/engine/snapshot";
import type { NodeRuntimeMetrics, TickSnapshot } from "@/engine/types";
import { buildReferenceGraph } from "@/lib/loadReference";
import { edgeStrokeWidth } from "@/lib/particles";
import { recentWindow, shareUnchanged, sparklinePath } from "@/lib/runtimeMetrics";
import { useRuntimeStore } from "@/store/runtimeStore";

/* ---------- fixtures ---------- */

function node(id: string, componentId: string, params: Record<string, unknown> = {}) {
  return {
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: { componentId, label: id, icon: "Server", category: "compute", scalable: true, params },
  };
}

function edge(source: string, target: string, rule?: object) {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    data: rule ? { rule } : {},
  };
}

function metrics(over: Partial<NodeRuntimeMetrics> = {}): NodeRuntimeMetrics {
  return {
    rpsIn: 100,
    rpsOut: 100,
    utilization: 0.5,
    queueDepth: 0,
    p50: 1,
    p95: 2,
    p99: 3,
    errorRate: 0,
    drops: 0,
    status: "ok",
    ...over,
  };
}

function snap(t: number, nodes: Record<string, NodeRuntimeMetrics> = {}): TickSnapshot {
  return {
    t,
    offeredRps: 100,
    nodes,
    edges: {},
    global: {
      throughput: 100,
      goodput: 100,
      errorRate: 0,
      p50: 1,
      p95: 2,
      p99: 3,
      availability: 1,
    },
  };
}

/* ---------- steadyStateToSnapshot: OBS-03 extras ---------- */

describe("steadyStateToSnapshot extras (OBS-03)", () => {
  function run(nodes: unknown[], edges: unknown[], rps = 1000) {
    const graph = compileGraph(nodes, edges);
    const steady = analyze(graph, rps);
    return { steady, graph, snapshot: steadyStateToSnapshot(steady, 0, graph) };
  }

  it("reports the cache hit ratio from the node's hitRate param", () => {
    const { snapshot } = run(
      [
        node("lb", "load-balancer"),
        node("cache", "cache", { [PARAM.hitRate]: 0.8 }),
        node("db", "sql-db"),
      ],
      [edge("lb", "cache"), edge("cache", "db", { kind: "on_miss" })],
    );
    expect(snapshot.nodes.cache.extra?.hitRatio).toBeCloseTo(0.8);
    expect(snapshot.nodes.lb.extra?.hitRatio).toBeUndefined();
  });

  it("reports connection-pool usage (Little's law) and saturates it under overload", () => {
    const light = run(
      [node("lb", "load-balancer"), node("db", "sql-db", { [PARAM.connectionPool]: 100 })],
      [edge("lb", "db")],
      100,
    ).snapshot.nodes.db.extra?.poolUsage;
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(1);

    const heavy = run(
      [node("lb", "load-balancer"), node("db", "sql-db", { [PARAM.connectionPool]: 100 })],
      [edge("lb", "db")],
      1_000_000,
    ).snapshot.nodes.db.extra?.poolUsage;
    expect(heavy).toBe(1);
  });

  it("reports replica lag from params and queue lag from the backlog", () => {
    const { snapshot, steady } = run(
      [
        node("svc", "app-server"),
        node("rr", "read-replica", { [PARAM.replicationLagMs]: 250 }),
        node("q", "message-queue"),
        node("w", "worker-pool"),
      ],
      [edge("svc", "rr", { kind: "reads" }), edge("svc", "q"), edge("q", "w")],
    );
    expect(snapshot.nodes.rr.extra?.replicationLagMs).toBe(250);
    const q = steady.nodes.find((n) => n.nodeId === "q")!;
    if (q.servedRps > 0) {
      expect(snapshot.nodes.q.extra?.queueLagSec).toBeCloseTo(q.queueDepth / q.servedRps);
    }
  });

  it("reports a closed breaker; no extras without the compiled graph", () => {
    const nodes = [node("svc", "app-server"), node("cb", "circuit-breaker"), node("db", "sql-db")];
    const edges = [edge("svc", "cb"), edge("cb", "db")];
    const { snapshot, steady } = run(nodes, edges);
    expect(snapshot.nodes.cb.extra?.breakerState).toBe("closed");
    const bare = steadyStateToSnapshot(steady);
    expect(bare.nodes.db.extra?.poolUsage).toBeUndefined();
    expect(bare.nodes.cb.extra?.breakerState).toBe("closed");
  });

  it("keeps every extra finite and in range across the reference solutions", () => {
    for (const problem of PROBLEMS) {
      const { nodes, edges } = buildReferenceGraph(problem);
      const { snapshot } = run(nodes, edges, 50_000);
      for (const m of Object.values(snapshot.nodes)) {
        const x = m.extra ?? {};
        for (const v of [x.hitRatio, x.poolUsage]) {
          if (v !== undefined) expect(v >= 0 && v <= 1).toBe(true);
        }
        for (const v of [x.queueLagSec, x.replicationLagMs]) {
          if (v !== undefined) expect(Number.isFinite(v) && v >= 0).toBe(true);
        }
      }
    }
  });
});

/* ---------- structural sharing / selector identity ---------- */

describe("runtimeStore structural sharing", () => {
  it("keeps untouched node/edge/global objects identical across pushes", () => {
    const s = () => useRuntimeStore.getState();
    s().clear();
    s().pushSnapshot({
      ...snap(0, { a: metrics(), b: metrics({ extra: { hitRatio: 0.9 } }) }),
      edges: { e1: { rps: 10, status: "ok" } },
    });
    const first = s().latest!;
    s().pushSnapshot({
      ...snap(0.05, { a: metrics(), b: metrics({ rpsIn: 200, extra: { hitRatio: 0.9 } }) }),
      edges: { e1: { rps: 10, status: "ok" } },
    });
    const second = s().latest!;
    // What a `useNodeRuntime(id)` selector returns:
    expect(second.nodes.a).toBe(first.nodes.a);
    expect(second.nodes.b).not.toBe(first.nodes.b);
    expect(second.edges).toBe(first.edges);
    expect(second.global).toBe(first.global);
    expect(second.t).toBe(0.05);
    expect(s().history.size).toBe(2);
    s().clear();
  });

  it("treats a changed OBS-03 extra as a change, and a new node as a new record", () => {
    const prev = snap(0, { a: metrics({ extra: { hitRatio: 0.9 } }) });
    const next = shareUnchanged(prev, snap(1, { a: metrics({ extra: { hitRatio: 0.8 } }) }));
    expect(next.nodes.a).not.toBe(prev.nodes.a);
    const grown = shareUnchanged(
      prev,
      snap(1, { a: metrics({ extra: { hitRatio: 0.9 } }), b: metrics() }),
    );
    expect(grown.nodes.a).toBe(prev.nodes.a);
    expect(grown.nodes).not.toBe(prev.nodes);
  });
});

/* ---------- edge styling ---------- */

describe("edge styling (OBS-04)", () => {
  it("edge width grows with load within [1.5, 6]", () => {
    expect(edgeStrokeWidth(undefined)).toBe(1.5);
    expect(edgeStrokeWidth(0)).toBe(1.5);
    expect(edgeStrokeWidth(1000)).toBeGreaterThan(edgeStrokeWidth(10));
    expect(edgeStrokeWidth(1e12)).toBe(6);
  });
});

/* ---------- sparklines ---------- */

describe("sparklinePath", () => {
  it("maps values onto a zero-baseline box", () => {
    const { d, max, points } = sparklinePath([0, 5, 10], 100, 20, 0);
    expect(max).toBe(10);
    expect(points).toEqual([
      { x: 0, y: 20 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ]);
    expect(d).toBe("M0 20 L50 10 L100 0");
  });

  it("is empty with < 2 points, flat at the baseline for all zeros, and ignores NaN", () => {
    expect(sparklinePath([5], 100, 20).d).toBe("");
    expect(sparklinePath([], 100, 20).d).toBe("");
    const zeros = sparklinePath([0, 0, 0], 100, 20, 0);
    expect(zeros.points.every((p) => p.y === 20)).toBe(true);
    const nan = sparklinePath([NaN, 4, Infinity], 10, 10, 0);
    expect(nan.max).toBe(4);
    expect(nan.points.map((p) => p.y)).toEqual([10, 0, 10]);
  });

  it("keeps the stroke inside the box with padding", () => {
    const { points } = sparklinePath([1, 2], 100, 20, 2);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThanOrEqual(98);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeLessThanOrEqual(18);
    }
  });
});

describe("recentWindow", () => {
  it("keeps the last N simulated seconds of the newest run", () => {
    const history = [
      ...Array.from({ length: 5 }, (_, i) => snap(100 + i)), // an older run
      ...Array.from({ length: 50 }, (_, i) => snap(i)), // restarted at t = 0
    ];
    const w = recentWindow(history, 30);
    expect(w[0].t).toBe(19);
    expect(w[w.length - 1].t).toBe(49);
    expect(w.every((s, i) => i === 0 || s.t >= w[i - 1].t)).toBe(true);
  });

  it("down-samples evenly and keeps the newest", () => {
    const history = Array.from({ length: 1000 }, (_, i) => snap(i * 0.01));
    const w = recentWindow(history, 30, 50);
    expect(w).toHaveLength(50);
    expect(w[w.length - 1]).toBe(history[999]);
    expect(recentWindow([], 30)).toEqual([]);
  });
});
