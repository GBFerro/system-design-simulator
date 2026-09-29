import { PARAM } from "../params";
import { defineSchema } from "./define";

/** Partitioned NoSQL store: a hot partition caps the throughput. */
export const nosqlDbSchema = defineSchema("nosql-db", "fixed", [
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
  },
]);
