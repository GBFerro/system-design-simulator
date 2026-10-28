import { finitePositive, MAX_INSTANCES, PARAM, technologyOf } from "../params";
import { CORE_PARAM, type Params } from "../types";
import { classOf } from "./index";
import type { TechQuota } from "./types";

/**
 * Technology profile of one node (component-technologies, design "Mecânicas
 * no motor", Apêndice A.1): what the engine and the advisor read about a
 * node with a technology, resolved once from its params. Pure data
 * (structured-clone safe: no functions, no Maps, no Infinity), so it travels
 * in the `SimGraph` to the engine worker. `generic` has no profile.
 *
 * Machine-bound numbers (stations, a node-bound hot partition) are stored as
 * the technology sets them and scaled at run time by the node's
 * capacity / service time over `base` (exactly 1 without a fault), so a
 * fault that slows the node slows them too; managed quotas don't scale.
 */

/** How a class's service time is drawn from its station's (A.5/A.6). */
export type LatencyShape =
  /** One service time. */
  | { kind: "one" }
  /** The k-th fastest of n replica replies (a quorum read or write). */
  | { kind: "kth"; k: number; n: number }
  /** The slowest of n shard replies (a fan-out query). */
  | { kind: "max"; n: number };

/** The resource that limits a node with a technology (TEC-40). */
export type TechLimitKind =
  | "capacity"
  | "read-capacity"
  | "write-primary"
  | "replica-ops"
  | "primaries"
  | "hot-partition"
  | "query-capacity"
  | "prefix-limit"
  | "account-throttle"
  | "queue-throughput"
  | "consumers"
  | "consumers-partitions";

/** Where one request class (read or write) goes and what it costs there. */
export interface ClassRoute {
  /** Index into `TechClasses.stations`. */
  station: number;
  /** Station operations one request consumes (a QUORUM read on RF 3: 2). */
  cost: number;
  /** Service time of the class ÷ the station's. */
  serviceScale: number;
  shape: LatencyShape;
  /** Fixed extra latency, ms (MongoDB's majority write concern). */
  addMs: number;
}

/** A pool of identical servers some classes queue at. */
export interface TechStation {
  instances: number;
  /** Operations per second per instance, before the run-time scale. */
  capacityPerInstance: number;
  /** Mean service time of one operation, ms, before the run-time scale. */
  serviceTimeMs: number;
  limit: TechLimitKind;
  /** Adding instances adds capacity here (the advisor offers "scale out" only then). */
  scalesWithInstances: boolean;
}

// SPEC_DEVIATION: design.md A.1 has `primary?` + `mainLimit` beside an
// implicit station 0 of (n, k₀, S₀).
// Reason: MongoDB's two stations (primaries and secondaries) have neither n
// instances, so every station is listed with its own instances and limit.
export interface TechClasses {
  read: ClassRoute;
  write: ClassRoute;
  /** Station 0 holds the node's own backlog in the tick; one or two stations. */
  stations: readonly TechStation[];
}

/** A documented or benchmarked ceiling; the excess fails (TEC-35/37/38). */
export interface QuotaThrottle {
  kind: "quota";
  limit: TechLimitKind;
  /** Reads per second (already × prefixes). Absent = no read limit. */
  readRps?: number;
  /** Writes per second (already × prefixes). Absent = no write limit. */
  writeRps?: number;
  /** Reads and writes together per second. Absent = no shared limit. */
  sharedRps?: number;
  /** Token bucket above `sharedRps` (tick only; `analyze()` uses the steady rate). */
  burst?: number;
}

/**
 * The busiest partition gets `share` of the requests and serves at most
 * `readUnits` / `writeUnits` per second, read and write units adding up
 * (DynamoDB's 3,000 RCU / 1,000 WCU; replica ops of the partition's nodes).
 */
export interface PartitionThrottle {
  kind: "partition";
  share: number;
  /** Units one read costs (DynamoDB 0.5 eventual / 1 strong; Cassandra k). */
  readCost: number;
  writeCost: number;
  readUnits: number;
  writeUnits: number;
  /** The units are machine capacity (scale with the node) rather than a managed quota. */
  nodeBound: boolean;
}

