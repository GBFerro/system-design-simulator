import { PARAM } from "../params";
import { defineSchema } from "./define";

/** Object storage: fixed-capacity service; throughput scales with key prefixes. */
export const objectStorageSchema = defineSchema("object-storage", "fixed", [], {
  capacityPerInstance: {
    label: "Request rate",
    help: "S3 sustains at least 3,500 writes and 5,500 reads per second per key prefix; spread keys across prefixes to go higher.",
  },
  serviceTimeMs: {
    label: "First-byte latency",
    help: "Typical time to first byte for a small object (tens of ms); large objects add transfer time.",
  },
  availability: {
    default: 0.9999,
    help: "S3 Standard is designed for 99.99% availability (and 11 nines of durability).",
  },
});

/** Search cluster. Shard/replica defaults match Elasticsearch 7+ (1 primary, 1 replica). */
export const searchSchema = defineSchema("search", "fixed", [
  {
    key: PARAM.shards,
    label: "Primary shards",
    kind: "number",
    default: 1,
    min: 1,
    max: 1024,
    step: 1,
    group: "capacity",
    help: "Splits the index; queries fan out to every shard (scatter-gather). Fixed at index creation.",
  },
  {
    key: PARAM.replicas,
    label: "Replicas per shard",
    kind: "number",
    default: 1,
    min: 0,
    max: 10,
    step: 1,
    group: "resilience",
    help: "Copies of each shard: more read throughput and survive node loss, at the cost of indexing work.",
  },
]);
