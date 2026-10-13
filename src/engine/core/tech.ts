/**
 * Technology mechanics in the engine (component-technologies, design
 * "Mecânicas no motor" and Apêndice A): pure math over a node's
 * `TechProfile`, called only for nodes that have one, so a generic node
 * never reaches this module.
 *
 * - `edgeWriteShare`: the share of an edge's calls that are writes (A.3).
 * - `admit`: quotas, the hot partition (only it loses, D2) and the token
 *   bucket of a burst quota (tick).
 * - `techSteadyFlow`: per-class stations of one node in the steady state.
 * - `classTail` / `techExceeds` / `techPercentileMs` / `techMeanMs`: the
 *   latency of a class (one service time, the k-th of n replies, the slowest
 *   of n shards) plus its station's wait (A.6).
 * - `sampleClassMs`: one sampled latency of a class (A.5, D3).
 */
import type { SimEdge, SimNode } from "@/domain/graph/compile";
import { partitionUtilization, type ClassDemand } from "@/domain/components/technologies/limits";
import {
  capScaleOf,
  scaledStation,
  type LatencyShape,
  type TechClasses,
  type TechCore,
  type TechProfile,
  type TechThrottle,
} from "@/domain/components/technologies/profile";
import {
  clamp01,
  probSojournExceeds,
  probWaitExceeds,
  sampleWaitMs,
  station,
  type StationState,
} from "./queueing";
import { sampleExponential, type Rng } from "./rng";
import { callProbability, callsOf, edgeCallsOf, type CallContext } from "./routing";
import type { FlowView } from "./settle";

/* ---------- read/write split per edge (A.3) ---------- */

/** Write share of one call kind: what the caller's own mix gives for `always`/`fraction`. */
function callWriteShare(kind: string, wsSource: number): number {
  if (kind === "writes") return 1;
  if (kind === "reads" || kind === "on_miss" || kind === "after_miss") return 0;
  return wsSource;
}

/**
 * Share of the requests `source` sends over `e` that are writes: a load
 * balancer passes its own mix on; otherwise each call weighs P(call) ×
 * callsPerRequest. No call expected under this mix: the kinds alone (like
 * the faults' `writeShareOf`).
 */
export function edgeWriteShare(
  e: SimEdge,
  source: SimNode,
  wsSource: number,
  ctx: CallContext,
): number {
  const ws = clamp01(wsSource);
  if (source.routing === "lb") return ws;
  const calls = edgeCallsOf(e, source);
  let total = 0;
  let writes = 0;
  for (const c of calls) {
    const w = callProbability(c.call, source, ctx, c.dependsOn) * callsOf(c.call);
    total += w;
    writes += w * callWriteShare(c.call.kind, ws);
  }
  if (total > 0) return clamp01(writes / total);
  if (calls.length > 0 && calls.every((c) => c.call.kind === "writes")) return 1;
  if (calls.every((c) => callWriteShare(c.call.kind, 1) === 0)) return 0;
  return ws;
}

/* ---------- admission: quotas and the hot partition ---------- */

export interface Admitted extends ClassDemand {
  /** Requests per second refused by the quota or the hot partition (errors). */
  throttled: number;
  /** Token bucket after this step (only when one was given). */
  tokens?: number;
}

/** A burst quota's token bucket in the tick: tokens now and the step length. */
export interface TokenBucket {
  tokens: number;
  dtSec: number;
}

