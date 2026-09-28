import { afterAll, describe, expect, it } from "vitest";
import { GRAPH_RELOAD_DEBOUNCE_MS, SimController } from "@/engine/client";
import { useCanvasStore } from "@/store/canvasStore";
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
