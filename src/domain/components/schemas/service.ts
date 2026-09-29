import { builtInAutoscaleSpecs, maxQueueSpec, p99Spec, retrySpecs, timeoutSpec } from "../params";
import type { ComponentSchema, ParamSpec } from "../types";
import { catalogLatencyMs, defineSchema } from "./define";

/** Exponential service times: p99 = ln(100) × mean ≈ 4.6 × mean. */
export function p99For(meanMs: number): number {
  return Math.round(meanMs * Math.log(100) * 10) / 10;
}

/**
 * App Server / Service params: M/M/c per instance; timeouts and retries add
 * load. Concurrency is folded into "capacity per instance" (≈ concurrency ×
 * 1000 ÷ service time, by Little's law) so there is one source of truth.
 */
export function serviceParams(
  meanMs: number,
  opts: { timeoutMs?: number; timeoutHelp?: string; retries?: number } = {},
): ParamSpec[] {
  return [
    ...builtInAutoscaleSpecs(),
    p99Spec(p99For(meanMs)),
    timeoutSpec(opts.timeoutMs ?? 1000, opts.timeoutHelp),
    ...retrySpecs(opts.retries ?? 0),
    maxQueueSpec(),
  ];
}

function serviceSchema(id: string, opts?: { timeoutMs?: number }): ComponentSchema {
  return defineSchema(id, "service", serviceParams(catalogLatencyMs(id), opts), {
    capacityPerInstance: {
      help: "Requests per second one instance sustains (≈ concurrency × 1000 ÷ service time).",
    },
  });
}

export const appServerSchema = serviceSchema("app-server");
export const authServiceSchema = serviceSchema("auth-service");
export const websocketServerSchema = serviceSchema("websocket-server");
// Fan-out to external providers (APNs/FCM/SES) is slow: give it more room
export const notificationServiceSchema = serviceSchema("notification-service", {
  timeoutMs: 5000,
});
export const taskSchedulerSchema = serviceSchema("task-scheduler", { timeoutMs: 30_000 });
export const streamProcessorSchema = serviceSchema("stream-processor");
export const customSchema = serviceSchema("custom");
