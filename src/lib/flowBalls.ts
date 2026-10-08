/**
 * Request balls for the flow overlay (Spec 07, OBS-04; request-flow). Pure
 * state machine: the canvas layer (`components/canvas/FlowParticles`) feeds
 * it the latest snapshot, the topology and the drawn geometry, and draws what
 * it holds.
 *
 * One ball stands for `quantum` req/s of flow. A ball is a request walking the
 * graph, so it can be followed from the entry and back:
 *
 * - It is born at an entry node (no incoming edge with load) at that node's
 *   arrival rate, a read with probability `global.readRatio`.
 * - A call fails on arrival with its edge's `edgeLinkFailure` (packet loss,
 *   the caller's timeout), then with the node's error/drop share: a burst
 *   marks it and an error response goes back to the caller (FLW-05). Else the node
 *   opens a **frame** for the request and makes its calls:
 *   - a load balancer sends it down ONE outgoing edge, weighted by the edges' load;
 *   - a queue takes it and answers at once; its consumers get it fire-and-forget;
 *   - any other node follows its call plan (`domain/graph/callPlan`, AD-002):
 *     step by step, the calls of a step together (FLW-31), each made or not
 *     for this request (reads/writes by its class, a fraction by a draw,
 *     read-through and "after a miss" by the cache's `extra.hitRatio`; a
 *     failed cache call the plan absorbs counts as a miss). Sync calls are
 *     waited for; async ones leave in their step and never answer (FLW-03).
 * - After the last step the frame answers: a response ball (`dir: "res"`)
 *   travels the same drawn edge back to the caller's frame (FLW-01). At the
 *   entry the request ends (FLW-06).
 * - Into an expanded node (one card per instance, `lib/instances.ts`) the ball
 *   takes the edge to ONE instance's card, picked like the load balancer in
 *   front would (round robin, least connections, hash of the request; weighted
 *   splits by capacity, equal within a node), skipping instances the faults took
 *   down; its calls leave from that card, and its response retraces the copy
 *   it came in on, back to the caller's card (FLW-47).
 *
 * Edges without their calls (a topology built without rules) are all called
 * at once, each in proportion to its load, as before the call model.
 *
 * Requests and responses share MAX_BALLS and drive the quantum (FLW-07). A
 * call that can't be drawn (cap reached, edge not drawn) counts as answered
 * on the spot; frames waiting longer than FRAME_TTL_SEC, or at a node that
 * left the graph, are dropped.
 *
 * The quantum is adaptive: a round number (1-2-5 steps) giving ~TARGET_SPAWN_PER_SEC
 * balls per second at the entries, re-picked only when the load drifts far from
 * it, so the legend doesn't flicker.
 */
import type { EdgeCall, RoutingKind } from "@/domain/components/types";
import { planFor, type CallPlan, type PlannedCall } from "@/domain/graph/callPlan";
import type { TickSnapshot } from "@/engine/types";
import { instanceEdgeId, laneOf } from "./instances";

/** Hard cap on balls alive at once (requests and responses), all edges together. */
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
/** A frame still waiting after this long (orphaned by an edit) is dropped, seconds. */
export const FRAME_TTL_SEC = 20;
/**
 * Read ratio when a snapshot doesn't carry one (built by hand): the engine's
 * default (`DEFAULT_READ_RATIO`, engine/core/routing.ts), not imported so the
 * engine stays out of the initial bundle.
 */
const FALLBACK_READ_RATIO = 0.9;

export interface TopoEdge {
  id: string;
  source: string;
  target: string;
  async: boolean;
  /**
   * The calls the source makes over the edge (`rule.calls`). Without them
   * the source calls every edge at once, in proportion to its load.
   */
  calls?: readonly EdgeCall[];
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
  /** Call plan of each source whose edges all carry their calls. */
  plans: ReadonlyMap<string, CallPlan>;
}

/**
 * Who calls whom, the routing per node and each node's call plan. Built once
 * per graph change (never per frame). `hasHitRate`: the node has a hit rate
 * (caches, CDNs), which "after a miss" calls need (as in `compileGraph`).
 */
