import { describe, expect, it } from "vitest";
import { defaultParams, PARAM } from "@/domain/components/registry";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { retryAmplification, station } from "@/engine/core/queueing";
import { callProbability, edgeFactor, forwardEdges } from "@/engine/core/routing";
import { settle, type FlowView, type Topology } from "@/engine/core/settle";
import { simulateCanvas } from "@/engine/client";
import { createEngine } from "@/engine/engine";
import { FaultError } from "@/engine/faults/runner";
import { analyzeUnderFault } from "@/engine/faults/steady";
import type { EdgeCall } from "@/domain/components/types";
import type { SteadyState } from "@/engine/types";
import type { Edge } from "@xyflow/react";
import { comp, text, wire } from "./engineFixtures";

const byId = (s: SteadyState, id: string) => s.nodes.find((n) => n.nodeId === id)!;
const edgeOf = (s: SteadyState, source: string, target: string) =>
  s.edges.find((e) => e.source === source && e.target === target)!;

/** An edge carrying an explicit call list (schema v3). */
function callWire(source: string, target: string, calls: EdgeCall[], async = false): Edge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    data: { protocol: "http", async, rule: { calls, networkLatencyMs: 1, packetLoss: 0 } },
  };
}

const call = (kind: EdgeCall["kind"], extra: Partial<EdgeCall> = {}): EdgeCall => ({
  kind,
  callsPerRequest: 1,
  ...extra,
});

