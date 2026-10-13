import type { TechClass, Technology } from "./types";

/**
 * In-memory caches (Cache) on ElastiCache, cache.r6g (Graviton2), AWS
 * us-east-1 on-demand. At 1 KB values the node's baseline network caps the
 * sustained rate before the CPU, so both engines share the same ceilings.
 */

const CACHE = ["cache"] as const;

/** cache.r6g sizes: min(CPU, baseline network ÷ (1 KB + ~60 B)) ops/s; Redis OSS = Memcached price. */
function cacheR6gClasses(): TechClass[] {
  const sizes = [
    ["large", 2, 85_000, 0.206],
    ["xlarge", 4, 142_000, 0.411],
    ["2xlarge", 8, 284_000, 0.821],
    ["4xlarge", 16, 568_000, 1.642],
  ] as const;
  return sizes.map(([size, vCpu, capacity, perHour]) => ({
    id: `cache.r6g.${size}`,
    vCpu,
    capacityPerInstance: capacity,
    serviceTimeMs: 0.4,
    perInstanceHour: perHour,
    evidence: "derived",
  }));
}

const NODE_TYPES = {
  title: "Supported node types (Amazon ElastiCache docs)",
  url: "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/CacheNodes.SupportedTypes.html",
  year: 2026,
};

const ELASTICACHE_PRICE = {
  title: "AWS Price List API: AmazonElastiCache, us-east-1",
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/us-east-1/index.json",
  year: 2026,
};

const NETWORK_CEILING =
  "Sustained rate at 1 KB values: the node's baseline bandwidth ÷ (1 KB + ~60 B of protocol overhead), e.g. cache.r6g.large 0.75 Gbps ≈ 85k ops/s; short benchmarks run on burst bandwidth (10 Gbps) and show more. Non-pipelined GET/SET.";

export const CACHE_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "redis",
    componentIds: CACHE,
    defaultFor: CACHE,
    label: "Redis (ElastiCache)",
    short: "Redis",
    description:
      "In-memory data store: sub-millisecond key-value reads plus data structures (sorted sets, streams, pub/sub), with optional replicas.",
    consistency:
      "One primary per shard with asynchronous replicas: replica reads can be stale and a failover can lose the last acknowledged writes.",
    billing: "instance",
    classes: cacheR6gClasses(),
    defaultClass: "cache.r6g.xlarge",
    params: {},
    sources: [
      {
        title: "Enhanced IO multiplexing for Amazon ElastiCache for Redis (AWS Database Blog)",
        url: "https://aws.amazon.com/blogs/database/enhanced-io-multiplexing-for-amazon-elasticache-for-redis/",
        year: 2023,
      },
      NODE_TYPES,
      {
        title: "Redis on AWS Graviton2 (Arm community blog)",
        url: "https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/redis-on-aws-graviton2",
        year: 2021,
      },
      {
        title: "High availability using replication groups (Amazon ElastiCache docs)",
        url: "https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Replication.html",
        year: 2026,
      },
      ELASTICACHE_PRICE,
    ],
    assumptions: `${NETWORK_CEILING} The CPU goes further: AWS measured 349k ops/s on cache.r6g.xlarge (Redis 7.0, 80% GET, 512 B values); commands still run on one thread, and enhanced I/O spreads network work over the other vCPUs on nodes with 4 or more. The 0.4 ms service time matches AWS's 0.44 ms p50 on cache.r6g.xlarge at 142k rps. Pipelining raises throughput 5–10×. Redis OSS price (Valkey is 20% cheaper); each replica is another billed node.`,
  },
  {
    id: "memcached",
    componentIds: CACHE,
    label: "Memcached (ElastiCache)",
    short: "Memcached",
    description:
      "Multithreaded in-memory key-value cache: plain GET/SET, no persistence or replication; grows by adding nodes.",
    consistency:
      "No replication: each key lives on one node picked by client-side hashing; losing a node turns its keys into misses; last write wins.",
    billing: "instance",
    classes: cacheR6gClasses(),
    defaultClass: "cache.r6g.xlarge",
    params: {},
    sources: [
      {
        title: "Memcached benchmarking on AWS Graviton2: 50% p/p gains (Arm community blog)",
        url: "https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/memcached-benchmarking-aws-graviton2-50-p-p-gains",
        year: 2021,
      },
      NODE_TYPES,
      ELASTICACHE_PRICE,
    ],
    assumptions: `${NETWORK_CEILING} The network binds on every size: multithreaded memcached 1.6 measured 395k ops/s self-hosted on r6g.2xlarge (128 B values, 500 connections). The 0.4 ms service time is Redis's on the same nodes (0.44 ms p50 at about 70% load); memcached measured 1.27 ms p50 at saturation. Priced like Redis OSS.`,
  },
];
