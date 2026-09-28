/**
 * Engine Web Worker (Spec 04). The UI talks to it through Comlink
 * (`client.ts`), so simulation never blocks the main thread. Only
 * structured-clone-safe data crosses the boundary (`SimGraph`, `SteadyState`,
 * `SimFrame`); the frame listener is a Comlink `proxy`.
 */
import { expose } from "comlink";
import { createEngine } from "./engine";
import { createSimSession, type FrameListener } from "./session";
import type { SimConfig, SimGraph, SimSpeed, TrafficPattern } from "./types";

const engine = createEngine();
const session = createSimSession();

/** What the worker exposes: `analyze()` (Phase 1) and the live tick loop (Phase 2). */
export const workerApi = {
  load: engine.load.bind(engine),
  analyze: engine.analyze.bind(engine),
  analyzeGraph: engine.analyzeGraph.bind(engine),

  simLoad: (graph: SimGraph, config?: SimConfig) => session.load(graph, config),
  simPlay: () => session.play(),
  simPause: () => session.pause(),
  simReset: (generation: number) => session.reset(generation),
  simSetSpeed: (x: SimSpeed) => session.setSpeed(x),
  simSetTraffic: (p: TrafficPattern) => session.setTraffic(p),
  simSubscribe: (listener: FrameListener | null) => session.subscribe(listener),
};

export type EngineWorkerApi = typeof workerApi;

expose(workerApi);