describe("analyze(): queueing through the graph", () => {
  it("M/M/1 node at ρ = 0.5 waits S·ρ/(1−ρ)", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("app", "app-server", { instances: 1, capacityPerInstance: 100, serviceTimeMs: 10 }),
      ],
      [wire("lb", "app")],
    );
    const s = analyze(graph, 50);
    const app = byId(s, "app");
    expect(app.offeredRps).toBeCloseTo(50, 9);
    expect(app.utilization).toBeCloseTo(0.5, 9);
    expect(app.queueWaitMs).toBeCloseTo(10, 6);
    expect(app.meanLatencyMs).toBeCloseTo(20, 6);
  });

  it("cache with 90% hits sends 10% of its load to the DB", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("cache", "cache", { hitRate: 0.9 }),
        comp("db", "sql-db", { instances: 4 }),
      ],
      // No explicit rule: out of a cache the default is on_miss.
      [wire("lb", "cache"), wire("cache", "db")],
    );
    const s = analyze(graph, 20_000);
    const cache = byId(s, "cache");
    const db = byId(s, "db");
    expect(cache.offeredRps).toBeCloseTo(20_000, 6);
    expect(db.offeredRps).toBeCloseTo(0.1 * cache.offeredRps, 6);
  });

  it("cache hit rate h generally reduces the DB to (1 − h)", () => {
    for (const h of [0, 0.25, 0.5, 0.99, 1]) {
      const graph = compileGraph(
        [
          comp("lb", "load-balancer"),
          comp("cache", "cache", { hitRate: h }),
          comp("db", "nosql-db"),
        ],
        [wire("lb", "cache"), wire("cache", "db")],
      );
      const s = analyze(graph, 1000);
      expect(byId(s, "db").offeredRps).toBeCloseTo(1000 * (1 - h), 6);
    }
  });

  it("routes service edges by rule: reads/writes mix, fraction and callsPerRequest", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("app", "app-server", { instances: 10 }),
        comp("replica", "sql-db"),
        comp("primary", "sql-db"),
        comp("search", "search"),
        comp("auth", "auth-service"),
      ],
      [
        wire("lb", "app"),
        wire("app", "replica", { rule: { kind: "reads" } }),
        wire("app", "primary", { rule: { kind: "writes" } }),
        wire("app", "search", { rule: { kind: "fraction", fraction: 0.2 } }),
        wire("app", "auth", { rule: { kind: "always", callsPerRequest: 2 } }),
      ],
    );
    const s = analyze(graph, 1000, { readRatio: 0.8 });
    expect(byId(s, "replica").offeredRps).toBeCloseTo(800, 6);
    expect(byId(s, "primary").offeredRps).toBeCloseTo(200, 6);
    expect(byId(s, "search").offeredRps).toBeCloseTo(200, 6);
    expect(byId(s, "auth").offeredRps).toBeCloseTo(2000, 6);
  });

  it("load balancer splits by algorithm", () => {
    const nodes = (algorithm: string) => [
      comp("lb", "load-balancer", { lbAlgorithm: algorithm }),
      comp("a", "app-server", { instances: 1, capacityPerInstance: 1000 }),
      comp("b", "app-server", { instances: 3, capacityPerInstance: 1000 }),
    ];
    const edges = [wire("lb", "a"), wire("lb", "b")];
    const rr = analyze(compileGraph(nodes("round-robin"), edges), 2000);
    expect(byId(rr, "a").offeredRps).toBeCloseTo(1000, 6);
    expect(byId(rr, "b").offeredRps).toBeCloseTo(1000, 6);
    const weighted = analyze(compileGraph(nodes("weighted"), edges), 2000);
    expect(byId(weighted, "a").offeredRps).toBeCloseTo(500, 6);
    expect(byId(weighted, "b").offeredRps).toBeCloseTo(1500, 6);
    const lc = analyze(compileGraph(nodes("least-connections"), edges), 2000);
    expect(byId(lc, "a").offeredRps).toBeCloseTo(500, 6);
    expect(byId(lc, "b").offeredRps).toBeCloseTo(1500, 6);
  });

  it("rate limiter passes min(λ, limit) and rejects the excess as errors", () => {
    const graph = compileGraph(
      [
        comp("rl", "rate-limiter", { limitRps: 3000, overLimitAction: "reject" }),
        comp("app", "app-server", { instances: 10 }),
      ],
      [wire("rl", "app")],
    );
    const s = analyze(graph, 5000);
    const rl = byId(s, "rl");
    expect(rl.servedRps).toBeCloseTo(3000, 6);
    expect(rl.droppedRps).toBeCloseTo(2000, 6);
    expect(byId(s, "app").offeredRps).toBeCloseTo(3000, 6);
    expect(s.throughputRps).toBeCloseTo(3000, 6);
    expect(s.errorRate).toBeCloseTo(0.4, 6);
  });

  it("queue decouples: consumers bound the drain rate, the rest becomes lag", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("mq", "message-queue", { consumers: 2 }),
        comp("worker", "app-server", { instances: 5, capacityPerInstance: 1000 }),
      ],
      [wire("lb", "mq"), wire("mq", "worker")],
    );
    const s = analyze(graph, 5000);
    // 2 consumers × 1000 rps each, even though the worker has 5 instances
    expect(byId(s, "worker").offeredRps).toBeCloseTo(2000, 6);
    const mq = byId(s, "mq");
    expect(mq.servedRps).toBeCloseTo(5000, 6); // accepted: the producer isn't failed
    expect(mq.isBottleneck).toBe(true);
    expect(mq.queueDepth).toBeGreaterThan(0);
    // Consumers are async for the user: the lag isn't user-facing latency or errors.
    expect(s.errorRate).toBeCloseTo(0, 9);
    expect(s.latency.p99Ms).toBeLessThan(1000);
  });

  it("async edges carry load but stay out of user-facing latency", () => {
    const nodes = [
      comp("lb", "load-balancer"),
      comp("app", "app-server", { instances: 10, timeoutMs: 60_000 }),
      comp("slow", "data-warehouse", { instances: 100 }),
    ];
    const sync = analyze(compileGraph(nodes, [wire("lb", "app"), wire("app", "slow")]), 100);
    const async = analyze(
      compileGraph(nodes, [wire("lb", "app"), wire("app", "slow", { async: true })]),
      100,
    );
    expect(byId(async, "slow").offeredRps).toBeCloseTo(100, 6);
    expect(sync.latency.p50Ms).toBeGreaterThan(1000); // data warehouse ~5 s
    expect(async.latency.p99Ms).toBeLessThan(500);
  });
});

