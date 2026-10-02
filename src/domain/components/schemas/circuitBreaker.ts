import { PARAM, timeoutSpec } from "../params";
import { defineSchema } from "./define";

/**
 * Circuit breaker. Defaults follow Resilience4j's CircuitBreakerConfig (and
 * TimeLimiter for the timeout). The tick loop runs the closed → open →
 * half-open machine (`engine/core/breaker.ts`); `analyze()` sees it closed.
 */
export const circuitBreakerSchema = defineSchema("circuit-breaker", "breaker", [
  timeoutSpec(
    1000,
    "Calls slower than this are cut off and count as failures, so a slow dependency trips the breaker too.",
  ),
  {
    key: PARAM.errorThreshold,
    label: "Failure threshold",
    kind: "percent",
    default: 0.5,
    min: 0.01,
    max: 1,
    step: 0.05,
    group: "resilience",
    help: "Failure rate (errors + timeouts) that opens the circuit; open means fail fast instead of waiting for the timeout.",
  },
  {
    key: PARAM.openDurationSec,
    label: "Open duration",
    kind: "duration",
    default: 60,
    min: 1,
    max: 3600,
    step: 5,
    unit: "s",
    group: "resilience",
    help: "Time the circuit stays open before letting probe calls through (half-open).",
  },
  {
    key: PARAM.halfOpenProbes,
    label: "Half-open probes",
    kind: "number",
    default: 10,
    min: 1,
    max: 1000,
    step: 1,
    group: "resilience",
    help: "Trial calls allowed while half-open; if they succeed the circuit closes, otherwise it opens again.",
  },
  {
    key: PARAM.minimumCalls,
    label: "Minimum calls",
    kind: "number",
    default: 100,
    min: 1,
    max: 10_000,
    step: 10,
    group: "advanced",
    help: "Calls in the window before the failure rate is evaluated, so a few early errors don't trip it.",
  },
]);
