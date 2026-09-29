/**
 * Main-thread client for the engine worker (Spec 04).
 *
 * The worker is created lazily on the first call, so neither it nor Comlink
 * is part of the initial bundle (app-shell imports this module with a dynamic
 * `import()`). Where there's no `Worker` (SSR, Vitest/Node) or the worker
 * fails to start, analysis runs in-thread with the exact same code.
 *
 * The live tick loop (Spec 04 Phase 2 / Spec 06) goes through
 * `getSimController()`, which streams frames from the same worker into
 * `runtimeStore`.
 */
import { proxy, wrap, type Remote } from "comlink";
import { compileGraph } from "@/domain/graph/compile";
import { useCanvasStore } from "@/store/canvasStore";
import { useChaosStore } from "@/store/chaosStore";
import { useRuntimeStore, type PlaybackStatus } from "@/store/runtimeStore";
import type { SimulationResult } from "@/types/simulation";
import type { FrameListener, InjectResult, SimFrame } from "./session";
import { toSimulationResult } from "./toSimulationResult";
import type {
  FaultId,
  FaultRecord,
  FaultSpec,
  SimConfig,
  SimGraph,
  SimSpeed,
  SteadyState,
  TrafficPattern,
} from "./types";
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
 * it. Returns the raw steady state, the legacy `SimulationResult` view and the
 * compiled graph (its params feed the OBS-03 extras of the runtime snapshot).
 */
export async function simulateCanvas(
  nodes: readonly unknown[],
  edges: readonly unknown[],
  rps: number,
  config?: SimConfig,
): Promise<{ steady: SteadyState; result: SimulationResult; graph: SimGraph }> {
  const graph = compileGraph(nodes, edges);
  const steady = await analyzeGraph(graph, rps, config);
  return { steady, result: toSimulationResult(steady), graph };
}

/* ---------- live tick loop (Spec 04 Phase 2 / Spec 06) ---------- */

type MaybePromise = Promise<void> | void;

/** Where the session runs: the worker (Comlink) or this thread (fallback). */
interface SimBackend {
  load(graph: SimGraph, config?: SimConfig): MaybePromise;
  play(): MaybePromise;
  pause(): MaybePromise;
  reset(generation: number): MaybePromise;
  setSpeed(x: SimSpeed): MaybePromise;
  setTraffic(p: TrafficPattern): MaybePromise;
  inject(fault: FaultSpec): InjectResult | Promise<InjectResult>;
  heal(id: FaultId): FaultState | Promise<FaultState>;
  subscribe(listener: FrameListener): MaybePromise;
}

interface FaultState {
  faults: FaultRecord[];
  faultVersion: number;
}

function workerBackend(h: WorkerHandle): SimBackend {
  return {
    load: (graph, config) => h.api.simLoad(graph, config),
    play: () => h.api.simPlay(),
    pause: () => h.api.simPause(),
    reset: (gen) => h.api.simReset(gen),
    setSpeed: (x) => h.api.simSetSpeed(x),
    setTraffic: (p) => h.api.simSetTraffic(p),
    inject: (fault) => h.api.simInject(fault),
    heal: (id) => h.api.simHeal(id),
    subscribe: (listener) => h.api.simSubscribe(proxy(listener)),
  };
}

async function localBackend(): Promise<SimBackend> {
  const { createSimSession } = await import("./session");
  return createSimSession();
}

/** Debounce for reloading the graph after canvas edits during a run. */
export const GRAPH_RELOAD_DEBOUNCE_MS = 250;

/**
 * Drives the live simulation and mirrors it into `runtimeStore`: `playback`,
 * `speed`, `pattern`, the clock (`simTimeSec`/`patternTimeSec`) and every
 * received snapshot (`pushSnapshot`, at ≤ UI_SNAPSHOT_HZ).
 *
 * Graph edits while running or paused apply live: the canvas is recompiled
 * (debounced) and, if the `SimGraph` changed, hot-swapped into the engine —
 * the clock keeps going and surviving nodes keep their backlog, so "add an
 * instance during the spike" shows its effect right away. Switching canvas
 * tabs resets the run, and so does an external `runtimeStore.clear()`
 * (playback → idle).
 *
 * Faults (Spec 08) go through `inject`/`heal` while a run exists (running or
 * paused) and are mirrored into `chaosStore`; a reset clears them.
 */
export class SimController {
  private backend: SimBackend | null = null;
  private backendReady: Promise<SimBackend> | null = null;
  private generation = 0;
  private status: PlaybackStatus = "idle";
  private graphKey = "";
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubCanvas: (() => void) | null = null;
  private readonly unsubRuntime: () => void;

  constructor() {
    this.unsubRuntime = useRuntimeStore.subscribe((s, prev) => {
      if (s.playback === "idle" && prev.playback !== "idle" && this.status !== "idle") {
        void this.reset({ clearStore: false });
      }
    });
  }

