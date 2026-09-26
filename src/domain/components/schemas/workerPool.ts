import { catalogLatencyMs, defineSchema } from "./define";
import { serviceParams } from "./service";

/**
 * Worker pool: consumes a queue. Throughput = workers × per-worker rate,
 * where the per-worker rate ≈ concurrency × 1000 ÷ processing time.
 */
export const workerPoolSchema = defineSchema(
  "worker-pool",
  "service",
  serviceParams(catalogLatencyMs("worker-pool"), {
    timeoutMs: 20_000,
    timeoutHelp:
      "Max time per job. Keep it below the queue's visibility timeout (SQS default: 30 s), or the message is redelivered while still being processed.",
  }),
  {
    instances: { label: "Workers", help: "Worker processes/pods pulling from the queue." },
    capacityPerInstance: {
      label: "Jobs per second per worker",
      help: "≈ concurrency (threads per worker) × 1000 ÷ processing time.",
    },
    serviceTimeMs: { label: "Processing time", help: "Mean time to process one job." },
  },
);