describe("analyze(): retries", () => {
  it("edge load equals base × (1 − f^{R+1})/(1 − f) at the fixed point", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("app", "app-server", { instances: 20, maxRetries: 3, timeoutMs: 5000 }),
        // No buffer (maxQueue 0): an M/M/c/c loss system, drop fraction = Erlang B
        comp("dep", "auth-service", {
          instances: 1,
          capacityPerInstance: 1000,
          serviceTimeMs: 5,
          maxQueue: 0,
        }),
      ],
      [wire("lb", "app"), wire("app", "dep")],
    );
    const s = analyze(graph, 900);
    const e = edgeOf(s, "app", "dep");
    const dep = byId(s, "dep");
    const f = e.failureRate;
    expect(f).toBeGreaterThan(0.01);
    expect(f).toBeLessThan(0.99);
    expect(f).toBeCloseTo(dep.errorRate, 6); // failures = drops at the dependency
    expect(e.retryAmplification).toBeCloseTo(retryAmplification(f, 3), 6);
    expect(e.rps).toBeCloseTo(900 * ((1 - f ** 4) / (1 - f)), 3);
    // End to end, a request fails only if all R+1 attempts fail.
    expect(s.errorRate).toBeCloseTo(f ** 4, 3);
  });

  it("retry storm: a dependency that always times out gets (R+1)× the load", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("app", "app-server", { instances: 20, maxRetries: 2, timeoutMs: 100 }),
        comp("db", "sql-db", { instances: 1, capacityPerInstance: 100 }),
      ],
      [wire("lb", "app"), wire("app", "db")],
    );
    const s = analyze(graph, 1000);
    const e = edgeOf(s, "app", "db");
    expect(e.failureRate).toBeCloseTo(1, 9);
    expect(e.rps).toBeCloseTo(3000, 6);
    expect(byId(s, "db").offeredRps).toBeCloseTo(3000, 6);
    expect(s.throughputRps).toBeCloseTo(0, 6);
  });
});

