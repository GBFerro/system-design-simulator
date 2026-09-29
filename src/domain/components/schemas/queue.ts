import { PARAM } from "../params";
import type { ParamSpec } from "../types";
import { defineSchema } from "./define";

function consumersSpec(def: number, min: number, help: string): ParamSpec {
  return {
    key: PARAM.consumers,
    label: "Consumers",
    kind: "number",
    default: def,
    min,
    max: 1000,
    step: 1,
    group: "capacity",
    help,
  };
}

function depthSpec(): ParamSpec {
  return {
    key: PARAM.maxQueue,
    label: "Max depth",
    kind: "number",
    default: 1_000_000,
    min: 0,
    step: 1000,
    group: "capacity",
    help: "Backlog above this is dropped. Lag ≈ depth ÷ consumption rate.",
  };
}

function retentionSpec(def: number, help: string): ParamSpec {
  return {
    key: PARAM.retentionHours,
    label: "Retention",
    kind: "duration",
    default: def,
    min: 1,
    max: 8760,
    step: 1,
    unit: "h",
    group: "advanced",
    help,
  };
}

function queueParams(): ParamSpec[] {
  return [
    consumersSpec(
      4,
      1,
      "Parallel consumers draining the backlog. In Kafka, consumers beyond the partition count sit idle.",
    ),
    depthSpec(),
    {
      key: PARAM.partitions,
      label: "Partitions",
      kind: "number",
      default: 6,
      min: 1,
      max: 10_000,
      step: 1,
      group: "capacity",
      help: "Unit of parallelism and ordering: order is only kept within a partition.",
    },
    {
      key: PARAM.deliverySemantics,
      label: "Delivery",
      kind: "enum",
      default: "at-least-once",
      options: [
        { value: "at-most-once", label: "At-most-once" },
        { value: "at-least-once", label: "At-least-once" },
        { value: "exactly-once", label: "Exactly-once" },
      ],
      group: "resilience",
      help: "At-least-once can redeliver, so consumers must be idempotent. Exactly-once (e.g. Kafka transactions) costs throughput.",
    },
    {
      key: PARAM.maxDeliveryAttempts,
      label: "Max delivery attempts",
      kind: "number",
      default: 5,
      min: 1,
      max: 100,
      step: 1,
      group: "resilience",
      help: "Deliveries before a failing message moves to the DLQ (SQS maxReceiveCount).",
    },
    retentionSpec(
      168,
      "How long messages are kept (Kafka's default is 7 days = 168 h; SQS defaults to 4 days, max 14).",
    ),
  ];
}

export const messageQueueSchema = defineSchema("message-queue", "queue", queueParams());

export const pubSubSchema = defineSchema("pub-sub", "queue", queueParams(), {
  capacityPerInstance: { help: "Messages published per second; every subscriber gets each one." },
});

/** Dead-letter queue: a parking lot, usually with no consumer until someone redrives it. */
export const dlqSchema = defineSchema("dlq", "queue", [
  consumersSpec(
    0,
    0,
    "Usually 0: messages wait for inspection or a manual redrive. Alert when DLQ depth > 0.",
  ),
  depthSpec(),
  retentionSpec(
    336,
    "Keep dead letters longer than the source queue (14 days = 336 h, the SQS maximum).",
  ),
]);