export type TechThrottle = QuotaThrottle | PartitionThrottle;

/**
 * The copies of one store's data and what a read or a write must reach: the
 * CAP behavior of a node under a replica loss, resolved from its params.
 */
export interface TechReplicaSet {
  /** Copies of the set (RF, instances, members per shard). */
  replicas: number;
  /** Copies a consistent read must reach. */
  readQuorum: number;
  /** Copies a write must reach. */
  writeQuorum: number;
  /** A read may return from a lagging copy even with the whole set up. */
  eventualReads: boolean;
}

export interface TechProfile {
  technology: string;
  /** The node's own capacity and service time: run-time scale = node.x / base.x. */
  base: { capacityPerInstance: number; serviceTimeMs: number };
  /** Read and write routes over the stations; absent = the generic station. */
  classes?: TechClasses;
  throttle?: TechThrottle;
  /** Data stores: the copies of the set and the quorums a request must reach. */
  replicaSet?: TechReplicaSet;
  /** Kafka: consumers of one group beyond the partition count sit idle. */
  consumerCap?: number;
}

/** What a profile is scaled against: the node as faults left it (`SimNode` fits). */
export interface TechCore {
  instances: number;
  capacityPerInstance: number;
  serviceTimeMs: number;
}

/**
 * A managed service quota limits the node, not a queue: its station gets
 * this many times the quota, so admitted requests never wait to speak of
 * (at the quota, utilization 1/4).
 */
// SPEC_DEVIATION: design.md A.2 keeps the generic station (n, k₀, S₀) behind
// a quota. Reason: the catalog's managed capacity IS the quota (S3 5,500,
// API Gateway 10,000, SNS 30,000, SQS FIFO 3,000), so admitted traffic at the
// quota would saturate the station (ρ = 1) and queue, and S3 with 2 prefixes
// would still drop reads (T27 expects 0 errors there).
export const QUOTA_HEADROOM = 4;

/** Smallest cost a class may have (keeps every division finite). */
const MIN_COST = 1e-6;
const MAX_REPLICATION = 7;
const MAX_SHARDS = 1024;
const MAX_PREFIXES = 1000;
const MAX_PARTITIONS = 10_000;
const MAX_REPLICAS = 10;

function num(params: Params, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Whole number in [min, max]; non-finite → `fallback`. */
function clampInt(params: Params, key: string, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.round(num(params, key, fallback))));
}

function share(params: Params, key: string, fallback: number): number {
  return Math.min(1, Math.max(0, num(params, key, fallback)));
}

const ONE: LatencyShape = { kind: "one" };

function route(station: number, cost: number, shape: LatencyShape = ONE, addMs = 0): ClassRoute {
  return { station, cost: Math.max(MIN_COST, cost), serviceScale: 1, shape, addMs };
}

/** Replicas a consistency level waits for out of `rf` (TEC-29). */
export function quorumOf(level: unknown, rf: number): number {
  if (level === "one") return 1;
  if (level === "all") return rf;
  return Math.floor(rf / 2) + 1;
}

/**
 * The profile of a node with a technology, or undefined for `generic` (and
 * an id the type doesn't offer). Clamps what it reads (TEC-48): RF 1–7,
 * k ≤ RF, shards 1–1024, prefixes 1–1000, costs ≥ 1e-6, capacities finite
 * and positive.
 */