export function buildTopology(
  edges: readonly TopoEdge[],
  routingOf: (nodeId: string) => RoutingKind,
  algorithmOf: (nodeId: string) => string | undefined = () => undefined,
  hasHitRate: (nodeId: string) => boolean = () => false,
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
  const plans = new Map<string, CallPlan>();
  for (const [source, outs] of out) {
    if (outs.some((e) => !e.calls)) continue;
    const planEdges = outs.map((e) => ({
      id: e.id,
      target: e.target,
      async: e.async,
      calls: e.calls!,
    }));
    plans.set(source, planFor(source, planEdges, hasHitRate, { routing: routing.get(source) }));
  }
  return { out, in: inn, byId, routing, algorithm, plans };
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
  /** Flow-px travelled along `drawn` (a response travels it target → source). */
  pos: number;
  /** "req": a call on its way to the target; "res": its response on the way back. */
  dir: "req" | "res";
  /** Stable per request (and its calls): the hash algorithm's key. */
  key: number;
  /** The request is a read (else a write). */
  read: boolean;
  /** Card (lane) and instance it heads to at the target; −1 = not expanded. */
  lane: number;
  instance: number;
  /** A response to a failed call (drawn in the error color). */
  error?: boolean;
  /** Frame (at the edge's source) waiting for this call; undefined for async calls. */
  frame?: number;
}

export interface Burst {
  /** The drawn edge whose end marks where the request failed. */
  edge: string;
  age: number;
}

/** One request at one node: its calls, step by step, until it answers. */
interface Frame {
  node: string;
  /** Card the request is in at `node` (−1 = not expanded): its calls leave from it. */
  lane: number;
  key: number;
  read: boolean;
  /** The call that brought the request here (its response retraces it); none at an entry or after an async call. */
  caller?: Ball;
  /** Steps started (index into the plan's steps; LB/queue/no plan: 1 once started). */
  started: number;
  /** Plan step number of the last started step: async calls up to it are sent. */
  at: number;
  /** Sync calls still out. */
  pending: number;
  failed: boolean;
  /** Absorbed cache calls (edge id) → hit, for "after a miss" calls. */
  hits: Map<string, boolean>;
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

/** What one `step` works with. */
interface StepContext {
  snap: TickSnapshot;
  topo: FlowTopology;
  env: FlowEnv;
}

export class FlowBalls {
  /** Calls on their way (`dir: "req"`). */
  balls: Ball[] = [];
  /** Responses on their way back (`dir: "res"`). */
  responses: Ball[] = [];
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
  private frames = new Map<number, Frame>();
  private nextFrame = 1;

  constructor(private readonly rng: () => number = Math.random) {}

  /** Requests open at some node (waiting for their calls). */
  get frameCount(): number {
    return this.frames.size;
  }

  clear(): void {
    this.balls = [];
    this.responses = [];
    this.bursts = [];
    this.owed.clear();
    this.rr.clear();
    this.inFlight.clear();
    this.frames.clear();
    this.cooldown = 0;
  }

  /** Advance `dt` seconds: move balls, handle arrivals, spawn at the entries. */
  step(dt: number, snap: TickSnapshot, topo: FlowTopology, env: FlowEnv): void {
    const ctx: StepContext = { snap, topo, env };
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dt;
      if (this.bursts[i].age >= BURST_SEC) this.bursts.splice(i, 1);
    }
    for (const [id, f] of this.frames) {
      f.age += dt;
      if (f.age > FRAME_TTL_SEC || !topo.routing.has(f.node)) this.frames.delete(id);
    }

    const arrived: Ball[] = [];
    const answered: Ball[] = [];
    const lost: Ball[] = [];
    const move = (list: Ball[], done: Ball[]): Ball[] => {
      const kept: Ball[] = [];
      for (const b of list) {
        const len = env.lengthOf(b.drawn);
        if (len === undefined) {
          lost.push(b); // edge gone or no longer drawn (expanded/collapsed)
          continue;
        }
        b.pos += BALL_SPEED * dt;
        (b.pos >= len ? done : kept).push(b);
      }
      return kept;
    };
    this.balls = move(this.balls, arrived);
    this.responses = move(this.responses, answered);
    for (const b of lost) {
      // The call counts as answered: its frame goes on.
      if (b.dir === "req") this.leave(topo.byId.get(b.edge)?.target, b.instance);
      this.deliver(b.frame, b.edge, b.dir === "req" || !b.error, ctx);
    }
    for (const b of arrived) this.arrive(b, ctx);
    for (const b of answered) this.deliver(b.frame, b.edge, !b.error, ctx);

    this.spawn(dt, ctx);
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

  private get alive(): number {
    return this.balls.length + this.responses.length;
  }

