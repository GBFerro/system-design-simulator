import { lbAlgorithmSpec, PARAM } from "../params";
import { defineSchema } from "./define";

/** Health-check defaults follow AWS ALB target groups (30 s, 2 to fail, 5 to recover). */
export const loadBalancerSchema = defineSchema("load-balancer", "lb", [
  lbAlgorithmSpec(),
  {
    key: PARAM.healthCheckIntervalSec,
    label: "Health check interval",
    kind: "duration",
    default: 30,
    min: 1,
    max: 300,
    step: 1,
    unit: "s",
    group: "resilience",
    help: "Time between probes. A dead target keeps getting traffic for about interval × unhealthy threshold.",
  },
  {
    key: PARAM.unhealthyThreshold,
    label: "Unhealthy threshold",
    kind: "number",
    default: 2,
    min: 1,
    max: 10,
    step: 1,
    group: "resilience",
    help: "Consecutive failed checks before a target is taken out of rotation.",
  },
  {
    key: PARAM.healthyThreshold,
    label: "Healthy threshold",
    kind: "number",
    default: 5,
    min: 1,
    max: 10,
    step: 1,
    group: "advanced",
    help: "Consecutive passed checks before a recovered target gets traffic again.",
  },
]);
