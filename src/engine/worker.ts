/**
 * Engine Web Worker (Spec 04). The UI talks to it through Comlink
 * (`client.ts`), so simulation never blocks the main thread. Only
 * structured-clone-safe data crosses the boundary (`SimGraph`, `SteadyState`,
 * `SimFrame`); the frame listener is a Comlink `proxy`.
 */
import { expose } from "comlink";
import { createEngine } from "./engine";
import { analyzeUnderFault } from "./faults/steady";
import { createSimSession, type FrameListener } from "./session";
import type { FaultId, FaultSpec, SimConfig, SimGraph, SimSpeed, TrafficPattern } from "./types";

const engine = createEngine();
const session = createSimSession();

/** What the worker exposes: `analyze()` (Phase 1), the live tick loop (Phase 2) and faults (Spec 08). */
export const workerApi = {
  load: engine.load.bind(engine),
  analyze: engine.analyze.bind(engine),
  analyzeGraph: engine.analyzeGraph.bind(engine),
  analyzeUnderFault: (graph: SimGraph, rps: number, fault: FaultSpec, config?: SimConfig) =>
    analyzeUnderFault(graph, rps, fault, config),

  simLoad: (graph: SimGraph, config?: SimConfig) => session.load(graph, config),
  simPlay: () => session.play(),
  simPause: () => session.pause(),
  simReset: (generation: number) => session.reset(generation),
  simSetSpeed: (x: SimSpeed) => session.setSpeed(x),
  simSetTraffic: (p: TrafficPattern) => session.setTraffic(p),
  simInject: (fault: FaultSpec) => session.inject(fault),
  simHeal: (id: FaultId) => session.heal(id),
  simSubscribe: (listener: FrameListener | null) => session.subscribe(listener),
};

export type EngineWorkerApi = typeof workerApi;

expose(workerApi);