function nonNegative(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * What a node's throttle lets through. Quota: each class up to its own
 * limit, then the shared limit proportionally — with `bucket` and a burst,
 * a token bucket instead (it starts full: tokens ← min(burst, tokens +
 * L·dt), admitted = min(arrivals, tokens)). Hot partition (D2): when its
 * load U passes 1 only it loses, a share × (1 − 1/U) of the requests of
 * each class.
 */
export function admit(
  throttle: TechThrottle | undefined,
  demand: ClassDemand,
  capScale: number,
  bucket?: TokenBucket,
): Admitted {
  let read = nonNegative(demand.read);
  let write = nonNegative(demand.write);
  const offered = read + write;
  let tokens = bucket?.tokens;
  if (throttle?.kind === "quota") {
    if (throttle.readRps !== undefined) read = Math.min(read, throttle.readRps);
    if (throttle.writeRps !== undefined) write = Math.min(write, throttle.writeRps);
    const limit = throttle.sharedRps;
    if (limit !== undefined) {
      const total = read + write;
      let allowed = Math.min(total, limit);
      if (bucket && throttle.burst !== undefined) {
        const dt = nonNegative(bucket.dtSec);
        const full = Math.min(throttle.burst, nonNegative(bucket.tokens) + limit * dt);
        allowed = dt > 0 ? Math.min(total, full / dt) : 0;
        tokens = full - allowed * dt;
      }
      const factor = total > 0 ? allowed / total : 1;
      read *= factor;
      write *= factor;
    }
  } else if (throttle?.kind === "partition") {
    const u = partitionUtilization(throttle, { read, write }, capScale);
    if (u > 1) {
      const keep = 1 - throttle.share * (1 - 1 / u);
      read *= keep;
      write *= keep;
    }
  }
  return {
    read,
    write,
    throttled: Math.max(0, offered - read - write),
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

/* ---------- per-class stations (steady state) ---------- */

/** One request class at a node, as settle, the SLO and the sampler read it. */
export interface TechClassView {
  /** The station the class queues at. */
  station: StationState;
  /** Mean service time of one operation of the class, ms. */
  serviceTimeMs: number;
  shape: LatencyShape;
  addMs: number;
  /** Requests of the class served, req/s. */
  served: number;
  /** P(a request of the class is dropped, throttled or failed by a fault here). */
  dropProbability: number;
}

/** A node with a technology, by class (`FlowView.tech`). */
export interface TechFlowView {
  /** Write share of the node's offered load. */
  ws: number;
  read: TechClassView;
  write: TechClassView;
}

export interface TechSteadyInput {
  profile: TechProfile;
  /** The node as faults left it (capacity, service time). */
  core: TechCore;
  /** Requests per second offered to the node. */
  offered: number;
  /** Share of them that are writes. */
  writeShare: number;
  /** Fault: share of the arrivals failed before the node works on them. */
  errorRate?: number;
  maxQueue: number;
  horizonSec: number;
}

export interface TechSteady {
  /** One per station of the profile, in its order. */
  stations: StationState[];
  view: TechFlowView;
  /** Requests per second served, ≤ offered. */
  served: number;
  /** Requests per second refused by the throttle. */
  throttled: number;
}

/** The profile's classes, or the node's own station for both (a throttle alone). */
export function classesOf(profile: TechProfile, core: TechCore): TechClasses {
  if (profile.classes) return profile.classes;
  const one = { station: 0, cost: 1, serviceScale: 1, shape: { kind: "one" } as const, addMs: 0 };
  return {
    read: one,
    write: one,
    stations: [
      {
        instances: core.instances,
        capacityPerInstance: profile.base.capacityPerInstance,
        serviceTimeMs: profile.base.serviceTimeMs,
        limit: "capacity",
        scalesWithInstances: true,
      },
    ],
  };
}

/**
 * Steady state of one node with a technology (A.2): the fault's error rate,
 * then the throttle, then each station under the operations its classes
 * send it (λ_s = Σ admitted_c × cost_c); a class is served in its station's
 * served fraction. Served ≤ offered and every number finite.
 */
export function techSteadyFlow(input: TechSteadyInput): TechSteady {
  const { profile, core } = input;
  const offered = nonNegative(input.offered);
  const ws = clamp01(input.writeShare);
  const offeredRead = offered * (1 - ws);
  const offeredWrite = offered * ws;
  const healthy = 1 - clamp01(input.errorRate ?? 0);
  const capScale = capScaleOf(profile, core);
  const admitted = admit(
    profile.throttle,
    { read: offeredRead * healthy, write: offeredWrite * healthy },
    capScale,
  );
  const classes = classesOf(profile, core);
  const stations = classes.stations.map((s, i) => {
    const ops =
      (classes.read.station === i ? admitted.read * classes.read.cost : 0) +
      (classes.write.station === i ? admitted.write * classes.write.cost : 0);
    return station({
      lambda: ops,
      ...scaledStation(profile, s, core),
      maxQueue: input.maxQueue,
      horizonSec: input.horizonSec,
    });
  });
  const servedFraction = (st: StationState) => {
    const ops = st.servedRps + st.unservedRps;
    return ops > 0 ? clamp01(st.servedRps / ops) : 1;
  };
  const view = (
    route: TechClasses["read"],
    admittedRps: number,
    offeredRps: number,
  ): TechClassView => {
    const st = stations[route.station] ?? stations[0];
    const served = Math.min(offeredRps, admittedRps * servedFraction(st));
    return {
      station: st,
      serviceTimeMs: st.serviceTimeMs * route.serviceScale,
      shape: route.shape,
      addMs: route.addMs,
      served,
      dropProbability: offeredRps > 0 ? clamp01(1 - served / offeredRps) : 0,
    };
  };
  const read = view(classes.read, admitted.read, offeredRead);
  const write = view(classes.write, admitted.write, offeredWrite);
  return {
    stations,
    view: { ws, read, write },
    served: Math.min(offered, read.served + write.served),
    throttled: admitted.throttled,
  };
}

/* ---------- latency of a class (A.6) ---------- */

/** E[Y] of the shape on Exp(1) service times: 1, Σ_{j=1..k} 1/(n−j+1), H_n. */
export function shapeMean(shape: LatencyShape): number {
  if (shape.kind === "one") return 1;
  const k = shape.kind === "kth" ? shape.k : shape.n;
  let mean = 0;
  for (let j = 1; j <= k; j++) mean += 1 / (shape.n - j + 1);
  return mean;
}

/** P(Y > x) of the shape on Exp(1) service times, at x = t/S. */
function shapeTail(shape: LatencyShape, x: number): number {
  const slow = Math.exp(-x); // one reply slower than x
  if (shape.kind === "one") return slow;
  const fast = -Math.expm1(-x); // one reply within x
  if (shape.kind === "max") return -Math.expm1(shape.n * Math.log1p(-slow));
  // Fewer than k of n replies within x: Σ_{j<k} C(n, j) fastʲ slowⁿ⁻ʲ.
  let sum = 0;
  let choose = 1;
  for (let j = 0; j < shape.k; j++) {
    sum += choose * fast ** j * slow ** (shape.n - j);
    choose = (choose * (shape.n - j)) / (j + 1);
  }
  return sum;
}

/**
 * P(a request of the class takes longer than `t` ms): its service shape
 * plus its station's wait past the shape's mean, after the fixed `addMs`
 * (the same union bound as `probSojournExceeds`, to which the shape `one`
 * without `addMs` reduces).
 */
export function classTail(cls: TechClassView, t: number): number {
  if (!(t > 0)) return 1;
  const rest = t - cls.addMs;
  if (!(rest > 0)) return 1;
  const s = cls.serviceTimeMs;
  return clamp01(
    shapeTail(cls.shape, rest / s) + probWaitExceeds(cls.station, rest - s * shapeMean(cls.shape)),
  );
}

/** P(hop > t) at a node with a technology: its classes mixed by the write share `ws`. */
export function techExceeds(tech: TechFlowView, ws: number, t: number): number {
  const w = clamp01(ws);
  return clamp01((1 - w) * classTail(tech.read, t) + w * classTail(tech.write, t));
}

/** Share of requests with write share `ws` that a node with a technology serves (not dropped). */
export function techServed(tech: TechFlowView, ws: number): number {
  const w = clamp01(ws);
  return clamp01((1 - w) * (1 - tech.read.dropProbability) + w * (1 - tech.write.dropProbability));
}

/**
 * P(hop > t) at any node: the class mix for a node with a technology, the
 * sojourn tail for every other (exactly `probSojournExceeds`).
 */
export function hopExceeds(flow: FlowView, t: number): number {
  return flow.tech ? techExceeds(flow.tech, flow.tech.ws, t) : probSojournExceeds(flow.st, t);
}

/** Bisection steps of `techPercentileMs`: fixed, so the result is deterministic. */
const BISECTION_STEPS = 64;

/** No class has a latency above this (its tail is below 1e-12 there). */
function upperBoundMs(cls: TechClassView): number {
  const n = cls.shape.kind === "one" ? 1 : cls.shape.n;
  return cls.addMs + cls.station.waitCapMs + cls.serviceTimeMs * (28 + Math.log(n));
}

/**
 * Hop latency percentile p at a node with a technology: the smallest t with
 * P(hop > t) ≤ 1 − p, by bisection with a fixed number of steps
 * (deterministic, and non-decreasing in p).
 */
export function techPercentileMs(tech: TechFlowView, p: number, ws = tech.ws): number {
  const target = 1 - Math.min(Math.max(p, 0), 1 - 1e-12);
  let lo = 0;
  let hi = Math.max(upperBoundMs(tech.read), upperBoundMs(tech.write));
  if (!Number.isFinite(hi) || !(hi > 0)) return 0;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (techExceeds(tech, ws, mid) <= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Mean hop latency at a node with a technology, ms. */
export function techMeanMs(tech: TechFlowView, ws = tech.ws): number {
  const mean = (cls: TechClassView) =>
    cls.serviceTimeMs * shapeMean(cls.shape) + cls.station.meanWaitMs + cls.addMs;
  const w = clamp01(ws);
  return (1 - w) * mean(tech.read) + w * mean(tech.write);
}

/* ---------- sampling (A.5) ---------- */

/** The class view the sampler needs (a `TechClassView` fits). */
export type SampleClass = Pick<TechClassView, "station" | "serviceTimeMs" | "shape" | "addMs">;

/**
 * One sampled latency of a class, ms: the service shape (one draw for `one`
 * and `max`, k for `kth`: Rényi's representation of the k-th of n
 * exponentials, S·Σ_{j=1..k} E_j/(n−j+1)), then ONE wait at its station
 * (D3), then `addMs`. Always finite (u = 0 gives 0).
 */
export function sampleClassMs(cls: SampleClass, rng: Rng): number {
  const s = cls.serviceTimeMs;
  const shape = cls.shape;
  let ms: number;
  if (shape.kind === "one") {
    ms = sampleExponential(rng, s);
  } else if (shape.kind === "kth") {
    let sum = 0;
    for (let j = 1; j <= shape.k; j++) sum += sampleExponential(rng, 1) / (shape.n - j + 1);
    ms = s * sum;
  } else {
    // Inverse CDF of the max of n: x = −ln(1 − u^(1/n)).
    const u = rng();
    ms = s * -Math.log(-Math.expm1(Math.log(u) / shape.n));
  }
  return ms + sampleWaitMs(cls.station, rng) + cls.addMs;
}
