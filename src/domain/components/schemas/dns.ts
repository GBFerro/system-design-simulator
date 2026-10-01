import { PARAM, ttlSpec } from "../params";
import { defineSchema } from "./define";

export const dnsSchema = defineSchema(
  "dns",
  "fixed",
  [
    ttlSpec(
      300,
      "How long resolvers cache the answer. Lower = faster failover, more lookups (300 s is a common record TTL).",
    ),
    {
      key: PARAM.lookupShare,
      label: "Uncached lookups",
      kind: "percent",
      default: 0.01,
      min: 0,
      max: 1,
      step: 0.01,
      group: "advanced",
      help: "Share of requests that pay a fresh resolution. Browsers, the OS and resolvers cache the answer for the TTL, so most requests never reach DNS; only this share adds lookup time and load.",
    },
  ],
  {
    serviceTimeMs: {
      label: "Lookup time",
      help: "Uncached resolution time; resolver and OS caches hide it on repeat visits.",
    },
    availability: {
      default: 0.9999,
      help: "A DNS outage stops every new client from reaching you; Route 53 backs its DNS with a 100% SLA.",
    },
  },
);
