/**
 * Main-thread client for the engine worker (Spec 04).
 *
 * The worker is created lazily on the first call, so neither it nor Comlink
 * is part of the initial bundle (app-shell imports this module with a dynamic
 * `import()`). Where there's no `Worker` (SSR, Vitest/Node) or the worker
 * fails to start, analysis runs in-thread with the exact same code.
 */
import { wrap, type Remote } from "comlink";
import { compileGraph } from "@/domain/graph/compile";
import type { SimulationResult } from "@/types/simulation";
import { toSimulationResult } from "./toSimulationResult";
import type { SimConfig, SimGraph, SteadyState } from "./types";
import type { EngineWorkerApi } from "./worker";

interface WorkerHandle {
  api: Remote<EngineWorkerApi>;
  worker: Worker;
  /** Rejects if the worker script fails to load or crashes. */
  failed: Promise<never>;
}

let handle: WorkerHandle | null = null;
let workerUnavailable = false;

function getWorker(): WorkerHandle | null {
  if (workerUnavailable) return null;
  if (handle) return handle;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    workerUnavailable = true;
    return null;
  }
  try {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "systemforge-engine",
    });
    const failed = new Promise<never>((_, reject) => {
      worker.addEventListener("error", (ev) =>
        reject(new Error(ev.message || "Engine worker failed to start")),
      );
      worker.addEventListener("messageerror", () =>
        reject(new Error("Engine worker could not decode a message")),
      );
    });
    failed.catch(() => {}); // observed per call below; avoid unhandled rejections
    handle = { api: wrap<EngineWorkerApi>(worker), worker, failed };
    return handle;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function disableWorker(reason: unknown): void {
  console.warn("Simulation worker unavailable, running in the main thread instead.", reason);
  handle?.worker.terminate();
  handle = null;
  workerUnavailable = true;
}

/** Steady state of a compiled graph — in the worker when possible. */
export async function analyzeGraph(
  graph: SimGraph,
  rps: number,
  config?: SimConfig,
): Promise<SteadyState> {
  const h = getWorker();
  if (h) {
    try {
      return await Promise.race([h.api.analyzeGraph(graph, rps, config), h.failed]);
    } catch (err) {
      disableWorker(err);
    }
  }
  const { analyze } = await import("./analyze");
  return analyze(graph, rps, config);
}

/**
 * Compile the canvas (ReactFlow nodes/edges, text nodes included) and analyze
 * it. Returns the raw steady state plus the legacy `SimulationResult` view.
 */
export async function simulateCanvas(
  nodes: readonly unknown[],
  edges: readonly unknown[],
  rps: number,
  config?: SimConfig,
): Promise<{ steady: SteadyState; result: SimulationResult }> {
  const graph = compileGraph(nodes, edges);
  const steady = await analyzeGraph(graph, rps, config);
  return { steady, result: toSimulationResult(steady) };
}
