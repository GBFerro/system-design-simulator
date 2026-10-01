import type { PricingSpec } from "./types";

/**
 * Price table (Spec 10, CST-01). One versioned table, reviewed each release;
 * nothing is fetched live (there is no backend). Prices are approximate AWS
 * on-demand list prices in us-east-1 (Linux, no reserved or savings-plan
 * discounts), rounded: estimates for learning, not a quote.
 */
export const PRICE_TABLE = {
  version: 1,
  /** When the list prices were taken. Review it, and the sources, each release. */
  asOf: "2025-09",
  region: "AWS us-east-1, on-demand",
  /** The official pricing pages every figure below comes from. */
  sources: [
    { label: "EC2 On-Demand", url: "https://aws.amazon.com/ec2/pricing/on-demand/" },
    { label: "RDS for PostgreSQL", url: "https://aws.amazon.com/rds/postgresql/pricing/" },
    { label: "ElastiCache", url: "https://aws.amazon.com/elasticache/pricing/" },
    { label: "CloudFront", url: "https://aws.amazon.com/cloudfront/pricing/" },
    { label: "Route 53", url: "https://aws.amazon.com/route53/pricing/" },
    {
      label: "Elastic Load Balancing",
      url: "https://aws.amazon.com/elasticloadbalancing/pricing/",
    },
    { label: "API Gateway", url: "https://aws.amazon.com/api-gateway/pricing/" },
    { label: "WAF", url: "https://aws.amazon.com/waf/pricing/" },
    { label: "S3", url: "https://aws.amazon.com/s3/pricing/" },
    { label: "EFS", url: "https://aws.amazon.com/efs/pricing/" },
    { label: "SQS", url: "https://aws.amazon.com/sqs/pricing/" },
    { label: "SNS", url: "https://aws.amazon.com/sns/pricing/" },
    { label: "SES", url: "https://aws.amazon.com/ses/pricing/" },
    { label: "MSK", url: "https://aws.amazon.com/msk/pricing/" },
    { label: "OpenSearch Service", url: "https://aws.amazon.com/opensearch-service/pricing/" },
    { label: "Neptune", url: "https://aws.amazon.com/neptune/pricing/" },
    { label: "Redshift", url: "https://aws.amazon.com/redshift/pricing/" },
    { label: "CloudWatch", url: "https://aws.amazon.com/cloudwatch/pricing/" },
  ],
} as const;

/** A fleet of instances of one size, nothing billed per request. */
function instances(perInstanceHour: number, assumptions: string): PricingSpec {
  return { perInstanceHour, baseMonthly: 0, perMillionRequests: 0, assumptions };
}

/** A managed service billed per request (plus a fixed monthly part). */
function perRequest(perMillionRequests: number, assumptions: string, baseMonthly = 0): PricingSpec {
  return { perInstanceHour: 0, baseMonthly, perMillionRequests, assumptions };
}

const FREE = (assumptions: string): PricingSpec => perRequest(0, assumptions);

const GENERAL_PURPOSE = instances(0.096, "m5.large (2 vCPU, 8 GiB) ≈ $0.096/h per instance.");