  get playback(): PlaybackStatus {
    return this.status;
  }

  /** Compile the canvas and start (or resume) the run. False when there is nothing to run. */
  async play(nodes: readonly unknown[], edges: readonly unknown[]): Promise<boolean> {
    const graph = compileGraph(nodes, edges);
    if (graph.nodes.length === 0) return false;
    if (this.status === "running") return true;
    this.status = "running";
    useRuntimeStore.getState().setPlayback("running");
    const backend = await this.getBackend();
    const key = JSON.stringify(graph);
    if (key !== this.graphKey) {
      this.graphKey = key;
      await backend.load(graph);
    }
    const { speed, pattern } = useRuntimeStore.getState();
    await backend.setSpeed(speed);
    await backend.setTraffic(pattern);
    if (this.status !== "running") return true; // paused or reset meanwhile
    await backend.play();
    this.watchCanvas();
    return true;
  }

  async pause(): Promise<void> {
    if (this.status !== "running") return;
    this.status = "paused";
    useRuntimeStore.getState().setPlayback("paused");
    await this.backend?.pause();
  }

  /** Back to t = 0 and an empty `runtimeStore` (keeps speed and pattern). */
  async reset(opts: { clearStore?: boolean } = {}): Promise<void> {
    this.status = "idle";
    this.generation++;
    this.stopWatchingCanvas();
    if (opts.clearStore !== false) useRuntimeStore.getState().clear();
    useChaosStore.getState().clear();
    await this.backend?.reset(this.generation);
  }

  /** Start a fault in the current run. Fails (with a message) when no run is loaded. */
  async inject(fault: FaultSpec): Promise<InjectResult> {
    if (this.status === "idle" || !this.backend) {
      return { ok: false, error: "Play the simulation first: faults act on a live run." };
    }
    const generation = this.generation;
    const result = await this.backend.inject(fault);
    if (result.ok && generation === this.generation) {
      useChaosStore.getState().setFaults(result.faults, result.faultVersion);
    }
    return result;
  }

  async heal(id: FaultId): Promise<void> {
    if (this.status === "idle" || !this.backend) return;
    const generation = this.generation;
    const { faults, faultVersion } = await this.backend.heal(id);
    if (generation === this.generation) useChaosStore.getState().setFaults(faults, faultVersion);
  }

  setSpeed(x: SimSpeed): void {
    useRuntimeStore.getState().setSpeed(x);
    void this.backend?.setSpeed(x);
  }

  /** Live: the engine applies it on its next tick. */
  setTraffic(p: TrafficPattern): void {
    useRuntimeStore.getState().setPattern(p);
    void this.backend?.setTraffic(p);
  }

  dispose(): void {
    this.stopWatchingCanvas();
    this.unsubRuntime();
  }

  private onFrame = (frame: SimFrame): void => {
    // Frames of a previous run (sent before a reset reached the worker) are stale.
    if (frame.generation !== this.generation || this.status === "idle") return;
    const store = useRuntimeStore.getState();
    store.pushSnapshot(frame.snapshot);
    store.setClock(frame.snapshot.t, frame.patternTimeSec);
    if (frame.faults) useChaosStore.getState().setFaults(frame.faults, frame.faultVersion);
  };

  private getBackend(): Promise<SimBackend> {
    if (this.backend) return Promise.resolve(this.backend);
    this.backendReady ??= (async () => {
      let backend: SimBackend | null = null;
      const h = getWorker();
      if (h) {
        try {
          const remote = workerBackend(h);
          await Promise.race([remote.subscribe(this.onFrame), h.failed]);
          backend = remote;
        } catch (err) {
          disableWorker(err);
        }
      }
      if (!backend) {
        backend = await localBackend();
        await backend.subscribe(this.onFrame);
      }
      await backend.reset(this.generation);
      this.backend = backend;
      return backend;
    })();
    return this.backendReady;
  }

  private watchCanvas(): void {
    if (this.unsubCanvas) return;
    this.unsubCanvas = useCanvasStore.subscribe((s, prev) => {
      if (s.activeTabId !== prev.activeTabId) {
        void this.reset();
        return;
      }
      if (s.nodes === prev.nodes && s.edges === prev.edges) return;
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = null;
        void this.reloadGraph();
      }, GRAPH_RELOAD_DEBOUNCE_MS);
    });
  }

  private stopWatchingCanvas(): void {
    this.unsubCanvas?.();
    this.unsubCanvas = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  private async reloadGraph(): Promise<void> {
    if (this.status === "idle" || !this.backend) return;
    const { nodes, edges } = useCanvasStore.getState();
    const graph = compileGraph(nodes, edges);
    const key = JSON.stringify(graph);
    if (key === this.graphKey) return;
    this.graphKey = key;
    await this.backend.load(graph);
  }
}

let controller: SimController | null = null;

/** The app-wide live simulation controller (created on first use). */
export function getSimController(): SimController {
  controller ??= new SimController();
  return controller;
}
