/**
 * Request balls for the flow overlay (Spec 07, OBS-04). Pure state machine:
 * the canvas layer (`components/canvas/FlowParticles`) feeds it the latest
 * snapshot, the topology and the drawn geometry, and draws what it holds.
 *
 * One ball stands for `quantum` req/s of flow: an edge carrying r req/s sees
 * r / quantum balls per second, so a 5× spike is 5× the balls. A ball is a
 * request walking the graph, so it can be followed from the entry to the end:
 *
 * - It is born at an entry node (no incoming edge with load) at that node's
 *   arrival rate.
 * - At each node it fails with the node's error/drop share (a burst marks it),
 *   else it continues:
 *   - a load balancer sends it down ONE outgoing edge, weighted by the edges' load;
 *   - any other node calls each dependency in proportion to that edge's load
 *     (the ID generator only sees writes, a DB behind a cache only the misses),
 *     cache first: the other sync calls leave only once the ball reaches the cache.
 * - Into an expanded node (one card per instance, `lib/instances.ts`) the ball
 *   takes the edge to ONE instance's card, picked like the load balancer in
 *   front would (round robin, least connections, hash of the request; weighted
 *   splits by capacity, equal within a node), skipping instances the faults took
 *   down; its calls leave from that card.
 *
 * The quantum is adaptive: a round number (1-2-5 steps) giving ~TARGET_SPAWN_PER_SEC
 * balls per second at the entries, re-picked only when the load drifts far from
 * it, so the legend doesn't flicker.
 */
import type { RoutingKind } from "@/domain/components/types";
import type { TickSnapshot } from "@/engine/types";
import { instanceEdgeId, laneOf } from "./instances";

/** Hard cap on balls alive at once, all edges together. */
export const MAX_BALLS = 2000;
/** Balls per second born at the entries (all together) the quantum aims at. */
export const TARGET_SPAWN_PER_SEC = 6;
/** Re-pick the quantum when the ideal one drifts beyond this factor. */
const QUANTUM_HYSTERESIS = 2.5;
/** Above this share of MAX_BALLS the quantum steps up (fan-outs multiply balls)… */
const CROWDED = 0.75;
/** …and below this one it may step back down. */
const SPARSE = 0.3;
/** Seconds between quantum changes driven by the ball count (it takes a path to react). */
const QUANTUM_COOLDOWN_SEC = 1.5;
/** Ball speed along an edge, flow-px per second. */
export const BALL_SPEED = 150;
/** Most copies of one ball sent down a single edge (callsPerRequest, retries). */
const MAX_CALLS_PER_EDGE = 3;
/** How long a failure burst stays on screen, seconds. */
export const BURST_SEC = 0.5;

export interface TopoEdge {
  id: string;
  source: string;
  target: string;
  async: boolean;
}

export interface FlowTopology {
  /** Outgoing edges per source node. */
  out: ReadonlyMap<string, readonly TopoEdge[]>;
  /** Incoming edges per target node. */
  in: ReadonlyMap<string, readonly TopoEdge[]>;
  byId: ReadonlyMap<string, TopoEdge>;
  routing: ReadonlyMap<string, RoutingKind>;
  /** Load balancers' split algorithm (`PARAM.lbAlgorithm`). */
  algorithm: ReadonlyMap<string, string>;
}

export function buildTopology(
  edges: readonly TopoEdge[],
  routingOf: (nodeId: string) => RoutingKind,
  algorithmOf: (nodeId: string) => string | undefined = () => undefined,
): FlowTopology {
  const out = new Map<string, TopoEdge[]>();
  const inn = new Map<string, TopoEdge[]>();
  const routing = new Map<string, RoutingKind>();
  const algorithm = new Map<string, string>();
  const byId = new Map<string, TopoEdge>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    byId.set(e.id, e);
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (inn.get(e.target) ?? inn.set(e.target, []).get(e.target)!).push(e);
    for (const id of [e.source, e.target]) {
      if (routing.has(id)) continue;
      const kind = routingOf(id);
      routing.set(id, kind);
      const algo = kind === "lb" ? algorithmOf(id) : undefined;
      if (algo) algorithm.set(id, algo);
    }
  }
  return { out, in: inn, byId, routing, algorithm };
}

/** An expanded node's instances. */
export interface InstanceLayout {
  count: number;
  /** Per instance: taken down by a fault. */
  down: readonly boolean[];
}