/** Every catalog type; ids missing here (custom components) use `DEFAULT_PRICING`. */
const PRICING: Record<string, PricingSpec> = {
  client: FREE("The users' own devices and networks: no infrastructure cost."),
  dns: perRequest(
    0.4,
    "Route 53: $0.50 per hosted zone per month plus $0.40 per million standard queries. Only uncached lookups reach the resolver and are billed.",
    0.5,
  ),
  cdn: perRequest(
    1.0,
    "CloudFront: ≈ $0.01 per 10,000 HTTPS requests (US/Europe) = $1.00 per million. Data transfer out (≈ $0.085/GB for the first 10 TB) is not included: the simulator doesn't model bytes.",
  ),
  "origin-shield": perRequest(
    0.75,
    "CloudFront Origin Shield: ≈ $0.0075 per 10,000 requests that reach the shield (US/Europe).",
  ),
  "load-balancer": {
    perInstanceHour: 0.0225,
    baseMonthly: 0,
    perMillionRequests: 0.03,
    assumptions:
      "Application Load Balancer: $0.0225 per hour per load balancer plus $0.008 per LCU-hour. An LCU covers 1 GB processed per hour: at ≈ 4 KB per request that's ≈ $0.03 per million requests.",
  },
  "api-gateway": instances(
    0.17,
    "Self-managed gateway (Kong, Envoy) on c5.xlarge (4 vCPU) ≈ $0.17/h per instance. A managed AWS API Gateway bills per request instead: $1.00 (HTTP API) to $3.50 (REST API) per million.",
  ),
  "rate-limiter": instances(
    0.085,
    "Limiter instances on c5.large (2 vCPU) ≈ $0.085/h each. A Redis holding the counters is priced on its own Cache node, if you draw one.",
  ),
  waf: perRequest(
    0.6,
    "AWS WAF: $5 per web ACL per month plus $1 per rule per month (10 rules assumed) plus $0.60 per million requests inspected.",
    15,
  ),
  "reverse-proxy": instances(0.085, "NGINX or Envoy on c5.large (2 vCPU) ≈ $0.085/h per instance."),
  "app-server": GENERAL_PURPOSE,
  "auth-service": GENERAL_PURPOSE,
  "worker-pool": instances(0.096, "Workers on m5.large (2 vCPU, 8 GiB) ≈ $0.096/h per instance."),
  "websocket-server": instances(
    0.192,
    "m5.xlarge (4 vCPU, 16 GiB) ≈ $0.192/h per instance: memory holds the open connections.",
  ),
  "task-scheduler": GENERAL_PURPOSE,
  "stream-processor": instances(
    0.34,
    "Flink or Kafka Streams workers on c5.2xlarge (8 vCPU) ≈ $0.34/h per instance.",
  ),
  "notification-service": {
    perInstanceHour: 0.096,
    baseMonthly: 0,
    perMillionRequests: 0.5,
    assumptions:
      "Orchestrator on m5.large ≈ $0.096/h per instance plus mobile push through Amazon SNS at $0.50 per million. Email (SES, $0.10 per 1,000) and SMS cost far more per message.",
  },
  custom: instances(
    0.096,
    "Priced like a general-purpose m5.large (2 vCPU, 8 GiB) ≈ $0.096/h per instance.",
  ),
  "sql-db": instances(
    0.45,
    "RDS for PostgreSQL db.r6g.xlarge (4 vCPU, 32 GiB), single-AZ ≈ $0.45/h per instance; Multi-AZ doubles it. Storage (≈ $0.115/GB-month for gp2) is not modeled.",
  ),
  "read-replica": instances(
    0.45,
    "Same class as the primary: db.r6g.xlarge ≈ $0.45/h per replica. Replication within one AZ is free.",
  ),
  "nosql-db": instances(
    0.312,
    "Self-managed Cassandra or ScyllaDB on i3.xlarge (4 vCPU, 30.5 GiB, local NVMe) ≈ $0.312/h per node. DynamoDB on demand bills per request instead.",
  ),
  cache: instances(
    0.21,
    "ElastiCache for Redis cache.r6g.large (2 vCPU, 13 GiB) ≈ $0.21/h per node.",
  ),
  "object-storage": perRequest(
    0.4,
    "S3 Standard: $0.0004 per 1,000 GET requests = $0.40 per million. PUTs cost $0.005 per 1,000 ($5 per million) and storage $0.023/GB-month, neither modeled separately.",
  ),
  search: instances(
    0.167,
    "OpenSearch Service r6g.large.search (2 vCPU, 16 GiB) ≈ $0.167/h per data node; EBS storage not modeled.",
  ),
  "graph-db": instances(0.348, "Neptune db.r5.large (2 vCPU, 16 GiB) ≈ $0.348/h per instance."),
  "timeseries-db": instances(
    0.192,
    "Self-managed InfluxDB or TimescaleDB on m5.xlarge (4 vCPU, 16 GiB) ≈ $0.192/h per instance.",
  ),
  "data-warehouse": instances(
    1.086,
    "Redshift ra3.xlplus (4 vCPU, 32 GiB) ≈ $1.086/h per node; managed storage ($0.024/GB-month) not modeled.",
  ),
  "vector-db": instances(
    0.2016,
    "Self-managed Milvus or Qdrant on r6g.xlarge (4 vCPU, 32 GiB) ≈ $0.20/h per instance.",
  ),
  "geospatial-index": instances(
    0.21,
    "Redis GEO on ElastiCache cache.r6g.large ≈ $0.21/h per node.",
  ),
  "file-store": perRequest(
    2.0,
    "EFS with elastic throughput: reads at $0.03/GB, so ≈ $2 per million 64 KB reads. Storage ($0.30/GB-month) is not modeled.",
  ),
  "message-queue": instances(
    0.21,
    "Amazon MSK (Kafka) kafka.m5.large ≈ $0.21/h per broker; broker storage not modeled.",
  ),
  "pub-sub": perRequest(
    0.5,
    "Amazon SNS: $0.50 per million publishes; deliveries to SQS and Lambda subscribers are free.",
  ),
  dlq: perRequest(
    1.2,
    "SQS standard: $0.40 per million API requests, and each message takes about three (send, receive, delete).",
  ),
  "service-mesh": instances(
    0.096,
    "Control plane (istiod) on m5.large ≈ $0.096/h per instance; the sidecars' CPU is paid by the services they run beside.",
  ),
  monitoring: instances(
    0.192,
    "Self-hosted Prometheus/Loki on m5.xlarge ≈ $0.192/h per instance. Managed log ingestion (CloudWatch Logs, $0.50/GB) can dominate at scale: sample logs and traces.",
  ),
  autoscaler: FREE("AWS Auto Scaling itself is free: you pay for the instances it adds."),
  "service-discovery": instances(0.096, "Consul or etcd servers on m5.large ≈ $0.096/h each."),
  "distributed-lock": instances(
    0.096,
    "etcd or ZooKeeper members on m5.large ≈ $0.096/h each (run 3 or 5 for a quorum).",
  ),
  "coordination-service": instances(
    0.096,
    "ZooKeeper or etcd members on m5.large ≈ $0.096/h each (run 3 or 5 for a quorum).",
  ),
  "config-service": instances(0.096, "Config servers on m5.large ≈ $0.096/h each."),
  "circuit-breaker": FREE(
    "A library or proxy feature in the caller (Resilience4j, Envoy): no instances of its own.",
  ),
  "id-generator": instances(
    0.085,
    "Snowflake-style generators on c5.large (2 vCPU) ≈ $0.085/h each.",
  ),
  "sharded-counter": instances(
    0.21,
    "Redis shards on ElastiCache cache.r6g.large ≈ $0.21/h per shard node.",
  ),
};

/** Custom components (and unknown ids from old saves): a general-purpose instance. */
export const DEFAULT_PRICING: PricingSpec = PRICING.custom;

/** The price of a component type (never undefined). */
export function pricingFor(componentId: string): PricingSpec {
  return PRICING[componentId] ?? DEFAULT_PRICING;
}

/** Ids with their own entry in the table (catalog tests check every catalog id has one). */
export function hasOwnPricing(componentId: string): boolean {
  return Object.hasOwn(PRICING, componentId);
}
