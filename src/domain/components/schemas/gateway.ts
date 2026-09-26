import type { ParamSpec, Params } from "../types";
import {
  builtInAutoscaleSpecs,
  limitRpsSpec,
  maxQueueSpec,
  overLimitSpec,
  p99Spec,
  PARAM,
  retrySpecs,
  timeoutSpec,
} from "../params";
import { catalogLatencyMs, defineSchema } from "./define";
import { p99For } from "./service";

const tokenBucket = (p: Params) => p[PARAM.rateLimitAlgorithm] === "token-bucket";

function algorithmSpec(visibleIf?: ParamSpec["visibleIf"]): ParamSpec {
  return {
    key: PARAM.rateLimitAlgorithm,
    label: "Algorithm",
    kind: "enum",
    default: "token-bucket",
    options: [
      { value: "token-bucket", label: "Token bucket" },
      { value: "sliding-window", label: "Sliding window" },
      { value: "fixed-window", label: "Fixed window" },
    ],
    group: "capacity",
    help: "Token bucket allows short bursts; sliding window is smooth; fixed window lets up to 2× through at window edges.",
    visibleIf,
  };
}

function burstSpec(visibleIf: ParamSpec["visibleIf"]): ParamSpec {
  return {
    key: PARAM.burst,
    label: "Burst",
    kind: "number",
    default: 5000,
    min: 0,
    step: 100,
    group: "capacity",
    help: "Bucket size: requests allowed at once above the steady rate (AWS API Gateway defaults: 10,000 rps, 5,000 burst).",
    visibleIf,
  };
}

/** Standalone rate limiter: output = min(λ, limit), the excess is rejected or queued. */
export const rateLimiterSchema = defineSchema("rate-limiter", "rate-limiter", [
  limitRpsSpec(),
  algorithmSpec(),
  burstSpec(tokenBucket),
  overLimitSpec(),
  {
    ...maxQueueSpec(1000, "resilience"),
    help: "Excess requests held for later; above this they are rejected.",
    visibleIf: (p) => p[PARAM.overLimitAction] === "queue",
  },
]);

/**
 * API gateway: routes like a service (edges by rule) with optional built-in
 * throttling. `rateLimitEnabled` gates `limitRps`/`burst`/`overLimitAction`.
 */
const throttled = (p: Params) => p[PARAM.rateLimitEnabled] === true;

export const apiGatewaySchema = defineSchema("api-gateway", "service", [
  {
    key: PARAM.rateLimitEnabled,
    label: "Throttling",
    kind: "boolean",
    default: false,
    group: "capacity",
    help: "Enforce a request-rate limit at the gateway (429 above it).",
  },
  limitRpsSpec(throttled),
  algorithmSpec(throttled),
  burstSpec((p) => throttled(p) && tokenBucket(p)),
  overLimitSpec(throttled),
  ...builtInAutoscaleSpecs(),
  p99Spec(p99For(catalogLatencyMs("api-gateway"))),
  timeoutSpec(
    29_000,
    "How long the gateway waits for the backend (AWS API Gateway REST default: 29 s).",
  ),
  ...retrySpecs(),
  maxQueueSpec(),
]);