describe("analyze(): graph hygiene and entry points", () => {
  it("ignores edges to/from text nodes and dangling edges", () => {
    const nodes = [text("note"), comp("app", "app-server"), comp("db", "sql-db")];
    const edges = [
      wire("app", "db"),
      wire("app", "note"),
      wire("note", "db"),
      wire("note", "app"),
      wire("app", "ghost"),
    ];
    const graph = compileGraph(nodes, edges);
    expect(graph.nodes.map((n) => n.id)).toEqual(["app", "db"]);
    expect(graph.edges).toHaveLength(1);
    // The text-node edge into `app` must not make it a non-entry.
    expect(graph.entryIds).toEqual(["app"]);
    const s = analyze(graph, 1000);
    expect(byId(s, "app").offeredRps).toBeCloseTo(1000, 6);
    expect(byId(s, "db").offeredRps).toBeCloseTo(1000, 6);
  });

  it("a node with no edges is not an entry point and gets no traffic", () => {
    const graph = compileGraph(
      [comp("lb", "load-balancer"), comp("app", "app-server"), comp("lonely", "cache")],
      [wire("lb", "app")],
    );
    expect(graph.entryIds).toEqual(["lb"]);
    const s = analyze(graph, 1000);
    const lonely = byId(s, "lonely");
    expect(lonely.offeredRps).toBe(0);
    expect(lonely.status).toBe("idle");
    expect(byId(s, "lb").offeredRps).toBeCloseTo(1000, 6);
  });

  it("with no edges at all nothing receives traffic", () => {
    const s = analyze(compileGraph([comp("app", "app-server")], []), 1000);
    expect(s.entryIds).toEqual([]);
    expect(s.throughputRps).toBe(0);
    expect(byId(s, "app").offeredRps).toBe(0);
    expect(s.warnings.some((w) => w.includes("No connections"))).toBe(true);
  });

  it("a Client node is the entry point when present", () => {
    const graph = compileGraph(
      [
        comp("client", "client"),
        comp("lb", "load-balancer"),
        comp("app", "app-server"),
        comp("orphan-root", "cache"),
        comp("db", "sql-db"),
      ],
      [wire("client", "lb"), wire("lb", "app"), wire("orphan-root", "db")],
    );
    expect(graph.entryIds).toEqual(["client"]);
    const s = analyze(graph, 1000);
    expect(byId(s, "app").offeredRps).toBeCloseTo(1000, 6);
    expect(byId(s, "orphan-root").offeredRps).toBe(0);
    expect(byId(s, "db").offeredRps).toBe(0);
  });

  it("dedupes parallel edges and drops self-loops", () => {
    const graph = compileGraph(
      [comp("lb", "load-balancer"), comp("app", "app-server", { instances: 10 })],
      [wire("lb", "app"), { ...wire("lb", "app"), id: "dup" }, wire("app", "app")],
    );
    expect(graph.edges).toHaveLength(1);
    const s = analyze(graph, 1000);
    expect(byId(s, "app").offeredRps).toBeCloseTo(1000, 6);
  });

  it("cycles: traffic goes around once, the closing edge carries nothing", () => {
    const graph = compileGraph(
      [
        comp("lb", "load-balancer"),
        comp("a", "app-server", { instances: 10 }),
        comp("b", "message-queue"),
        comp("c", "sql-db"),
      ],
      [wire("lb", "a"), wire("a", "b"), wire("b", "a"), wire("b", "c")],
    );
    expect(graph.cycleIds.sort()).toEqual(["a", "b"]);
    const back = graph.edges.find((e) => e.back)!;
    expect([back.source, back.target]).toEqual(["b", "a"]);
    const s = analyze(graph, 1000);
    expect(byId(s, "a").offeredRps).toBeCloseTo(1000, 6);
    expect(byId(s, "c").offeredRps).toBeGreaterThan(0);
  });

  it("sanitizes params: garbage falls back to schema defaults, v1 top-level fields are ignored", () => {
    const bad = comp("app", "app-server");
    (bad.data as Record<string, unknown>).params = {
      instances: -4,
      capacityPerInstance: NaN,
      serviceTimeMs: "fast",
      hitRate: 7,
    };
    const legacy = {
      id: "old",
      type: "component",
      position: { x: 0, y: 0 },
      data: { componentId: "sql-db", label: "Old DB", maxQPS: 777, latencyMs: 3, replicas: 2 },
    };
    const graph = compileGraph([bad, legacy], [wire("app", "old")]);
    const app = graph.nodes.find((n) => n.id === "app")!;
    expect(app.instances).toBe(1);
    expect(app.capacityPerInstance).toBe(5000);
    expect(app.serviceTimeMs).toBe(20);
    expect(app.params.hitRate).toBeUndefined(); // not in the app-server schema
    // v1 numbers are converted by the persistence migration, not read here.
    const old = graph.nodes.find((n) => n.id === "old")!;
    const db = defaultParams("sql-db");
    expect([old.instances, old.capacityPerInstance, old.serviceTimeMs]).toEqual([
      db[PARAM.instances],
      db[PARAM.capacityPerInstance],
      db[PARAM.serviceTimeMs],
    ]);
  });
});

