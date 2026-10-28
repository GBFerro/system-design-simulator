/**
 * Technologies of the central component types (component-technologies,
 * TEC-10): real products with benchmark capacity, latency, price, sources
 * and the constants of the engine mechanics that set them apart. Pure data.
 */

import type { Params } from "../types";

/**
 * How the row's capacity and service time were obtained (TEC-05). A row takes
 * the weakest label among the numbers it sets: a measured quota with an
 * estimated service time is an "estimate". Prices are read from the AWS price
 * list and don't lower the label.
 * - measured: printed in the cited source (benchmark, AWS docs, quota page)
 * - derived: computed from measurements with the normalization in `assumptions`
 * - estimate: no published figure; the reasoning is in `assumptions`
 */
export type Evidence = "measured" | "derived" | "estimate";

export interface TechSource {
  title: string;
  /** Always https. */
  url: string;
  /** Year published, or read when the page is undated. */
  year: number;
}

/** One instance size of a technology billed per instance-hour. */
export interface TechClass {
  /** The provider's class name, e.g. "db.r6g.xlarge". */
  id: string;
  vCpu: number;
  /** Req/s one instance sustains (reads, queries or replica ops, per the technology). */
  capacityPerInstance: number;
  /** Mean service time, ms. */
  serviceTimeMs: number;
  /** USD per instance-hour, AWS us-east-1 on-demand. */
  perInstanceHour: number;
  /** Params this class sets on top of the technology's (e.g. writeCapacityRps). */
  params?: Params;
  /** A ceiling that grows with the class (RabbitMQ's per-queue limit); overrides `mechanics.quota`. */
  quota?: TechQuota;
  evidence: Evidence;
}

/** A documented or benchmarked ceiling; the excess fails (TEC-35/37/38). */
export interface TechQuota {
  /** Reads per second (DynamoDB: read request units). */
  readRps?: number;
  /** Writes per second (DynamoDB: write request units). */
  writeRps?: number;
  /** Requests per second, reads and writes together. */
  sharedRps?: number;
  /** Token-bucket size above the steady rate. */
  burst?: number;
  /** The limits apply per key prefix and multiply by the `prefixes` param (S3). */
  perPrefix?: boolean;
}

export type TechMechanicsKind =
  | "sql-primary"
  | "replica-quorum"
  | "dynamo"
  | "mongo"
  | "search-fanout"
  | "quota"
  | "kafka"
  | "none";

/** Constants of the engine mechanics, read by the technology profile. */
export interface TechMechanics {
  kind: TechMechanicsKind;
  /** Request units one partition serves per second (DynamoDB 3,000 read / 1,000 write). */
  perPartition?: { readUnits: number; writeUnits: number };
  /** Read request units per read, by read consistency (DynamoDB 0.5 / 1). */
  readUnitCost?: { eventual: number; strong: number };
  quota?: TechQuota;
  /** Extra write latency of a majority write concern (MongoDB `w: "majority"`), ms. */
  replicationRttMs?: number;
  /** Search: cost of indexing one document on one shard copy, in shard queries. */
  indexCostPerDoc?: number;
}

/** Capacity, latency and prices of a managed service billed per request. */
export interface ManagedSpec {
  /** Req/s the node sustains (a service quota where one applies). */
  capacityPerInstance: number;
  /** Mean service time, ms. */
  serviceTimeMs: number;
  evidence: Evidence;
  /** USD per hour per resource (a load balancer), never multiplied by `instances`. */
  perHour?: number;
  /** USD per month per resource. */
  baseMonthly?: number;
  /** USD per million reads (per million read request units where `mechanics.readUnitCost` is set). */
  perMillionReads: number;
  /** USD per million writes (per million write request units for DynamoDB). */
  perMillionWrites: number;
}

export interface Technology {
  /** kebab-case, stored in `params.technology`. */
  id: string;
  /** The component types that offer it, e.g. ["sql-db", "read-replica"]. */
  componentIds: readonly string[];
  /** The types whose new nodes start with it (the default technology). */
  defaultFor?: readonly string[];
  /** Select label, with the mode when there is one: "PostgreSQL (RDS)", "DynamoDB (on-demand)". */
  label: string;
  /** Canvas tag, without the layer: "Postgres", "ALB" (the tag adds " · L7"). */
  short: string;
  /** Load balancers: the OSI layer they balance at; the select shows "AWS NLB (L4)". */
  layer?: "L4" | "L7";
  /** One line: what it is for. */
  description: string;
  /** One line: its consistency model / CAP classification. */
  consistency: string;
  /**
   * CAP label for the UI only. The behavior under a replica loss comes from the
   * params (`TechReplicaSet`: read/write quorums and eventual reads), never
   * from this label.
   */
  cap?: "cp" | "ap" | "none";
  billing: "instance" | "managed";
  /** billing "instance": its sizes, smallest first. */
  classes?: readonly TechClass[];
  /** billing "instance": the class a new node gets. */
  defaultClass?: string;
  /** billing "managed": capacity, latency and per-request prices. */
  managed?: ManagedSpec;
  /** Params the technology sets (failoverSec, partitions, consistencyLevel…). */
  params: Params;
  /** Restricted enum options, by param key (an NLB only flow-hashes). */
  options?: Partial<Record<string, readonly string[]>>;
  /** Omitted = no mechanics beyond capacity and latency. */
  mechanics?: TechMechanics;
  sources: readonly TechSource[];
  /** Benchmark workload, normalization and what's left out. */
  assumptions: string;
}
