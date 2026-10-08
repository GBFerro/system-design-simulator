import { afterAll, describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { GRAPH_RELOAD_DEBOUNCE_MS, SimController, traceCanvas } from "@/engine/client";
import { NO_ENTRY_WARNING } from "@/engine/constants";
import { buildReferenceGraph } from "@/lib/loadReference";
import { useCanvasStore } from "@/store/canvasStore";
import { useChaosStore } from "@/store/chaosStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { comp, wire } from "./engineFixtures";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rt = () => useRuntimeStore.getState();

// No Worker in Node: the controller runs the same session in-thread.
describe("SimController (in-thread fallback)", () => {
  const controller = new SimController();
  afterAll(async () => {
    await controller.reset();
    controller.dispose();
  });

  const nodes = [
    comp("lb", "load-balancer"),
    comp("app", "app-server", { instances: 2, capacityPerInstance: 1000 }),
  ];
  const edges = [wire("lb", "app")];

  it("play streams snapshots into runtimeStore and mirrors playback/speed/pattern", async () => {
    useCanvasStore.setState({ nodes, edges });
    rt().clear();
    controller.setSpeed(20);
    controller.setTraffic({ kind: "constant", rps: 500 });
    expect(await controller.play(nodes, edges)).toBe(true);
    expect(rt().playback).toBe("running");
    await wait(400);
    const latest = rt().latest!;
    expect(latest).not.toBeNull();
    expect(latest.t).toBeGreaterThan(1);
    expect(rt().simTimeSec).toBe(latest.t);
    expect(Object.keys(latest.nodes).sort()).toEqual(["app", "lb"]);
    expect(latest.nodes.app.rpsIn).toBeGreaterThan(0);
    // throttled to ~10 Hz: far fewer frames than ticks
    expect(rt().history.size).toBeLessThan(latest.t / 0.05);
    expect(rt().history.size).toBeGreaterThan(0);
  });

  it("applies canvas edits live (debounced) without rewinding the clock", async () => {
    const before = rt().simTimeSec;
    useCanvasStore.setState({
      nodes: [...nodes, comp("db", "nosql-db")],
      edges: [...edges, wire("app", "db")],
    });
    await wait(GRAPH_RELOAD_DEBOUNCE_MS + 300);
    const latest = rt().latest!;
    expect(latest.nodes.db).toBeDefined();
    expect(latest.nodes.db.rpsIn).toBeGreaterThan(0);
    expect(latest.t).toBeGreaterThan(before);
  });

  it("pause freezes the clock; reset clears the store and rewinds", async () => {
    await controller.pause();
    expect(rt().playback).toBe("paused");
    await wait(50);
    const t = rt().simTimeSec;
    await wait(300);
    expect(rt().simTimeSec).toBe(t);

    await controller.reset();
    expect(rt().playback).toBe("idle");
    expect(rt().latest).toBeNull();
    expect(rt().simTimeSec).toBe(0);
    expect(rt().speed).toBe(20); // kept
    await wait(200);
    expect(rt().latest).toBeNull(); // no stale frames after reset

    await controller.play(useCanvasStore.getState().nodes, useCanvasStore.getState().edges);
    await wait(300);
    expect(rt().simTimeSec).toBeGreaterThan(0);
    expect(rt().simTimeSec).toBeLessThan(t + 10);
  });

  it("an external runtimeStore.clear() stops the run", async () => {
    rt().clear();
    expect(controller.playback).toBe("idle");
    await wait(200);
    expect(rt().latest).toBeNull();
  });

  it("refuses to play an empty canvas", async () => {
    expect(await controller.play([], [])).toBe(false);
    expect(rt().playback).toBe("idle");
  });
});

describe("SimController faults (Spec 08)", () => {
  const nodes = [comp("lb", "load-balancer"), comp("app", "app-server")];
  const edges = [wire("lb", "app")];

  it("a fault injected right after Play waits for the graph instead of failing", async () => {
    // Fresh controller: the backend is created by this play().
    const controller = new SimController();
    useCanvasStore.setState({ nodes, edges });
    const playing = controller.play(nodes, edges);
    expect(rt().playback).toBe("running"); // the UI already shows the run
    const result = await controller.inject({
      type: "kill-node",
      target: { kind: "node", id: "app" },
    });
    await playing;
    expect(result.ok).toBe(true);
    expect(useChaosStore.getState().faults).toEqual([
      expect.objectContaining({ active: true, label: "Kill node · app" }),
    ]);
    await controller.reset();
    expect(useChaosStore.getState().faults).toEqual([]);
    controller.dispose();
  });

  it("without a run, inject reports why", async () => {
    const controller = new SimController();
    const r = await controller.inject({ type: "kill-node", target: { kind: "node", id: "app" } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Play/) });
    controller.dispose();
  });
});