export function techProfileOf(componentId: string, params: Params): TechProfile | undefined {
  const tech = technologyOf(componentId, params);
  if (!tech) return undefined;
  const n = clampInt(params, CORE_PARAM.instances, 1, MAX_INSTANCES, 1);
  const k0 = finitePositive(num(params, CORE_PARAM.capacityPerInstance, 1), 1);
  const s0 = finitePositive(num(params, CORE_PARAM.serviceTimeMs, 1), 1);
  const profile: TechProfile = {
    technology: tech.id,
    base: { capacityPerInstance: k0, serviceTimeMs: s0 },
  };
  const mechanics = tech.mechanics;
  if (!mechanics) return profile;
  const scales = tech.billing === "instance";
  const node = (limit: TechLimitKind, instances = n): TechStation => ({
    instances,
    capacityPerInstance: k0,
    serviceTimeMs: s0,
    limit,
    scalesWithInstances: scales,
  });
  const hot = share(params, PARAM.hotPartitionShare, 0);

  switch (mechanics.kind) {
    case "sql-primary": {
      // A read replica takes reads only: no primary in it.
      if (componentId !== "sql-db") return profile;
      const shards = clampInt(params, PARAM.shards, 1, MAX_SHARDS, 1);
      profile.classes = {
        read: route(0, 1),
        write: route(1, 1),
        stations: [
          node("read-capacity"),
          {
            instances: shards,
            capacityPerInstance: finitePositive(num(params, PARAM.writeCapacityRps, k0), k0),
            serviceTimeMs: finitePositive(num(params, PARAM.writeServiceTimeMs, s0), s0),
            limit: "write-primary",
            scalesWithInstances: false,
          },
        ],
      };
      return profile;
    }
    case "replica-quorum": {
      const rf = clampInt(params, PARAM.replicationFactor, 1, MAX_REPLICATION, 3);
      const k = Math.min(rf, Math.max(1, quorumOf(params[PARAM.consistencyLevel], rf)));
      // The coordinator waits for k of RF replies, reads and writes alike (D1).
      const shape: LatencyShape = { kind: "kth", k, n: rf };
      const replicas = Math.min(rf, n);
      profile.classes = {
        read: route(0, k, shape),
        write: route(0, rf, shape),
        stations: [node("replica-ops")],
      };
      profile.throttle = {
        kind: "partition",
        share: hot,
        readCost: k,
        writeCost: rf,
        readUnits: replicas * k0,
        writeUnits: replicas * k0,
        nodeBound: true,
      };
      // ONE reads one copy, so it can return a value a lagging copy still has;
      // QUORUM/ALL wait for enough copies to be consistent (CAP behavior).
      profile.replicaSet = {
        replicas,
        readQuorum: k,
        writeQuorum: k,
        eventualReads: params[PARAM.consistencyLevel] === "one",
      };
      return profile;
    }
    case "dynamo": {
      const units = mechanics.perPartition ?? { readUnits: 3_000, writeUnits: 1_000 };
      const cost = mechanics.readUnitCost ?? { eventual: 0.5, strong: 1 };
      profile.classes = { read: route(0, 1), write: route(0, 1), stations: [node("capacity")] };
      profile.throttle = {
        kind: "partition",
        share: hot,
        readCost: Math.max(
          MIN_COST,
          params[PARAM.readConsistency] === "strong" ? cost.strong : cost.eventual,
        ),
        writeCost: 1,
        readUnits: units.readUnits,
        writeUnits: units.writeUnits,
        nodeBound: false,
      };
      return profile;
    }
    case "mongo": {
      // One primary per shard; the other members are secondaries (D4).
      const shards = Math.min(n, clampInt(params, PARAM.shards, 1, MAX_SHARDS, 1));
      const secondaries = n - shards;
      const primaries: TechStation = { ...node("primaries", shards), scalesWithInstances: false };
      const stations =
        secondaries > 0 ? [node("read-capacity", secondaries), primaries] : [primaries];
      const primary = stations.length - 1;
      const toSecondaries =
        params[PARAM.readPreference] === "secondaryPreferred" && secondaries > 0;
      // A shard without secondaries has nobody to replicate to.
      const majority = params[PARAM.writeConcern] === "majority" && secondaries > 0;
      const membersPerShard = n / shards;
      profile.classes = {
        read: route(toSecondaries ? 0 : primary, 1),
        write: route(primary, 1, ONE, majority ? (mechanics.replicationRttMs ?? 0) : 0),
        stations,
      };
      profile.throttle = {
        kind: "partition",
        share: hot,
        readCost: 1,
        writeCost: 1,
        readUnits: toSecondaries ? Math.max(1, membersPerShard - 1) * k0 : k0,
        writeUnits: k0,
        nodeBound: true,
      };
      return profile;
    }
    case "search-fanout": {
      const shards = clampInt(params, PARAM.shards, 1, MAX_SHARDS, 1);
      const copies = shards * (clampInt(params, PARAM.replicas, 0, MAX_REPLICAS, 1) + 1);
      // A query goes to one copy of every shard; only nodes holding copies serve (TEC-36).
      // Indexing a document works on every copy of its shard, about
      // `indexCostPerDoc` shard queries each, in CPU and in time.
      const indexCost = Math.max(MIN_COST, (copies / shards) * (mechanics.indexCostPerDoc ?? 1));
      profile.classes = {
        read: route(0, shards, shards > 1 ? { kind: "max", n: shards } : ONE),
        write: { ...route(0, indexCost), serviceScale: indexCost },
        stations: [
          {
            ...node("query-capacity", Math.min(n, copies)),
            scalesWithInstances: n < copies,
          },
        ],
      };
      return profile;
    }
    case "quota": {
      const quota = classOf(tech, String(params[PARAM.instanceClass]))?.quota ?? mechanics.quota;
      if (!quota) return profile;
      const throttle = quotaThrottle(componentId, quota, params);
      const ceiling = throttle.sharedRps ?? (throttle.readRps ?? 0) + (throttle.writeRps ?? 0);
      const station = scales
        ? node("capacity")
        : {
            ...node("capacity"),
            capacityPerInstance: Math.max(k0, ceiling * QUOTA_HEADROOM),
          };
      profile.classes = { read: route(0, 1), write: route(0, 1), stations: [station] };
      profile.throttle = throttle;
      return profile;
    }
    case "kafka":
      profile.consumerCap = clampInt(params, PARAM.partitions, 1, MAX_PARTITIONS, 1);
      return profile;
    default:
      return profile;
  }
}