describe("compileGraph: call plan (request-flow)", () => {
  const lookAside = [
    comp("client", "client"),
    comp("svc", "app-server", { instances: 10 }),
    comp("redis", "cache", { hitRate: 0.9 }),
    comp("db", "sql-db", { instances: 4 }),
    comp("log", "monitoring"),
  ];

  it("every node with a forward outgoing edge carries its plan; leaves don't", () => {
    const graph = compileGraph(lookAside, [
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
      callWire("svc", "log", [call("always")], true),
    ]);
    const plan = (id: string) => graph.nodes.find((n) => n.id === id)!.plan;
    expect(
      plan("client")!
        .steps.flat()
        .map((p) => p.edgeId),
    ).toEqual(["e-client-svc"]);
    const svc = plan("svc")!;
    expect(svc.steps.map((g) => g.map((p) => `${p.edgeId}#${p.index}@${p.step}`))).toEqual([
      ["e-svc-redis#0@1"],
      ["e-svc-db#0@2"],
      ["e-svc-db#1@3"],
    ]);
    expect(svc.async.map((p) => p.edgeId)).toEqual(["e-svc-log"]);
    expect(svc.steps[2][0].dependsOn).toBe("e-svc-redis");
    expect(svc.absorbed).toEqual(["e-svc-redis"]);
    expect(plan("redis")).toBeUndefined();
    expect(plan("db")).toBeUndefined();
    expect(plan("log")).toBeUndefined();
    expect(graph.warnings).toEqual([]);
  });

  it("a back edge stays out of the plan and carries no load (FLW-46)", () => {
    const graph = compileGraph(
      [
        comp("client", "client"),
        comp("a", "app-server", { instances: 10 }),
        comp("redis", "cache", { hitRate: 0.5 }),
        comp("b", "app-server", { instances: 10 }),
      ],
      [
        wire("client", "a"),
        callWire("a", "redis", [call("reads")]),
        callWire("a", "b", [call("always")]),
        // closes the cycle a → b → a: a conditional call on the back edge
        callWire("b", "a", [call("after_miss", { missOf: "redis" })]),
      ],
    );
    const back = graph.edges.find((e) => e.back)!;
    expect([back.source, back.target]).toEqual(["b", "a"]);
    expect(graph.nodes.find((n) => n.id === "b")!.plan).toBeUndefined();
    const a = graph.nodes.find((n) => n.id === "a")!.plan!;
    expect(a.steps.flat().map((p) => p.edgeId)).toEqual(["e-a-redis", "e-a-b"]);
    expect(edgeOf(analyze(graph, 1000), "b", "a").rps).toBe(0);
  });

  it.each([
    ["missOf names a node the graph doesn't have (FLW-42)", "ghost"],
    ["missOf names a node without hit rate (FLW-43)", "log"],
  ])("%s: graph.warnings says so and the call counts as reads", (_name, missOf) => {
    const graph = compileGraph(lookAside, [
      wire("client", "svc"),
      callWire("svc", "log", [call("always")]),
      callWire("svc", "db", [call("after_miss", { missOf })]),
    ]);
    const svc = graph.nodes.find((n) => n.id === "svc")!.plan!;
    expect(svc.steps.flat().find((p) => p.target === "db")!.call.kind).toBe("reads");
    expect(svc.warnings).toHaveLength(1);
    expect(graph.warnings).toContain(svc.warnings[0]);
    expect(svc.warnings[0]).toMatch(/svc → db: "reads after a miss" .*treated as reads/);
  });

  it("a raised after-miss step shows up in graph.warnings (FLW-29)", () => {
    const graph = compileGraph(lookAside, [
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads", { step: 2 })]),
      callWire("svc", "db", [call("after_miss", { missOf: "redis", step: 1 })]),
    ]);
    const svc = graph.nodes.find((n) => n.id === "svc")!.plan!;
    expect(svc.steps.flat().find((p) => p.target === "db")!.step).toBe(3);
    expect(svc.warnings).toHaveLength(1);
    expect(svc.warnings[0]).toMatch(/svc → db: .*at step 1; it runs at step 3/);
    expect(graph.warnings).toContain(svc.warnings[0]);
  });

  it("stays structured-clone safe: plain arrays and objects only", () => {
    const graph = compileGraph(lookAside, [
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
    ]);
    const svc = graph.nodes.find((n) => n.id === "svc")!.plan!;
    expect(Array.isArray(svc.absorbed)).toBe(true);
    expect(structuredClone(graph)).toEqual(graph);
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });
});