// No Worker in Node: the trace runs in-thread with the same code (request-flow, T27).
describe("traceCanvas (in-thread fallback)", () => {
  const reference = buildReferenceGraph(PROBLEMS.find((p) => p.id === "url-shortener")!);
  const byComponent = (id: string) => reference.nodes.find((n) => n.data.componentId === id)!.id;
  const app = byComponent("app-server");
  const cache = byComponent("cache");
  const db = byComponent("nosql-db");
  const monitoring = byComponent("monitoring");

  it("traces a read of the URL Shortener reference: same index, same trace", async () => {
    const a = await traceCanvas(reference.nodes, reference.edges, { cls: "read", index: 2 });
    const b = await traceCanvas(reference.nodes, reference.edges, { cls: "read", index: 2 });
    expect(a).toEqual(b);
    expect(a.cls).toBe("read");
    expect(a.ok).toBe(true);
    expect(a.totalMs).toBeGreaterThan(0);
    // entry first (DNS → load balancer), then the app reaches its cache
    expect(a.events[0]).toMatchObject({ type: "call", from: byComponent("dns") });
    expect(a.events).toContainEqual(
      expect.objectContaining({ type: "call", from: app, to: cache }),
    );
    // monitoring is async: an event without a response
    const mon = a.events.find((e) => e.type !== "cache" && e.to === monitoring)!;
    expect(mon.type).toBe("async");
    expect("t1" in mon).toBe(false);
  });

  it("a miss goes on to the database, a hit doesn't (across the sequence of requests)", async () => {
    const traces = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        traceCanvas(reference.nodes, reference.edges, { cls: "read", index }),
      ),
    );
    type Traced = (typeof traces)[number];
    const cacheHit = (t: Traced) => {
      const e = t.events.find((ev) => ev.type === "cache" && ev.nodeId === cache);
      return e?.type === "cache" ? e.hit : undefined;
    };
    const cacheIndex = (t: Traced) => t.events.findIndex((e) => e.type === "cache");
    const dbCall = (t: Traced) =>
      t.events.findIndex((e) => e.type === "call" && e.from === app && e.to === db);
    const miss = traces.find((t) => cacheHit(t) === false)!;
    const hit = traces.find((t) => cacheHit(t) === true)!;
    expect(miss).toBeDefined();
    expect(hit).toBeDefined();
    expect(dbCall(miss)).toBeGreaterThan(cacheIndex(miss));
    expect(dbCall(hit)).toBe(-1);
  });

  it("carries the run's faults to the trace: with the cache killed, reads go to the database (FLW-50)", async () => {
    const options = { cls: "read" as const, index: 0 };
    const healthy = await traceCanvas(reference.nodes, reference.edges, options);
    const down = await traceCanvas(reference.nodes, reference.edges, {
      ...options,
      faults: [{ type: "kill-node", target: { kind: "node", id: cache } }],
    });
    const dbCalls = (t: typeof down) =>
      t.events.filter((e) => e.type === "call" && e.from === app && e.to === db);
    expect(healthy.events).toContainEqual(
      expect.objectContaining({ type: "cache", nodeId: cache, hit: true }),
    );
    expect(dbCalls(healthy)).toHaveLength(0);
    expect(down.events).toContainEqual(
      expect.objectContaining({ type: "call", from: app, to: cache, ok: false }),
    );
    expect(dbCalls(down)).toHaveLength(1);
  });

  it("without a snapshot's load the trace runs at 1 req/s", async () => {
    const options = { cls: "write" as const, index: 0 };
    expect(await traceCanvas(reference.nodes, reference.edges, options)).toEqual(
      await traceCanvas(reference.nodes, reference.edges, { ...options, rps: 1 }),
    );
  });

  it("traces at the requested load: near saturation 95 req/s takes longer than 1 req/s (FLW-36)", async () => {
    // client → app: 100 req/s (5 slots of 50 ms); at 95 req/s requests queue.
    const nodes = [
      comp("client", "client"),
      comp("app", "app-server", {
        instances: 1,
        capacityPerInstance: 100,
        serviceTimeMs: 50,
        timeoutMs: 60_000,
        maxRetries: 0,
      }),
    ];
    const edges = [wire("client", "app")];
    const meanTotal = async (rps: number) => {
      const traces = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          traceCanvas(nodes, edges, { rps, cls: "read", index }),
        ),
      );
      for (const t of traces) expect(t.ok).toBe(true);
      return traces.reduce((sum, t) => sum + t.totalMs, 0) / traces.length;
    };
    expect(await meanTotal(95)).toBeGreaterThan((await meanTotal(1)) * 2);
  });

  it("no entry point: no events and the warning (FLW-40)", async () => {
    const cycle = [comp("a", "app-server"), comp("b", "app-server")];
    for (const [nodes, edges] of [
      [cycle, [wire("a", "b"), wire("b", "a")]],
      [[comp("lone", "app-server")], []],
      [[], []],
    ] as const) {
      const trace = await traceCanvas(nodes, edges, { cls: "read", index: 0 });
      expect(trace.events).toEqual([]);
      expect(trace.ok).toBe(false);
      expect(trace.warnings).toContain(NO_ENTRY_WARNING);
    }
  });
});
