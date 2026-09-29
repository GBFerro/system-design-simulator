/**
 * Engine Web Worker (Spec 04). The UI talks to it through Comlink
 * (`client.ts`), so simulation never blocks the main thread. Only
 * structured-clone-safe data crosses the boundary (`SimGraph`, `SteadyState`).
 */
import { expose } from "comlink";
import { createEngine } from "./engine";

const engine = createEngine();

/** What the worker exposes: the Phase 1 surface of the engine. */
export const workerApi = {
  load: engine.load.bind(engine),
  analyze: engine.analyze.bind(engine),
  analyzeGraph: engine.analyzeGraph.bind(engine),
  reset: engine.reset.bind(engine),
};

export type EngineWorkerApi = typeof workerApi;

expose(workerApi);
