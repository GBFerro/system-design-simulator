import { PARAM } from "../params";
import { defineTechSchema, shownFor } from "./define";

const ID = "nosql-db";
/** Tunable-consistency stores: ONE/QUORUM/ALL over the replication factor (TEC-29). */
const QUORUM_STORES = shownFor(ID, ["cassandra", "scylladb"], true);
const MONGODB = shownFor(ID, ["mongodb"], false);

/** Partitioned NoSQL store: a hot partition caps the throughput. */
export const nosqlDbSchema = defineTechSchema(ID, "fixed", [
  {
    key: PARAM.partitions,
    label: "Partitions",
    kind: "number",
    default: 10,
    min: 1,
    max: 10_000,
    step: 1,
    group: "capacity",
    help: "Data is spread by partition key. Throughput scales with partitions only if keys are spread evenly.",
  },
  {
    key: PARAM.hotPartitionShare,
    label: "Hottest partition share",
    kind: "percent",
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.01,
    group: "capacity",
    help: "Share of traffic on the busiest partition (uniform = 1 ÷ partitions). A celebrity key pushes it up and caps throughput.",
  },
  {
    key: PARAM.replicationFactor,
    label: "Replication factor",
    kind: "number",
    default: 3,
    min: 1,
    max: 7,
    step: 1,
    group: "resilience",
    help: "Copies of every item; 3 is the usual choice (e.g. one per availability zone).",
    visibleIf: QUORUM_STORES,
  },
  {
    key: PARAM.consistencyLevel,
    label: "Consistency level",
    kind: "enum",
    default: "quorum",
    options: [
      { value: "one", label: "ONE" },
      { value: "quorum", label: "QUORUM" },
      { value: "all", label: "ALL" },
    ],
    group: "resilience",
    help: "Replicas that must answer. QUORUM reads + QUORUM writes (R + W > RF) read your own writes; ONE is fastest; ALL fails if any replica is down.",
    visibleIf: QUORUM_STORES,
  },
  {
    key: PARAM.readConsistency,
    label: "Read consistency",
    kind: "enum",
    default: "eventual",
    options: [
      { value: "eventual", label: "Eventually consistent" },
      { value: "strong", label: "Strongly consistent" },
    ],
    group: "resilience",
    help: "A strongly consistent read returns the latest write but costs twice the read units (1 instead of 0.5 per item up to 4 KB).",
    visibleIf: shownFor(ID, ["dynamodb"], false),
  },
  {
    key: PARAM.shards,
    label: "Shards",
    kind: "number",
    default: 1,
    min: 1,
    max: 1024,
    step: 1,
    group: "capacity",
    help: "Replica sets the data is split over; each has one primary that takes its writes. Instances are spread evenly over the shards.",
    visibleIf: MONGODB,
  },
  {
    key: PARAM.readPreference,
    label: "Read preference",
    kind: "enum",
    default: "primary",
    options: [
      { value: "primary", label: "primary" },
      { value: "secondaryPreferred", label: "secondaryPreferred" },
    ],
    group: "resilience",
    help: "primary: every read goes to a shard's primary (latest data). secondaryPreferred: reads spread over the secondaries and may be stale.",
    visibleIf: MONGODB,
  },
  {
    key: PARAM.writeConcern,
    label: "Write concern",
    kind: "enum",
    default: "majority",
    options: [
      { value: "1", label: "w: 1" },
      { value: "majority", label: "w: majority" },
    ],
    group: "resilience",
    help: "majority (the default since MongoDB 5.0) waits for most members to have the write, so it survives a failover; w: 1 answers after the primary alone.",
    visibleIf: MONGODB,
  },
]);