  private spawn(dt: number, ctx: StepContext): void {
    const { snap, topo, env } = ctx;
    const rates = this.entries(snap, topo);
    let total = 0;
    for (const r of rates.values()) total += r;
    if (total <= 0) return;
    this.adaptQuantum(dt, total);
    const readRatio = snap.global.readRatio ?? FALLBACK_READ_RATIO;
    for (const [node, rate] of rates) {
      let owed = (this.owed.get(node) ?? 0) + (rate / this.quantum) * dt;
      while (owed >= 1) {
        owed -= 1;
        const key = Math.floor(this.rng() * 2 ** 31);
        const read = this.rng() < readRatio;
        // Born at an expanded entry: it starts in one of its instances.
        const layout = env.instancesOf?.(node);
        const lane = layout
          ? laneOf(this.pick(node, layout, "round-robin", key), layout.count)
          : -1;
        this.open(node, lane, key, read, undefined, ctx);
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
    const fill = this.alive / MAX_BALLS;
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

  /**
   * A call reached its target: it fails on the link or by the caller's
   * timeout (`edgeLinkFailure`), the request fails at the node, or the node
   * opens a frame.
   */
  private arrive(b: Ball, ctx: StepContext): void {
    const node = ctx.topo.byId.get(b.edge)?.target;
    if (!node) {
      this.deliver(b.frame, b.edge, true, ctx); // edge left the graph: answered
      return;
    }
    this.leave(node, b.instance);
    const linkP = clamp01(ctx.snap.edgeLinkFailure?.[b.edge] ?? 0);
    if (linkP > 0 && this.rng() < linkP) {
      this.fail(b, ctx);
      return;
    }
    const m = ctx.snap.nodes[node];
    if (m) {
      const failP = clamp01(Math.max(m.errorRate, m.rpsIn > 0 ? m.drops / m.rpsIn : 0));
      if (failP > 0 && this.rng() < failP) {
        this.fail(b, ctx);
        return;
      }
    }
    this.open(node, b.lane, b.key, b.read, b.frame === undefined ? undefined : b, ctx);
  }

  /** The call failed: a burst marks it and an error response goes back (FLW-05). */
  private fail(b: Ball, ctx: StepContext): void {
    this.bursts.push({ edge: b.drawn, age: 0 });
    this.respond(b, true, ctx);
  }

  private open(
    node: string,
    lane: number,
    key: number,
    read: boolean,
    caller: Ball | undefined,
    ctx: StepContext,
  ): void {
    const id = this.nextFrame++;
    const f: Frame = {
      node,
      lane,
      key,
      read,
      caller,
      started: 0,
      at: 0,
      pending: 0,
      failed: false,
      hits: new Map(),
      age: 0,
    };
    this.frames.set(id, f);
    this.advance(id, f, ctx);
  }

  /** Start steps until one has calls out, then wait; past the last, answer. */
  private advance(id: number, f: Frame, ctx: StepContext): void {
    while (f.pending === 0) {
      if (f.failed || !this.nextStep(id, f, ctx)) {
        this.frames.delete(id);
        if (f.caller) this.respond(f.caller, f.failed, ctx);
        return;
      }
    }
  }

  /** Send the frame's next step; false when none is left (after sending the last async calls). */
  private nextStep(id: number, f: Frame, ctx: StepContext): boolean {
    const { snap, topo } = ctx;
    const routing = topo.routing.get(f.node);
    const outs = (topo.out.get(f.node) ?? []).filter((e) => (snap.edges[e.id]?.rps ?? 0) > 0);
    const plan = topo.plans.get(f.node);

    if (routing === "lb") {
      if (f.started++ > 0 || outs.length === 0) return false;
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
      this.call(id, f, chosen, 1, ctx);
      return true;
    }

    if (routing === "queue" || !plan) {
      if (f.started++ > 0) return false;
      // A queue answers the producer at once; its consumers get the message
      // fire-and-forget. Without a plan, every edge in proportion to its load.
      const through = plan ? 0 : this.throughRate(f.node, snap, topo);
      for (const e of outs) {
        let n: number;
        if (plan) {
          n = 0;
          for (const p of [...plan.steps.flat(), ...plan.async]) {
            if (p.edgeId === e.id) n += this.copies(f, p, ctx);
          }
        } else {
          n = through > 0 ? this.draw(snap.edges[e.id].rps / through) : 0;
        }
        this.call(id, f, e, n, ctx, routing === "queue" || e.async);
      }
      return true;
    }

    if (f.started >= plan.steps.length) {
      this.sendAsync(id, f, plan, Infinity, ctx);
      return false;
    }
    const group = plan.steps[f.started++];
    this.sendAsync(id, f, plan, group[0].step, ctx);
    for (const p of group) {
      const e = topo.byId.get(p.edgeId);
      if (e) this.call(id, f, e, this.copies(f, p, ctx), ctx);
    }
    return true;
  }

  /** Async calls planned after the last started step and up to `upTo`. */
  private sendAsync(id: number, f: Frame, plan: CallPlan, upTo: number, ctx: StepContext): void {
    for (const p of plan.async) {
      if (p.step <= f.at || p.step > upTo) continue;
      const e = ctx.topo.byId.get(p.edgeId);
      if (e) this.call(id, f, e, this.copies(f, p, ctx), ctx, true);
    }
    f.at = upTo;
  }

  /** How many calls this request makes for a planned call (0 = condition not met). */
  private copies(f: Frame, p: PlannedCall, ctx: StepContext): number {
    if ((ctx.snap.edges[p.edgeId]?.rps ?? 0) <= 0) return 0;
    const { call } = p;
    let made: boolean;
    switch (call.kind) {
      case "reads":
        made = f.read;
        break;
      case "writes":
        made = !f.read;
        break;
      case "fraction":
        made = this.rng() < clamp01(call.fraction ?? 1);
        break;
      case "on_miss":
        made = this.rng() >= this.hitRatio(f.node, ctx);
        break;
      case "after_miss":
        made = f.read && f.hits.get(p.dependsOn ?? "") !== true;
        break;
      default:
        made = true;
    }
    return made ? this.draw(call.callsPerRequest) : 0;
  }

  /** ⌊k⌋ calls plus one more with probability frac(k), capped. */
  private draw(k: number): number {
    if (!(k > 0)) return 0;
    return Math.min(MAX_CALLS_PER_EDGE, Math.floor(k) + (this.rng() < k % 1 ? 1 : 0));
  }

  private hitRatio(node: string, ctx: StepContext): number {
    return clamp01(ctx.snap.nodes[node]?.extra?.hitRatio ?? 0);
  }

  /** `n` calls down `e`: sync ones are waited for (or answered at once when they can't be drawn). */
  private call(
    id: number,
    f: Frame,
    e: TopoEdge,
    n: number,
    ctx: StepContext,
    async = e.async,
  ): void {
    for (let k = 0; k < n; k++) {
      const sent = this.launch(e, f, async ? undefined : id, ctx);
      if (async) continue;
      if (sent) f.pending++;
      else this.resolve(f, e, true, ctx);
    }
  }

  /** A call of the frame came back (ok or failed). */
  private resolve(f: Frame, e: TopoEdge | undefined, ok: boolean, ctx: StepContext): void {
    if (!e) return;
    const plan = ctx.topo.plans.get(f.node);
    if (plan?.absorbed.includes(e.id)) {
      // A cache call some "after a miss" call depends on: a failure is a miss.
      if (!f.read) return;
      const hit = ok && this.rng() < this.hitRatio(e.target, ctx);
      f.hits.set(e.id, hit && f.hits.get(e.id) !== false);
      return;
    }
    if (!ok) f.failed = true;
  }

  /** The response to a call reached the frame that made it. */
  private deliver(frameId: number | undefined, edge: string, ok: boolean, ctx: StepContext): void {
    if (frameId === undefined) return;
    const f = this.frames.get(frameId);
    if (!f) return; // dropped (TTL, node gone)
    f.pending = Math.max(0, f.pending - 1);
    this.resolve(f, ctx.topo.byId.get(edge), ok, ctx);
    if (f.pending === 0) this.advance(frameId, f, ctx);
  }

  /** Answer the call `req` along the edge it came in on (async calls get no answer). */
  private respond(req: Ball, error: boolean, ctx: StepContext): void {
    if (req.frame === undefined) return;
    if (this.alive >= MAX_BALLS || ctx.env.lengthOf(req.drawn) === undefined) {
      this.deliver(req.frame, req.edge, !error, ctx);
      return;
    }
    this.responses.push({ ...req, dir: "res", pos: 0, error });
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

  /**
   * Send a call down `e` from the frame's card: into an expanded target it
   * takes the copy to the instance it picked. False when nothing is drawn for
   * it (or the cap is reached).
   */
  private launch(e: TopoEdge, f: Frame, frame: number | undefined, ctx: StepContext): boolean {
    const { topo, env } = ctx;
    if (this.alive >= MAX_BALLS) return false;
    const layout = env.instancesOf?.(e.target);
    let instance = -1;
    let lane = -1;
    if (layout) {
      const policy =
        topo.routing.get(e.source) === "lb"
          ? (topo.algorithm.get(e.source) ?? "round-robin")
          : "round-robin";
      instance = this.pick(e.target, layout, policy, f.key);
      lane = laneOf(instance, layout.count);
    }
    const drawn = instanceEdgeId(e.id, f.lane, lane);
    if (env.lengthOf(drawn) === undefined) return false;
    if (layout && instance >= 0) this.enter(e.target, instance, layout.count);
    const ball: Ball = {
      edge: e.id,
      drawn,
      pos: 0,
      dir: "req",
      key: f.key,
      read: f.read,
      lane,
      instance,
    };
    if (frame !== undefined) ball.frame = frame;
    this.balls.push(ball);
    return true;
  }
}
