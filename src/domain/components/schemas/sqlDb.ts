import { PARAM } from "../params";
import { defineSchema } from "./define";

/**
 * SQL database. `instances` is the primary plus in-node replicas; model
 * replicas as Read Replica nodes to route reads explicitly. Writes only go
 * to the primary, so write capacity never grows with replicas.
 */
export const sqlDbSchema = defineSchema(
  "sql-db",
  "fixed",
  [
    {
      key: PARAM.writeCapacityRps,
      label: "Write capacity",
      kind: "number",
      default: 3000,
      min: 1,
      step: 100,
      unit: "rps",
      group: "capacity",
      help: "Writes per second the primary sustains (bounded by WAL fsync). Replicas add no write capacity; sharding does.",
    },
    {
      key: PARAM.connectionPool,
      label: "Connection pool",
      kind: "number",
      default: 100,
      min: 1,
      max: 10_000,
      step: 10,
      group: "capacity",
      help: "Max concurrent connections (PostgreSQL's max_connections defaults to 100). An exhausted pool queues requests.",
    },
    {
      key: PARAM.shards,
      label: "Shards",
      kind: "number",
      default: 1,
      min: 1,
      max: 256,
      step: 1,
      group: "capacity",
      help: "Horizontal partitions, each with its own primary. Multiplies write capacity; cross-shard joins get expensive.",
    },
    {
      key: PARAM.writeServiceTimeMs,
      label: "Write service time",
      kind: "duration",
      default: 15,
      min: 0.1,
      step: 1,
      unit: "ms",
      group: "latency",
      help: "Writes cost more than reads: WAL fsync on commit plus index updates.",
    },
    {
      key: PARAM.failoverSec,
      label: "Failover time",
      kind: "duration",
      default: 60,
      min: 1,
      max: 3600,
      step: 5,
      unit: "s",
      group: "resilience",
      help: "Time to promote a standby when the primary fails; writes fail until then. Amazon RDS Multi-AZ failovers typically take 60–120 s. With a single instance there is nothing to promote.",
    },
  ],
  {
    instances: { help: "Primary plus in-node replicas. Only the primary takes writes." },
    capacityPerInstance: {
      label: "Read capacity per instance",
      help: "Simple indexed reads per second one instance sustains.",
    },
    serviceTimeMs: { label: "Read service time" },
  },
);

/** Explicit read replica: receives `reads` edges and trails the primary. */
export const readReplicaSchema = defineSchema(
  "read-replica",
  "fixed",
  [
    {
      key: PARAM.replicationLagMs,
      label: "Replication lag",
      kind: "duration",
      default: 100,
      min: 0,
      max: 3_600_000,
      step: 10,
      unit: "ms",
      group: "latency",
      help: "How stale replica reads are. Aurora replicas typically lag under 100 ms; async MySQL/PostgreSQL replicas can fall seconds behind under heavy writes.",
    },
  ],
  {
    instances: { help: "Replicas in this pool; reads are spread across them." },
    capacityPerInstance: { label: "Read capacity per instance" },
    serviceTimeMs: { label: "Read service time" },
  },
);