/** What the drawing knows: drawn edges' lengths and the expanded nodes. */
export interface FlowEnv {
  /** Length of a drawn edge (an edge, or its copy to an instance card); undefined = not drawn. */
  lengthOf: (drawnEdgeId: string) => number | undefined;
  /** Instances of an expanded node (undefined = collapsed). */
  instancesOf?: (nodeId: string) => InstanceLayout | undefined;
}

export interface Ball {
  /** The edge (as in the graph): its load and status. */
  edge: string;
  /** What is drawn for it: the edge, or its copy between instance cards. */
  drawn: string;
  /** Flow-px travelled along `drawn`. */
  pos: number;
  /** Stable per request (and its calls): the hash algorithm's key. */
  key: number;
  /** Card (lane) and instance it heads to at the target; −1 = not expanded. */
  lane: number;
  instance: number;
  /** Sync calls of the node it left, sent once it reaches its target (cache first). */
  deferred?: { node: string; lane: number; edges: readonly TopoEdge[] };
}

export interface Burst {
  /** The drawn edge whose end marks where the request failed. */
  edge: string;
  age: number;
}

/** 1, 2, 5, 10, 20, 50… the smallest step ≥ x (at least 1). */
export function niceStep(x: number): number {
  if (!(x > 1)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

/** The 1-2-5 step below `q` (at least 1). */
function stepDown(q: number): number {
  if (!(q > 1)) return 1;
  const p = 10 ** Math.floor(Math.log10(q) + 1e-9);
  const m = Math.round(q / p);
  return Math.max(1, m >= 5 ? 2 * p : m >= 2 ? p : p / 2);
}

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);

/** Integer hash (xorshift-multiply) for the hash algorithm. */
function mix(key: number): number {
  let h = key | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export class FlowBalls {
  balls: Ball[] = [];
  bursts: Burst[] = [];
  /** req/s per ball. */
  quantum = 1;
  /** Fractional balls owed per entry node (carried between frames). */
  private owed = new Map<string, number>();
  private cooldown = 0;
  /** Round-robin position per node. */
  private rr = new Map<string, number>();
  /** Balls heading to each instance, per node (least connections). */
  private inFlight = new Map<string, number[]>();

  constructor(private readonly rng: () => number = Math.random) {}

  clear(): void {
    this.balls = [];
    this.bursts = [];
    this.owed.clear();
    this.rr.clear();
    this.inFlight.clear();
    this.cooldown = 0;
  }

  /** Advance `dt` seconds: move balls, handle arrivals, spawn at the entries. */
  step(dt: number, snap: TickSnapshot, topo: FlowTopology, env: FlowEnv): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dt;
      if (this.bursts[i].age >= BURST_SEC) this.bursts.splice(i, 1);
    }

    const arrived: Ball[] = [];
    const kept: Ball[] = [];
    for (const b of this.balls) {
      const len = env.lengthOf(b.drawn);
      if (len === undefined) {
        this.leave(topo.byId.get(b.edge)?.target, b.instance);
        continue; // edge gone or no longer drawn (expanded/collapsed)
      }
      b.pos += BALL_SPEED * dt;
      (b.pos >= len ? arrived : kept).push(b);
    }
    this.balls = kept;
    for (const b of arrived) this.arrive(b, snap, topo, env);

    this.spawn(dt, snap, topo, env);
  }

  /** Entry nodes and their arrival rate, req/s. */
  entries(snap: TickSnapshot, topo: FlowTopology): Map<string, number> {
    const rates = new Map<string, number>();
    for (const [node, outs] of topo.out) {
      const fed = (topo.in.get(node) ?? []).some((e) => (snap.edges[e.id]?.rps ?? 0) > 0);
      if (fed) continue;
      const outRps = Math.max(0, ...outs.map((e) => snap.edges[e.id]?.rps ?? 0));
      const rate = snap.nodes[node]?.rpsIn ?? outRps;
      if (rate > 0 && outRps > 0) rates.set(node, rate);
    }
    return rates;
  }

  private spawn(dt: number, snap: TickSnapshot, topo: FlowTopology, env: FlowEnv): void {
    const rates = this.entries(snap, topo);
    let total = 0;
    for (const r of rates.values()) total += r;
    if (total <= 0) return;
    this.adaptQuantum(dt, total);
    for (const [node, rate] of rates) {
      let owed = (this.owed.get(node) ?? 0) + (rate / this.quantum) * dt;
      while (owed >= 1) {
        owed -= 1;
        const key = Math.floor(this.rng() * 2 ** 31);
        // Born at an expanded entry: it starts in one of its instances.
        const layout = env.instancesOf?.(node);
        const lane = layout
          ? laneOf(this.pick(node, layout, "round-robin", key), layout.count)
          : -1;
        this.dispatch(node, lane, snap, topo, env, key);
      }
      this.owed.set(node, owed);
    }
    for (const node of this.owed.keys()) if (!rates.has(node)) this.owed.delete(node);
  }

  /**
   * The entry load sets the quantum (re-picked only past the hysteresis); a
   * crowded screen (fan-outs multiply balls) steps it up, and it steps back
   * down once there's room and the load alone would ask for less.
   */
  private adaptQuantum(dt: number, entryRps: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const ideal = entryRps / TARGET_SPAWN_PER_SEC;
    const drift = ideal / this.quantum;
    const fill = this.balls.length / MAX_BALLS;
    if (drift > QUANTUM_HYSTERESIS) {
      this.quantum = niceStep(ideal);
    } else if (this.cooldown > 0) {
      return;
    } else if (fill > CROWDED) {
      this.quantum = niceStep(this.quantum * 1.5);
    } else if (drift < 1 / QUANTUM_HYSTERESIS && fill < SPARSE) {
      this.quantum = Math.max(niceStep(ideal), stepDown(this.quantum));
    } else {
      return;
    }
    this.cooldown = QUANTUM_COOLDOWN_SEC;
  }

  private arrive(b: Ball, snap: TickSnapshot, topo: FlowTopology, env: FlowEnv): void {
    const { deferred } = b;
    if (deferred) {
      this.launchCalls(deferred.node, deferred.lane, deferred.edges, snap, topo, env, b.key);
    }
    const node = topo.byId.get(b.edge)?.target;
    if (!node) return;
    this.leave(node, b.instance);
    const m = snap.nodes[node];
    if (m) {
      const failP = clamp01(Math.max(m.errorRate, m.rpsIn > 0 ? m.drops / m.rpsIn : 0));
      if (failP > 0 && this.rng() < failP) {
        this.bursts.push({ edge: b.drawn, age: 0 });
        return;
      }
    }
    this.dispatch(node, b.lane, snap, topo, env, b.key);
  }

  /** The instance a ball heads to at `node`: a live one, by the algorithm. */
  private pick(node: string, layout: InstanceLayout, policy: string, key: number): number {
    const n = layout.count;
    if (n <= 0) return 0;
    const alive = (i: number) => !layout.down[i];
    const firstAliveFrom = (start: number) => {
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (alive(i)) return i;
      }
      return start % n; // all down: the ball still goes (and fails there)
    };
    if (policy === "hash") return firstAliveFrom(mix(key) % n);
    if (policy === "least-connections") {
      const load = this.inFlight.get(node);
      const start = this.rr.get(node) ?? 0;
      let best = -1;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (!alive(i)) continue;
        if (best < 0 || (load?.[i] ?? 0) < (load?.[best] ?? 0)) best = i;
      }
      this.rr.set(node, (start + 1) % n);
      return best < 0 ? firstAliveFrom(start) : best;
    }
    // round robin; weighted splits by capacity, which is equal within one node
    const i = firstAliveFrom(this.rr.get(node) ?? 0);
    this.rr.set(node, (i + 1) % n);
    return i;
  }

  private enter(node: string, index: number, count: number): void {
    let load = this.inFlight.get(node);
    if (!load || load.length !== count) {
      load = Array.from({ length: count }, () => 0);
      this.inFlight.set(node, load);
    }
    load[index] = (load[index] ?? 0) + 1;
  }

  private leave(node: string | undefined, index: number): void {
    if (node === undefined || index < 0) return;
    const load = this.inFlight.get(node);
    if (load && load[index] > 0) load[index]--;
  }

  /** A request at `node` (in card `lane`, −1 = not expanded). */
  private dispatch(
    node: string,
    lane: number,
    snap: TickSnapshot,
    topo: FlowTopology,
    env: FlowEnv,
    key: number,
  ): void {
    const outs = (topo.out.get(node) ?? []).filter((e) => (snap.edges[e.id]?.rps ?? 0) > 0);
    if (outs.length === 0) return;

    if (topo.routing.get(node) === "lb") {
      const total = outs.reduce((s, e) => s + snap.edges[e.id].rps, 0);
      let pick = this.rng() * total;
      let chosen = outs[outs.length - 1];
      for (const e of outs) {
        pick -= snap.edges[e.id].rps;
        if (pick <= 0) {
          chosen = e;
          break;
        }
      }
      this.launch(chosen, lane, key, topo, env, undefined);
      return;
    }

    // Cache first: the other sync calls wait for the cache leg to arrive.
    const cacheLegs = outs.filter((e) => !e.async && topo.routing.get(e.target) === "cache");
    const later = outs.filter((e) => !e.async && topo.routing.get(e.target) !== "cache");
    const now = outs.filter((e) => e.async || topo.routing.get(e.target) === "cache");
    if (cacheLegs.length > 0 && later.length > 0) {
      const sent = this.launchCalls(node, lane, now, snap, topo, env, key, (e) =>
        cacheLegs.includes(e) ? { node, lane, edges: later } : undefined,
      );
      if (!sent.some((e) => cacheLegs.includes(e))) {
        this.launchCalls(node, lane, later, snap, topo, env, key);
      }
      return;
    }
    this.launchCalls(node, lane, outs, snap, topo, env, key);
  }

  /**
   * Call each edge in proportion to its load: rps(edge) / (balls' rate through
   * the node). Returns the edges that got at least one ball.
   */
  private launchCalls(
    node: string,
    lane: number,
    edges: readonly TopoEdge[],
    snap: TickSnapshot,
    topo: FlowTopology,
    env: FlowEnv,
    key: number,
    deferredFor?: (e: TopoEdge) => Ball["deferred"],
  ): TopoEdge[] {
    const through = this.throughRate(node, snap, topo);
    const sent: TopoEdge[] = [];
    if (through <= 0) return sent;
    for (const e of edges) {
      const rps = snap.edges[e.id]?.rps ?? 0;
      if (rps <= 0) continue;
      const calls = rps / through;
      const n = Math.min(MAX_CALLS_PER_EDGE, Math.floor(calls) + (this.rng() < calls % 1 ? 1 : 0));
      let any = false;
      for (let k = 0; k < n; k++) {
        if (this.launch(e, lane, key, topo, env, k === 0 ? deferredFor?.(e) : undefined))
          any = true;
      }
      if (any) sent.push(e);
    }
    return sent;
  }

  /** The rate at which balls leave `node` (the requests it served), req/s. */
  private throughRate(node: string, snap: TickSnapshot, topo: FlowTopology): number {
    const m = snap.nodes[node];
    if (m && m.rpsIn > 0) {
      const failP = clamp01(Math.max(m.errorRate, m.drops / m.rpsIn));
      return m.rpsIn * (1 - failP);
    }
    // No node metrics (synthetic snapshot): the busiest incoming or outgoing edge.
    const edges = [...(topo.in.get(node) ?? []), ...(topo.out.get(node) ?? [])];
    return Math.max(0, ...edges.map((e) => snap.edges[e.id]?.rps ?? 0));
  }

  /**
   * Send a ball down `e` from card `fromLane` of its source: into an expanded
   * target it takes the copy to the instance it picked. False when nothing is
   * drawn for it (or the cap is reached).
   */
  private launch(
    e: TopoEdge,
    fromLane: number,
    key: number,
    topo: FlowTopology,
    env: FlowEnv,
    deferred: Ball["deferred"],
  ): boolean {
    if (this.balls.length >= MAX_BALLS) return false;
    const layout = env.instancesOf?.(e.target);
    let instance = -1;
    let lane = -1;
    if (layout) {
      const policy =
        topo.routing.get(e.source) === "lb"
          ? (topo.algorithm.get(e.source) ?? "round-robin")
          : "round-robin";
      instance = this.pick(e.target, layout, policy, key);
      lane = laneOf(instance, layout.count);
    }
    const drawn = instanceEdgeId(e.id, fromLane, lane);
    if (env.lengthOf(drawn) === undefined) return false;
    if (layout && instance >= 0) this.enter(e.target, instance, layout.count);
    const ball: Ball = { edge: e.id, drawn, pos: 0, key, lane, instance };
    if (deferred) ball.deferred = deferred;
    this.balls.push(ball);
    return true;
  }
}
