import { hitRateSpec, PARAM, ttlSpec } from "../params";
import { defineSchema } from "./define";

/** In-memory cache (Redis/Memcached): misses become calls down `on_miss` edges. */
export const cacheSchema = defineSchema("cache", "cache", [
  hitRateSpec(
    0.9,
    "Share of reads served from memory; misses go down on_miss edges (usually to the database).",
  ),
  {
    key: PARAM.writeStrategy,
    label: "Write strategy",
    kind: "enum",
    default: "cache-aside",
    options: [
      { value: "cache-aside", label: "Cache-aside" },
      { value: "write-through", label: "Write-through" },
      { value: "write-behind", label: "Write-behind" },
    ],
    group: "resilience",
    help: "Cache-aside: the app fills the cache on a miss. Write-through: write cache and DB synchronously. Write-behind: write the cache, flush to the DB later (can lose data).",
  },
  ttlSpec(300, "Entry lifetime; a shorter TTL means fresher data and a lower hit rate."),
  {
    key: PARAM.memoryGb,
    label: "Memory per node",
    kind: "number",
    default: 16,
    min: 0.5,
    max: 1024,
    step: 1,
    unit: "GB",
    group: "advanced",
    help: "The hot working set must fit in memory, or evictions drag the hit rate down.",
  },
  {
    key: PARAM.evictionPolicy,
    label: "Eviction",
    kind: "enum",
    default: "lru",
    options: [
      { value: "lru", label: "LRU (least recently used)" },
      { value: "lfu", label: "LFU (least frequently used)" },
    ],
    group: "advanced",
    help: "Which keys go when memory is full. LFU keeps long-lived hot keys through one-off scans.",
  },
  {
    key: PARAM.stampedeProtection,
    label: "Stampede protection",
    kind: "boolean",
    default: false,
    group: "advanced",
    help: "Coalesce concurrent misses on a key (lock or single-flight) so one request refills it instead of all of them hitting the DB.",
  },
]);