describe("routing: probability of each call (request-flow)", () => {
  // svc reads redis (h 0.9), then writes the db and reads it after a miss
  const graph = compileGraph(
    [
      comp("client", "client"),
      comp("svc", "app-server", { instances: 10 }),
      comp("redis", "cache", { hitRate: 0.9 }),
      comp("cdn", "cdn", { hitRate: 0.85 }),
      comp("db", "sql-db", { instances: 4 }),
    ],
    [
      wire("client", "svc"),
      callWire("svc", "redis", [call("reads")]),
      callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
      callWire("cdn", "db", [call("on_miss")]),
    ],
  );
  const nodeOf = (id: string) => graph.nodes.find((n) => n.id === id)!;
  const edge = (source: string, target: string) =>
    graph.edges.find((e) => e.source === source && e.target === target)!;
  const byIdMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const svc = nodeOf("svc");

  it("reads, writes, fraction, always and read-through keep their Spec 04 values (FLW-14)", () => {
    const ctx = { readRatio: 0.9 };
    expect(callProbability(call("reads"), svc, ctx)).toBe(0.9);
    expect(callProbability(call("writes"), svc, ctx)).toBe(1 - 0.9);
    expect(callProbability(call("fraction", { fraction: 0.2 }), svc, ctx)).toBe(0.2);
    expect(callProbability(call("always"), svc, ctx)).toBe(1);
    // read-through: the calling cache's own misses
    expect(callProbability(call("on_miss"), nodeOf("cdn"), ctx)).toBe(1 - 0.85);
  });

  it("after_miss is r × (1 − h × (1 − f)): 0.09 with a healthy cache, every read when it fails (FLW-09, FLW-13)", () => {
    const afterMiss = call("after_miss", { missOf: "redis" });
    const cacheCall = edge("svc", "redis").id;
    const at = (f: number) =>
      callProbability(
        afterMiss,
        svc,
        { readRatio: 0.9, byId: byIdMap, failure: new Map([[cacheCall, f]]) },
        cacheCall,
      );
    expect(at(0)).toBeCloseTo(0.09, 12);
    expect(at(1)).toBeCloseTo(0.9, 12);
    expect(at(0.5)).toBeCloseTo(0.9 * (1 - 0.9 * 0.5), 12);
  });

  it("with one call, the edge factor is exactly P(taken) × callsPerRequest", () => {
    const one = (calls: EdgeCall[], source = "svc") =>
      compileGraph(
        [comp("svc", "app-server"), comp("cdn", "cdn", { hitRate: 0.85 }), comp("db", "sql-db")],
        [callWire(source, "db", calls)],
      );
    const factor = (calls: EdgeCall[], source = "svc") => {
      const g = one(calls, source);
      return edgeFactor(
        g.edges[0],
        g.nodes.find((n) => n.id === source)!,
        { readRatio: 0.9 },
      );
    };
    expect(factor([call("reads", { callsPerRequest: 3 })])).toBe(0.9 * 3);
    expect(factor([call("writes", { callsPerRequest: 2.5 })])).toBe((1 - 0.9) * 2.5);
    expect(factor([call("fraction", { fraction: 0.1, callsPerRequest: 4 })])).toBe(0.1 * 4);
    expect(factor([call("always", { callsPerRequest: 0 })])).toBe(0);
    expect(factor([call("on_miss", { callsPerRequest: 2 })], "cdn")).toBe((1 - 0.85) * 2);
  });

  it("an edge with several calls sums them: writes + reads after a miss", () => {
    const ctx = { readRatio: 0.9, byId: byIdMap };
    expect(edgeFactor(edge("svc", "db"), svc, ctx)).toBeCloseTo(0.1 + 0.09, 12);
    const down = new Map([[edge("svc", "redis").id, 1]]);
    expect(edgeFactor(edge("svc", "db"), svc, { ...ctx, failure: down })).toBeCloseTo(1, 12);
  });
});

