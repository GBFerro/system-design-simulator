/**
 * Faults of one run (Spec 08): what is active, when each one started and
 * ended (the timeline), the modifiers the next tick applies, and the blast
 * radius written onto each snapshot. Owned by `FlowEngine`; everything is
 * keyed to simulated time, so runs stay deterministic.
 */
import type { SimGraph } from "@/domain/graph/compile";
import { resolveConfig } from "../analyze";
import type {
  EdgeRuntimeMetrics,
  NodeRuntimeMetrics,
  RuntimeEdgeStatus,
  RuntimeNodeStatus,
  SimConfig,
  TickSnapshot,
} from "../types";
import { compileFault } from "./compile";
import { effectsAt, type TickEffects } from "./effects";
import type { CompiledModifier, FaultId, FaultRecord, FaultSpec } from "./types";

/** After the last heal, the blast radius keeps showing recovery for at most this long. */
export const BLAST_TAIL_SEC = 60;
/** A node is "affected" when its error rate exceeds the baseline by this much… */
const BLAST_ERROR_DELTA = 0.01;
/** …or its hop p99 exceeds baseline × this + BLAST_P99_SLACK_MS. */
const BLAST_P99_FACTOR = 1.5;
const BLAST_P99_SLACK_MS = 5;

export class FaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaultError";
  }
}

interface ActiveFault {
  record: FaultRecord;
  modifiers: CompiledModifier[];
}

const NODE_RANK: Record<RuntimeNodeStatus, number> = { ok: 0, warn: 1, critical: 2, down: 3 };
const EDGE_RANK: Record<RuntimeEdgeStatus, number> = { ok: 0, slow: 1, error: 2 };

function nodeDegraded(m: NodeRuntimeMetrics, base: NodeRuntimeMetrics | undefined): boolean {
  if (m.status === "down") return true;
  if (m.errorRate > (base?.errorRate ?? 0) + BLAST_ERROR_DELTA) return true;
  if (NODE_RANK[m.status] > NODE_RANK[base?.status ?? "ok"]) return true;
  return (
    base !== undefined && base.rpsIn > 0 && m.p99 > base.p99 * BLAST_P99_FACTOR + BLAST_P99_SLACK_MS
  );
}

function edgeDegraded(m: EdgeRuntimeMetrics, base: EdgeRuntimeMetrics | undefined): boolean {
  return EDGE_RANK[m.status] > EDGE_RANK[base?.status ?? "ok"];
}

export class FaultRunner {
  private active: ActiveFault[] = [];
  private log: FaultRecord[] = [];
  private seq = 0;
  private modifiers: CompiledModifier[] = [];
  private baseline: TickSnapshot | null = null;
  /** Blast radius is drawn while faults are active and until this time after the last heal. */
  private blastUntil: number | null = null;
  private versionN = 0;

  /** Bumped on every inject/heal (manual or automatic). */
  get version(): number {
    return this.versionN;
  }

  get hasActive(): boolean {
    return this.active.length > 0;
  }

  /** Every fault of the run, oldest first (copies). */
  records(): FaultRecord[] {
    return this.log.map((r) => ({ ...r, notes: [...r.notes] }));
  }

  /**
   * Compile and activate a fault at simulated time `t`. `last` is the newest
   * snapshot, the baseline the blast radius compares against when no other
   * fault is in effect. Throws `FaultError` when the spec can't apply.
   */
  inject(
    spec: FaultSpec,
    t: number,
    graph: SimGraph,
    config: SimConfig,
    last: TickSnapshot | undefined,
  ): FaultId {
    const compiled = compileFault(spec, t, { graph, readRatio: readRatioOf(graph, config) });
    if (!compiled.ok) throw new FaultError(compiled.error);
    if (this.active.length === 0 && this.blastUntil === null) this.baseline = last ?? null;
    this.blastUntil = null;
    const id = `fault-${++this.seq}`;
    const record: FaultRecord = {
      id,
      spec: compiled.spec,
      label: compiled.label,
      startT: t,
      active: true,
      notes: compiled.notes,
      ...(compiled.endT !== undefined ? { endT: compiled.endT } : {}),
    };
    this.log.push(record);
    this.active.push({ record, modifiers: compiled.modifiers });
    this.changed();
    return id;
  }

