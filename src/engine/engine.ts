import type { SimGraph } from "@/domain/graph/compile";
import { analyze } from "./analyze";
import type {
  Engine,
  FaultId,
  FaultSpec,
  SimConfig,
  SteadyState,
  TickSnapshot,
  TrafficPattern,
  Unsubscribe,
} from "./types";

export class NotImplementedYetError extends Error {
  constructor(method: string, where: string) {
    super(`Engine.${method}() is not implemented yet (${where}).`);
    this.name = "NotImplementedYetError";
  }
}

const TICK_LOOP = "Spec 04 Phase 2: tick loop";
const CHAOS = "Spec 08: chaos engineering";

/**
 * Phase 1 engine: `load` + `analyze`. The time-stepped methods are part of
 * the contract but throw until Phase 2 (tick loop) / Spec 08 (faults).
 * `reset` clears the loaded graph; `onTick` never fires yet.
 */
export class FlowEngine implements Engine {
  private graph: SimGraph | null = null;
  private config: SimConfig = {};

  load(graph: SimGraph, config?: SimConfig): void {
    this.graph = graph;
    this.config = { ...config };
  }

  analyze(rps: number): SteadyState {
    if (!this.graph) throw new Error("Engine.analyze() called before load().");
    return analyze(this.graph, rps, this.config);
  }

  /** Stateless one-shot: load + analyze without keeping the graph (safe for concurrent callers). */
  analyzeGraph(graph: SimGraph, rps: number, config?: SimConfig): SteadyState {
    return analyze(graph, rps, config);
  }

  reset(): void {
    this.graph = null;
    this.config = {};
  }

  play(): void {
    throw new NotImplementedYetError("play", TICK_LOOP);
  }

  pause(): void {
    throw new NotImplementedYetError("pause", TICK_LOOP);
  }

  setSpeed(_x: 1 | 5 | 20): void {
    throw new NotImplementedYetError("setSpeed", TICK_LOOP);
  }

  setTraffic(_p: TrafficPattern): void {
    throw new NotImplementedYetError("setTraffic", `${TICK_LOOP} / Spec 06`);
  }

  inject(_fault: FaultSpec): FaultId {
    throw new NotImplementedYetError("inject", CHAOS);
  }

  heal(_id: FaultId): void {
    throw new NotImplementedYetError("heal", CHAOS);
  }

  onTick(_cb: (s: TickSnapshot) => void): Unsubscribe {
    // No ticks until Phase 2; subscribing is harmless.
    return () => {};
  }
}

export function createEngine(): FlowEngine {
  return new FlowEngine();
}
