import { ttlSpec } from "../params";
import { defineSchema } from "./define";

export const dnsSchema = defineSchema(
  "dns",
  "fixed",
  [
    ttlSpec(
      300,
      "How long resolvers cache the answer. Lower = faster failover, more lookups (300 s is a common record TTL).",
    ),
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