function quotaThrottle(componentId: string, quota: TechQuota, params: Params): QuotaThrottle {
  const prefixes = quota.perPrefix ? clampInt(params, PARAM.prefixes, 1, MAX_PREFIXES, 1) : 1;
  const limit: TechLimitKind = quota.perPrefix
    ? "prefix-limit"
    : componentId === "api-gateway"
      ? "account-throttle"
      : "queue-throughput";
  const scaled = (v: number | undefined) =>
    v !== undefined && v > 0 && Number.isFinite(v) ? { value: v * prefixes } : undefined;
  const read = scaled(quota.readRps);
  const write = scaled(quota.writeRps);
  const shared = scaled(quota.sharedRps);
  const burst = scaled(quota.burst);
  return {
    kind: "quota",
    limit,
    ...(read ? { readRps: read.value } : {}),
    ...(write ? { writeRps: write.value } : {}),
    ...(shared ? { sharedRps: shared.value } : {}),
    ...(burst ? { burst: burst.value } : {}),
  };
}

/** Run-time capacity scale: the node's capacity per instance over the profile's base. */
export function capScaleOf(profile: TechProfile, core: TechCore): number {
  const scale = core.capacityPerInstance / profile.base.capacityPerInstance;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Run-time service-time scale: the node's service time over the profile's base. */
export function timeScaleOf(profile: TechProfile, core: TechCore): number {
  const scale = core.serviceTimeMs / profile.base.serviceTimeMs;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * A station as the node runs it now: capacity and service time scaled with
 * the node (a station with the node's own numbers gets exactly the node's).
 */
export function scaledStation(
  profile: TechProfile,
  station: TechStation,
  core: TechCore,
): { instances: number; capacityPerInstance: number; serviceTimeMs: number } {
  return {
    instances: station.instances,
    capacityPerInstance:
      core.capacityPerInstance * (station.capacityPerInstance / profile.base.capacityPerInstance),
    serviceTimeMs: core.serviceTimeMs * (station.serviceTimeMs / profile.base.serviceTimeMs),
  };
}
