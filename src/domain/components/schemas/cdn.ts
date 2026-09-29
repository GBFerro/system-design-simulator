import { hitRateSpec, ttlSpec } from "../params";
import { defineSchema } from "./define";

export const cdnSchema = defineSchema(
  "cdn",
  "cache",
  [
    hitRateSpec(
      0.9,
      "Share of requests answered at the edge; misses go to the origin via on_miss edges. Static assets usually reach 85–95%+.",
    ),
    ttlSpec(
      86_400,
      "Edge cache lifetime (Cache-Control max-age). Fingerprinted static assets can use a year.",
    ),
  ],
  {
    serviceTimeMs: {
      label: "Edge latency",
      help: "Time to answer a hit from the nearest PoP.",
    },
  },
);

/** Mid-tier cache between the CDN edges and the origin. */
export const originShieldSchema = defineSchema("origin-shield", "cache", [
  hitRateSpec(
    0.8,
    "Share of edge misses the shield answers; only the rest reach the origin (request collapsing merges concurrent misses).",
  ),
  ttlSpec(86_400, "Shield cache lifetime; usually matches the edge TTL."),
]);
