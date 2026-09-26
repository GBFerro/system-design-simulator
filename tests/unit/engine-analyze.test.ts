import { describe, expect, it } from "vitest";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { retryAmplification } from "@/engine/core/queueing";
import { simulateCanvas } from "@/engine/client";
import { createEngine, NotImplementedYetError } from "@/engine/engine";
import type { SteadyState } from "@/engine/types";
import { comp, text, wire } from "./engineFixtures";

const byId = (s: SteadyState, id: string) => s.nodes.find((n) => n.nodeId === id)!;
const edgeOf = (s: SteadyState, source: string, target: string) =>
  s.edges.find((e) => e.source === source && e.target === target)!;

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

  it("sanitizes params: garbage falls back to schema defaults, legacy fields still read", () => {
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
    const old = graph.nodes.find((n) => n.id === "old")!;
    expect([old.instances, old.capacityPerInstance, old.serviceTimeMs]).toEqual([2, 777, 3]);
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

  it("Engine: load + analyze; the tick loop and faults are not in Phase 1", () => {
    const engine = createEngine();
    expect(() => engine.analyze(1)).toThrow();
    engine.load(compileGraph(nodes, edges), { seed: 3 });
    expect(engine.analyze(5000)).toEqual(analyze(compileGraph(nodes, edges), 5000, { seed: 3 }));
    expect(() => engine.play()).toThrow(NotImplementedYetError);
    expect(() => engine.inject({ kind: "kill" })).toThrow(/Spec 08/);
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
