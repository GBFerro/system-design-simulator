import type { TechClass, Technology } from "./types";

/**
 * Search and object storage, AWS us-east-1 on-demand: Amazon OpenSearch
 * Service on r6g data nodes (per instance-hour) and S3 Standard (per request).
 */

const SEARCH = ["search"] as const;
const OBJECT_STORAGE = ["object-storage"] as const;

/** r6g.*.search data nodes: ≈ 250 simple shard queries per second per vCPU. */
const OPENSEARCH_CLASSES: TechClass[] = (
  [
    ["large", 2, 500, 0.167],
    ["xlarge", 4, 1_000, 0.335],
    ["2xlarge", 8, 2_000, 0.669],
    ["4xlarge", 16, 4_000, 1.339],
  ] as const
).map(([size, vCpu, capacity, perHour]) => ({
  id: `r6g.${size}.search`,
  vCpu,
  capacityPerInstance: capacity,
  serviceTimeMs: 3,
  perInstanceHour: perHour,
  evidence: "estimate",
}));

export const STORAGE_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "opensearch",
    componentIds: SEARCH,
    defaultFor: SEARCH,
    label: "OpenSearch (AWS)",
    short: "OpenSearch",
    description:
      "Full-text search and analytics engine: an inverted index split into shards, with every query fanned out to all of them.",
    consistency:
      "Near real-time: a document becomes searchable after the next refresh (1 s by default); a GET by id is real-time.",
    cap: "ap",
    billing: "instance",
    classes: OPENSEARCH_CLASSES,
    defaultClass: "r6g.xlarge.search",
    params: { shards: 5, replicas: 1 },
    mechanics: { kind: "search-fanout", indexCostPerDoc: 0.1 },
    sources: [
      {
        title:
          "An update on the OpenSearch Project's continued performance progress through version 2.11",
        url: "https://opensearch.org/blog/opensearch-performance-improvements/",
        year: 2024,
      },
      {
        title: "Elasticsearch thread pool settings (search pool sizing, inherited by OpenSearch)",
        url: "https://www.elastic.co/docs/reference/elasticsearch/configuration-reference/thread-pool-settings",
        year: 2025,
      },
      {
        title: "Choosing the number of shards (Amazon OpenSearch Service docs)",
        url: "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp-sharding.html",
        year: 2026,
      },
      {
        title:
          "OpenSearch Optimized Instance (OR1) is game changing for indexing performance and cost (AWS Big Data Blog)",
        url: "https://aws.amazon.com/blogs/big-data/opensearch-optimized-instance-or1-is-game-changing-for-indexing-performance-and-cost/",
        year: 2024,
      },
      {
        title: "OpenSearch index settings (index.refresh_interval)",
        url: "https://docs.opensearch.org/2.13/install-and-configure/configuring-opensearch/index-settings/",
        year: 2024,
      },
      {
        title: "AWS Price List API: AmazonES, us-east-1",
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonES/current/us-east-1/index.json",
        year: 2026,
      },
    ],
    assumptions:
      "No authoritative queries-per-node figure exists (benchmark workloads run at fixed target rates), so capacity is an estimate: about 3 ms of CPU per simple term query on one shard, with a search thread pool of 1.5 × vCPU + 1, gives ≈ 250 shard queries per second per vCPU. A query goes to one copy of every shard and waits for the slowest (p90 measured at 3.4 ms on 1 shard, 6.45 ms on 3 shards over 3 nodes). Full-text matches with aggregations cost 10–100× more. Indexing a ~1 KB document on one shard copy costs about 0.1 shard query: derived from 110k docs/s with 1 replica on 6 × r6g.4xlarge at about 90% CPU (≈ 2.3k document copies per vCPU) against 250 queries per vCPU. Defaults: 5 primary shards with 1 replica, the OpenSearch Service default. EBS storage ($0.122/GB-month) not modeled.",
  },
  {
    id: "s3",
    componentIds: OBJECT_STORAGE,
    defaultFor: OBJECT_STORAGE,
    label: "S3 Standard",
    short: "S3",
    description:
      "AWS object storage: durable blobs by key, effectively unlimited space, and a request rate that grows with key prefixes.",
    consistency:
      "Strong read-after-write consistency for PUTs of new and overwritten objects and for LISTs, since December 2020.",
    cap: "cp",
    billing: "managed",
    managed: {
      capacityPerInstance: 5_500,
      serviceTimeMs: 30,
      evidence: "derived",
      perMillionReads: 0.4,
      perMillionWrites: 5,
    },
    params: { prefixes: 1 },
    mechanics: {
      kind: "quota",
      quota: { readRps: 5_500, writeRps: 3_500, perPrefix: true },
    },
    sources: [
      {
        title: "Best practices design patterns: optimizing Amazon S3 performance (AWS docs)",
        url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html",
        year: 2026,
      },
      {
        title: "Performance design patterns for Amazon S3 (AWS docs)",
        url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-design-patterns.html",
        year: 2026,
      },
      {
        title:
          "Amazon S3 now delivers strong read-after-write consistency automatically for all applications (What's New)",
        url: "https://aws.amazon.com/about-aws/whats-new/2020/12/amazon-s3-now-delivers-strong-read-after-write-consistency-automatically-for-all-applications/",
        year: 2020,
      },
      {
        title: "AWS Price List API: AmazonS3, us-east-1",
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json",
        year: 2026,
      },
    ],
    assumptions:
      'At least 5,500 GET/HEAD and 3,500 PUT/COPY/POST/DELETE requests per second per partitioned prefix, with no limit on the number of prefixes; S3 scales gradually and returns 503 Slow Down until it has. A node starts at one prefix. The 30 ms service time is derived from AWS\'s "median latencies are often in the tens of milliseconds" for requests under 512 KB (first byte of larger objects: 100–200 ms). $0.40 per million GETs, $5.00 per million PUTs; storage ($0.023/GB-month) and transfer not modeled.',
  },
];
