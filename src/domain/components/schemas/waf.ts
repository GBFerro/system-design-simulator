import { PARAM } from "../params";
import { defineSchema } from "./define";

/** Web Application Firewall: fixed inspection latency plus a block rate. */
export const wafSchema = defineSchema(
  "waf",
  "fixed",
  [
    {
      key: PARAM.blockRate,
      label: "Block rate",
      kind: "percent",
      default: 0.01,
      min: 0,
      max: 1,
      step: 0.005,
      group: "capacity",
      help: "Share of requests blocked (injection attempts, bad bots, rate-based rules). Blocked requests never reach the origin.",
    },
  ],
  {
    serviceTimeMs: {
      label: "Inspection latency",
      help: "Time spent evaluating the rule set on each request.",
    },
  },
);