describe("settle: a look-aside cache's failure is a miss (request-flow)", () => {
  const nodes = [
    comp("client", "client"),
    comp("svc", "app-server", { instances: 10 }),
    comp("redis", "cache", { hitRate: 0.9 }),
    comp("db", "sql-db", { instances: 4 }),
  ];

  /** settle() over a compiled graph with each node serving `servedShare` of its arrivals. */
  function settleOf(
    edges: Edge[],
    servedShare: Record<string, number>,
    availability: Record<string, number> = {},
  ) {
    const graph = compileGraph(nodes, edges);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [id, a] of Object.entries(availability)) byId.get(id)!.params.availability = a;
    const topo: Topology = {
      byId,
      order: graph.order,
      entries: graph.entryIds,
      out: forwardEdges(graph.edges),
      readRatio: 0.9,
    };
    const flows = new Map<string, FlowView>();
    for (const n of graph.nodes) {
      const offered = 1000;
      const served = offered * (servedShare[n.id] ?? 1);
      const st = station({
        lambda: served,
        instances: n.instances,
        capacityPerInstance: n.capacityPerInstance,
        serviceTimeMs: n.serviceTimeMs,
        maxQueue: Infinity,
        horizonSec: 10,
      });
      flows.set(n.id, { st, offered, served, dropped: offered - served });
    }
    return { graph, settled: settle(topo, flows, new Map()) };
  }

  const lookAside = [
    wire("client", "svc"),
    callWire("svc", "redis", [call("reads")]),
    callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
  ];
  // The same service without a cache: every read goes to the database.
  const noCache = [wire("client", "svc"), callWire("svc", "db", [call("writes"), call("reads")])];

  it("a dead cache (every call fails, availability 0) doesn't fail the request (FLW-12)", () => {
    const { graph, settled } = settleOf(lookAside, { redis: 0 }, { redis: 0 });
    const cacheCall = graph.edges.find((e) => e.target === "redis")!.id;
    expect(settled.failure.get(cacheCall)).toBe(1);
    expect(settled.success.get("svc")).toBeCloseTo(1, 12);
    expect(settled.success.get("client")).toBeCloseTo(1, 12);
    // availability as if the cache weren't there and every read hit the database
    const without = settleOf(noCache, {}).settled;
    expect(settled.avail.get("svc")).toBeCloseTo(without.avail.get("svc")!, 12);
    expect(settled.avail.get("client")).toBeCloseTo(without.avail.get("client")!, 12);
  });

  it("the call after a miss still fails the request when the database fails", () => {
    const { settled } = settleOf(lookAside, { db: 0 });
    // writes always reach the db; reads only on a miss
    expect(settled.success.get("svc")!).toBeLessThan(1);
    expect(settled.success.get("svc")!).toBeGreaterThan(0);
    const allReads = settleOf(lookAside, { db: 0, redis: 0 }).settled;
    expect(allReads.success.get("svc")!).toBeLessThan(settled.success.get("svc")!);
  });

  it("every number stays finite and within [0, 1]", () => {
    for (const redis of [0, 0.3, 1]) {
      for (const db of [0, 0.5, 1]) {
        const { settled } = settleOf(lookAside, { redis, db }, { redis: redis, db: db });
        for (const m of [settled.success, settled.failure, settled.avail]) {
          for (const v of m.values()) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("analyze(): reads after a cache miss (request-flow)", () => {
  const RPS = 10_000;
  const config = { readRatio: 0.9 };
  const nodes = [
    comp("client", "client"),
    comp("svc", "app-server", { instances: 10 }),
    comp("redis", "cache", { hitRate: 0.9, instances: 2, capacityPerInstance: 50_000 }),
    comp("db", "sql-db", { instances: 4, capacityPerInstance: 5000 }),
  ];
  const lookAside = [
    wire("client", "svc"),
    callWire("svc", "redis", [call("reads")]),
    callWire("svc", "db", [call("writes"), call("after_miss", { missOf: "redis" })]),
  ];
  const graph = compileGraph(nodes, lookAside);

  it("the database gets the writes plus the reads that missed: 1,900 req/s at 10k (FLW-09)", () => {
    const s = analyze(graph, RPS, config);
    expect(byId(s, "db").offeredRps / 1900).toBeCloseTo(1, 6);
    expect(edgeOf(s, "svc", "db").rps / 1900).toBeCloseTo(1, 6);
    // the same load as the read-through model it replaces
    const readThrough = analyze(
      compileGraph(nodes, [
        wire("client", "svc"),
        wire("svc", "redis", { rule: { kind: "reads" } }),
        wire("redis", "db", { rule: { kind: "on_miss" } }),
        wire("svc", "db", { rule: { kind: "writes" } }),
      ]),
      RPS,
      config,
    );
    expect(byId(s, "db").offeredRps).toBeCloseTo(byId(readThrough, "db").offeredRps, 6);
  });

  it("with the cache killed, every read goes to the database and no request fails for it (FLW-12, FLW-13)", () => {
    const r = analyzeUnderFault(
      graph,
      RPS,
      { type: "kill-node", target: { kind: "node", id: "redis" } },
      config,
    );
    if (!r.ok) throw new Error(r.error);
    const s = r.steady;
    expect(byId(s, "redis").servedRps).toBe(0);
    expect(edgeOf(s, "svc", "redis").failureRate).toBe(1);
    expect(byId(s, "db").offeredRps / RPS).toBeCloseTo(1, 6);
    expect(s.errorRate).toBeCloseTo(0, 9);
    expect(s.throughputRps / RPS).toBeCloseTo(1, 9);
    // availability as if the design had no cache and read the database every time
    const noCache = analyze(
      compileGraph(nodes, [
        wire("client", "svc"),
        callWire("svc", "db", [call("writes"), call("reads")]),
      ]),
      RPS,
      config,
    );
    expect(s.availability).toBeCloseTo(noCache.availability, 12);
    expect(s.warnings).not.toContain("Retry load did not fully settle; figures are approximate.");
  });

  it("keeps the Spec 04 invariants: deterministic, served ≤ offered, every number finite (FLW-16)", () => {
    const a = analyze(compileGraph(nodes, lookAside), RPS, { ...config, seed: 5 });
    const b = analyze(compileGraph(nodes, lookAside), RPS, { ...config, seed: 5 });
    expect(a).toEqual(b);
    for (const s of [a, analyze(graph, RPS * 20, config)]) {
      expect(s.throughputRps).toBeLessThanOrEqual(s.offeredRps);
      for (const n of s.nodes) {
        expect(n.servedRps).toBeLessThanOrEqual(n.offeredRps);
        for (const v of [n.offeredRps, n.servedRps, n.utilization, n.p99Ms, n.queueDepth]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
      for (const e of s.edges) expect(Number.isFinite(e.rps)).toBe(true);
      for (const v of [s.availability, s.errorRate, s.latency.p99Ms, s.goodputRps]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe("determinism and the engine contract", () => {
  const nodes = [
    comp("lb", "load-balancer"),
    comp("app", "app-server", { instances: 3, maxRetries: 1 }),
    comp("cache", "cache"),
    comp("db", "sql-db"),
  ];
  const edges = [wire("lb", "app"), wire("app", "cache"), wire("cache", "db")];

  it("same seed → identical result (deep equal)", () => {
    const g1 = compileGraph(nodes, edges);
    const g2 = compileGraph(nodes, edges);
    expect(analyze(g1, 12_000, { seed: 7 })).toEqual(analyze(g2, 12_000, { seed: 7 }));
  });

  it("Engine: load + analyze; inject rejects a fault that can't apply", () => {
    const engine = createEngine();
    expect(() => engine.analyze(1)).toThrow();
    engine.load(compileGraph(nodes, edges), { seed: 3 });
    expect(engine.analyze(5000)).toEqual(analyze(compileGraph(nodes, edges), 5000, { seed: 3 }));
    expect(() =>
      engine.inject({ type: "kill-node", target: { kind: "node", id: "nope" } }),
    ).toThrow(FaultError);
    expect(typeof engine.onTick(() => {})).toBe("function");
  });

  it("client falls back to in-thread analysis without Worker and maps to SimulationResult", async () => {
    const { steady, result } = await simulateCanvas([...nodes, text("t")], edges, 8000, {
      seed: 1,
    });
    expect(steady).toEqual(analyze(compileGraph(nodes, edges), 8000, { seed: 1 }));
    expect(result.nodeMetrics).toBeInstanceOf(Map);
    expect(result.nodeMetrics.size).toBe(4);
    expect(result.throughput).toBe(steady.throughputRps);
    expect(result.nodeMetrics.get("app")!.incomingQPS).toBeCloseTo(8000, 6);
  });
});
