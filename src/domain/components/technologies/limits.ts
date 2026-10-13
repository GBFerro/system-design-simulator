import { TECHNOLOGIES } from "./index";
import {
  capScaleOf,
  scaledStation,
  type PartitionThrottle,
  type TechCore,
  type TechLimitKind,
  type TechProfile,
} from "./profile";

/**
 * The resource that limits a node with a technology, and how busy it is
 * (component-technologies, TEC-40/41/42). Pure: the engine (analyze and the
 * tick) and the advisor call it on the same offered demand, so the node card,
 * the status and the advisor read the same number.
 */

/** Requests per second offered to the node, by class. */
export interface ClassDemand {
  read: number;
  write: number;
}

export interface TechLimit {
  kind: TechLimitKind;
  /** Offered demand ÷ capacity of the busiest resource (can exceed 1). */
  utilization: number;
  /** Requests per second the node takes at this mix before that resource is full. */
  capacityRps: number;
  /** Adding instances would add capacity to that resource. */
  scalesWithInstances: boolean;
}

/** What the node card names the resource (TEC-40). */
export const LIMIT_LABELS: Record<TechLimitKind, string> = {
  capacity: "Capacity",
  "read-capacity": "Read capacity",
  "write-primary": "Write primary",
  "replica-ops": "Replica operations",
  primaries: "Primaries",
  "hot-partition": "Hot partition",
  "query-capacity": "Query capacity",
  "prefix-limit": "S3 prefix limit",
  "account-throttle": "Account throttle",
  "queue-throughput": "Queue throughput",
  consumers: "Consumers",
  "consumers-partitions": "Consumers capped by partitions",
};

/**
 * Load of the hottest partition in units of what it serves (D2): it gets
 * `share` of the requests, and its read and write units add up. Node-bound
 * units (replica ops) scale with the node's capacity.
 */
export function partitionUtilization(
  throttle: PartitionThrottle,
  demand: ClassDemand,
  capScale: number,
): number {
  const scale = throttle.nodeBound ? capScale : 1;
  return (
    throttle.share *
    ((demand.read * throttle.readCost) / (throttle.readUnits * scale) +
      (demand.write * throttle.writeCost) / (throttle.writeUnits * scale))
  );
}

interface Resource {
  kind: TechLimitKind;
  utilization: number;
  scalesWithInstances: boolean;
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Every resource of the node in a fixed order: the throttle (quota or hot
 * partition) first, then the stations from the last to the first (a
 * primary before the node's own pool); on a tie the earlier one wins.
 */
function resources(profile: TechProfile, core: TechCore, demand: ClassDemand): Resource[] {
  const list: Resource[] = [];
  const throttle = profile.throttle;
  if (throttle?.kind === "quota") {
    const quota = (kind: TechLimitKind, d: number, limit: number | undefined) => {
      if (limit !== undefined)
        list.push({ kind, utilization: d / limit, scalesWithInstances: false });
    };
    quota(throttle.limit, demand.read + demand.write, throttle.sharedRps);
    quota(throttle.limit, demand.read, throttle.readRps);
    quota(throttle.limit, demand.write, throttle.writeRps);
  } else if (throttle?.kind === "partition") {
    list.push({
      kind: "hot-partition",
      utilization: partitionUtilization(throttle, demand, capScaleOf(profile, core)),
      scalesWithInstances: false,
    });
  }
  const classes = profile.classes;
  if (!classes) {
    const billing = TECHNOLOGIES.find((t) => t.id === profile.technology)?.billing;
    list.push({
      kind: "capacity",
      utilization: (demand.read + demand.write) / (core.instances * core.capacityPerInstance),
      scalesWithInstances: billing === "instance",
    });
    return list;
  }
  for (let i = classes.stations.length - 1; i >= 0; i--) {
    const station = classes.stations[i];
    const ops =
      (classes.read.station === i ? demand.read * classes.read.cost : 0) +
      (classes.write.station === i ? demand.write * classes.write.cost : 0);
    const run = scaledStation(profile, station, core);
    list.push({
      kind: station.limit,
      utilization: ops / (run.instances * run.capacityPerInstance),
      scalesWithInstances: station.scalesWithInstances,
    });
  }
  return list;
}

function busiest(list: readonly Resource[]): Resource {
  let top = list[0];
  for (const r of list) if (finiteOr(r.utilization, 0) > finiteOr(top.utilization, 0)) top = r;
  return top;
}

/**
 * The limiting resource on the OFFERED demand (D5): each resource's demand
 * over its capacity, the largest wins. With no demand the utilization is 0
 * and the kind and capacity are the ones at an even read/write mix.
 */
export function techLimitOf(profile: TechProfile, core: TechCore, demand: ClassDemand): TechLimit {
  const read = Math.max(0, finiteOr(demand.read, 0));
  const write = Math.max(0, finiteOr(demand.write, 0));
  const total = read + write;
  if (total > 0) {
    const top = busiest(resources(profile, core, { read, write }));
    const utilization = Math.max(0, finiteOr(top.utilization, 0));
    return {
      kind: top.kind,
      utilization,
      capacityRps: utilization > 0 ? finiteOr(total / utilization, 0) : 0,
      scalesWithInstances: top.scalesWithInstances,
    };
  }
  const nominal = busiest(resources(profile, core, { read: 0.5, write: 0.5 }));
  const perRequest = finiteOr(nominal.utilization, 0);
  return {
    kind: nominal.kind,
    utilization: 0,
    capacityRps: perRequest > 0 ? finiteOr(1 / perRequest, 0) : 0,
    scalesWithInstances: nominal.scalesWithInstances,
  };
}
