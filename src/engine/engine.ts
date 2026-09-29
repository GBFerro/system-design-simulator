import type { SimGraph } from "@/domain/graph/compile";
import { RingBuffer } from "@/lib/ringBuffer";
import { analyze } from "./analyze";
import { TickSimulator, type TickOptions } from "./core/tick";
import { rateAt, sanitizePattern } from "./traffic/patterns";
import { HISTORY_TICKS, SIM_SPEEDS, TICK_SEC } from "./traffic/types";
import type {
  Engine,
  FaultId,
  FaultSpec,
  SimConfig,
  SimSpeed,
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

const CHAOS = "Spec 08: chaos engineering";

export const DEFAULT_TRAFFIC: TrafficPattern = { kind: "constant", rps: 10_000 };

/** Wall-clock source + timer, injectable so tests drive the scheduler by hand. */
export interface EngineClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: EngineClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface FlowEngineOptions {
  clock?: EngineClock;
  /** Scheduler period in wall-clock ms. Default 20. */
  sliceMs?: number;
  /** Synthetic requests per tick (percentiles). Default 1000. */
  tickSamples?: number;
}

/**
 * The scheduler never spends more than this share of a slice computing ticks;
 * if the machine can't keep up with the requested speed, simulated time runs
 * slower instead of freezing the thread.
 */
const SLICE_BUDGET = 0.75;
/** Falling further behind than this re-anchors the clock (no catch-up bursts). */
const MAX_LAG_MS = 250;

function sanitizeSpeed(x: unknown): SimSpeed {
  return SIM_SPEEDS.includes(x as SimSpeed) ? (x as SimSpeed) : 1;
}

/**
 * Engine (Spec 04): `analyze()` (Phase 1) and the time-stepped loop
 * (Phase 2). `inject`/`heal` throw until Spec 08.
 *
 * Playback: `play()` runs ticks of TICK_SEC simulated seconds on a wall-clock
 * scheduler at `speed`× real time; `pause()` stops it; `reset()` rewinds to
 * t = 0 (queues emptied, PRNG reseeded, history cleared) keeping the graph,
 * speed and pattern. `setTraffic` takes effect on the next tick; the pattern's
 * clock restarts when its KIND changes (so a new spike starts from now) and
 * on reset. `load()` while a run exists hot-swaps the graph and keeps the
 * clock plus the backlogs of nodes that still exist.
 *
 * Deterministic: same graph + seed + pattern/speed calls at the same ticks →
 * bit-identical snapshots (`step()` drives it without the scheduler).
 */
export class FlowEngine implements Engine {
  private graph: SimGraph | null = null;
  private config: SimConfig = {};
  private sim: TickSimulator | null = null;
  private pattern: TrafficPattern = DEFAULT_TRAFFIC;
  private patternStart = 0;
  private speed: SimSpeed = 1;
  private timer: unknown = null;
  private anchorWall = 0;
  private anchorTick = 0;
  private readonly tickListeners = new Set<(s: TickSnapshot) => void>();
  private readonly batchListeners = new Set<(s: TickSnapshot) => void>();
  private readonly clock: EngineClock;
  private readonly sliceMs: number;
  private readonly tickOptions: Pick<TickOptions, "tickSamples">;
  /** Every tick of the run, oldest → newest (5 min simulated). */
  readonly history = new RingBuffer<TickSnapshot>(HISTORY_TICKS);

  constructor(options: FlowEngineOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.sliceMs = options.sliceMs && options.sliceMs > 0 ? options.sliceMs : 20;
    this.tickOptions = { tickSamples: options.tickSamples };
  }

  load(graph: SimGraph, config?: SimConfig): void {
    this.graph = graph;
    this.config = { ...config };
    // Hot swap: keep the clock and the state of surviving nodes. A new seed
    // or other config applies from the next reset().
    this.sim?.setGraph(graph);
  }

  analyze(rps: number): SteadyState {
    if (!this.graph) throw new Error("Engine.analyze() called before load().");
    return analyze(this.graph, rps, this.config);
  }

  /** Stateless one-shot: load + analyze without keeping the graph (safe for concurrent callers). */
  analyzeGraph(graph: SimGraph, rps: number, config?: SimConfig): SteadyState {
    return analyze(graph, rps, config);
  }

  /* ---------- playback ---------- */

  get isPlaying(): boolean {
    return this.timer !== null;
  }

  /** Simulated seconds since the last reset. */
  get time(): number {
    return this.sim?.time ?? 0;
  }

  /** Simulated seconds since the current pattern (kind) was applied. */
  get patternTime(): number {
    return Math.max(0, this.time - this.patternStart);
  }

  get currentSpeed(): SimSpeed {
    return this.speed;
  }

  get currentPattern(): TrafficPattern {
    return this.pattern;
  }

  play(): void {
    if (!this.graph) throw new Error("Engine.play() called before load().");
    if (this.timer !== null) return;
    this.ensureSim();
    this.anchor();
    this.timer = this.clock.setInterval(() => this.runSlice(), this.sliceMs);
  }

  pause(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.pause();
    this.sim = null;
    this.patternStart = 0;
    this.history.clear();
  }

  setSpeed(x: SimSpeed): void {
    this.speed = sanitizeSpeed(x);
    if (this.timer !== null) this.anchor();
  }

  setTraffic(p: TrafficPattern): void {
    const next = sanitizePattern(p);
    if (next.kind !== this.pattern.kind) this.patternStart = this.time;
    this.pattern = next;
  }

  /** λ the next tick will use. */
  currentRate(): number {
    return rateAt(this.pattern, this.patternTime);
  }

  /**
   * Run `n` ticks synchronously (no scheduler). Used by the scheduler, by
   * tests and for deterministic replays. Returns the last snapshot.
   */
  step(n = 1): TickSnapshot | null {
    if (!this.graph) throw new Error("Engine.step() called before load().");
    const sim = this.ensureSim();
    let last: TickSnapshot | null = null;
    for (let i = 0; i < n; i++) last = this.tickOnce(sim);
    if (last) for (const cb of this.batchListeners) cb(last);
    return last;
  }

  onTick(cb: (s: TickSnapshot) => void): Unsubscribe {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
  }

  /** Called once per scheduler slice (and per `step()`) with its last snapshot. */
  onBatch(cb: (s: TickSnapshot) => void): Unsubscribe {
    this.batchListeners.add(cb);
    return () => this.batchListeners.delete(cb);
  }

  inject(_fault: FaultSpec): FaultId {
    throw new NotImplementedYetError("inject", CHAOS);
  }

  heal(_id: FaultId): void {
    throw new NotImplementedYetError("heal", CHAOS);
  }

  /* ---------- internals ---------- */

  private ensureSim(): TickSimulator {
    if (!this.sim)
      this.sim = new TickSimulator(this.graph!, { ...this.config, ...this.tickOptions });
    return this.sim;
  }

  private tickOnce(sim: TickSimulator): TickSnapshot {
    const snap = sim.step(rateAt(this.pattern, Math.max(0, sim.time - this.patternStart)));
    this.history.push(snap);
    for (const cb of this.tickListeners) cb(snap);
    return snap;
  }

  private anchor(): void {
    this.anchorWall = this.clock.now();
    this.anchorTick = this.sim?.tickCount ?? 0;
  }

  private runSlice(): void {
    const sim = this.sim;
    if (!sim) return;
    const started = this.clock.now();
    const elapsedSec = (started - this.anchorWall) / 1000;
    const due = this.anchorTick + Math.floor((elapsedSec * this.speed) / TICK_SEC + 1e-9);
    const budgetMs = this.sliceMs * SLICE_BUDGET;
    // Never more than one slice + the allowed lag worth of ticks in one go.
    const maxTicks = Math.ceil(((this.sliceMs + MAX_LAG_MS) / 1000) * (this.speed / TICK_SEC));
    const stop = Math.min(due, sim.tickCount + maxTicks);
    let last: TickSnapshot | null = null;
    try {
      while (sim.tickCount < stop) {
        last = this.tickOnce(sim);
        if (this.clock.now() - started > budgetMs) break;
      }
    } catch (err) {
      console.error("Simulation tick failed; pausing.", err);
      this.pause();
    }
    // Too far behind (slow machine, background throttling): drop the debt.
    const behindTicks = due - sim.tickCount;
    if ((behindTicks * TICK_SEC * 1000) / this.speed > MAX_LAG_MS) this.anchor();
    if (last) for (const cb of this.batchListeners) cb(last);
  }
}

export function createEngine(options?: FlowEngineOptions): FlowEngine {
  return new FlowEngine(options);
}