  /** End a fault now (no-op for unknown or already healed ids). */
  heal(id: FaultId, t: number): void {
    const i = this.active.findIndex((f) => f.record.id === id);
    if (i < 0) return;
    this.end(i, t);
    this.changed();
  }

  /** Auto-heal whatever is due at `t` (called before each tick). */
  expire(t: number): void {
    let changed = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const end = this.active[i].record.endT;
      if (end !== undefined && t + 1e-9 >= end) {
        this.end(i, end);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** Modifiers active at `t`, folded (null when none). */
  effects(t: number): TickEffects | null {
    return this.active.length === 0 ? null : effectsAt(this.modifiers, t);
  }

  /**
   * The graph changed during the run: recompile the active faults against it
   * (their start time is kept). A fault whose target is gone heals now.
   */
  reload(graph: SimGraph, config: SimConfig, t: number): void {
    if (this.active.length === 0) return;
    const ctx = { graph, readRatio: readRatioOf(graph, config) };
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      const compiled = compileFault(f.record.spec, f.record.startT, ctx);
      if (!compiled.ok) {
        f.record.notes = [...f.record.notes, "Healed: its target left the design."];
        this.end(i, t);
        continue;
      }
      f.modifiers = compiled.modifiers;
      f.record.label = compiled.label;
      f.record.notes = compiled.notes;
      if (compiled.endT !== undefined) f.record.endT = compiled.endT;
      else delete f.record.endT;
    }
    this.changed();
  }

  /**
   * Mark the blast radius on a fresh snapshot (mutates it: its metric
   * objects are new every tick). Targets of active faults are "target";
   * anything degraded against the baseline is "affected", and so is the
   * caller of a degraded edge (its calls fail or slow down even when its own
   * station looks fine).
   */
  annotate(snap: TickSnapshot, graph: SimGraph): void {
    if (this.active.length === 0) {
      if (this.blastUntil === null || snap.t > this.blastUntil) {
        this.baseline = null;
        this.blastUntil = null;
        return;
      }
    }
    const targetNodes = new Set<string>();
    const targetEdges = new Set<string>();
    for (const f of this.active) {
      const { kind, id } = f.record.spec.target;
      if (kind === "node" && id) targetNodes.add(id);
      else if (kind === "edge" && id) targetEdges.add(id);
    }
    const base = this.baseline;
    let affected = false;
    for (const id in snap.nodes) {
      const m = snap.nodes[id];
      if (targetNodes.has(id)) m.blast = "target";
      else if (nodeDegraded(m, base?.nodes[id])) {
        m.blast = "affected";
        affected = true;
      }
    }
    const callers = new Set<string>();
    for (const e of graph.edges) {
      const m = snap.edges[e.id];
      if (!m) continue;
      const degraded = edgeDegraded(m, base?.edges[e.id]);
      if (targetEdges.has(e.id)) m.blast = "target";
      else if (degraded) {
        m.blast = "affected";
        affected = true;
      }
      if (degraded) callers.add(e.source);
    }
    for (const id of callers) {
      const m = snap.nodes[id];
      if (m && m.blast === undefined) m.blast = "affected";
    }
    // Recovered after the last heal: stop drawing and forget the baseline.
    if (this.active.length === 0 && !affected) {
      this.baseline = null;
      this.blastUntil = null;
    }
  }

  reset(): void {
    this.active = [];
    this.log = [];
    this.seq = 0;
    this.modifiers = [];
    this.baseline = null;
    this.blastUntil = null;
    this.changed();
  }

  private end(i: number, t: number): void {
    const [f] = this.active.splice(i, 1);
    f.record.active = false;
    f.record.endT = t;
    if (this.active.length === 0) this.blastUntil = t + BLAST_TAIL_SEC;
  }

  private changed(): void {
    this.modifiers = this.active.flatMap((f) => f.modifiers);
    this.versionN++;
  }
}

function readRatioOf(graph: SimGraph, config: SimConfig): number {
  return resolveConfig(graph, new Map(graph.nodes.map((n) => [n.id, n])), config).readRatio;
}
