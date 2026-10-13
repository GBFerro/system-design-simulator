import type { TechClass, Technology } from "./types";

/**
 * Message queues and pub/sub, AWS us-east-1 on-demand. Kafka (MSK) and
 * RabbitMQ (Amazon MQ) bill per broker-hour; SQS and SNS per message, with
 * documented throughput quotas.
 */

const QUEUE = ["message-queue"] as const;
const PUB_SUB = ["pub-sub"] as const;

const SQS_PRICING = {
  title: "Amazon SQS pricing",
  url: "https://aws.amazon.com/sqs/pricing/",
  year: 2026,
};

const SQS_MESSAGE_QUOTAS = {
  title: "Amazon SQS message quotas (AWS docs)",
  url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html",
  year: 2026,
};

/** kafka.m7g sizes: per-broker sustained ingress at 1 KB per message. */
const KAFKA_CLASSES: TechClass[] = (
  [
    ["large", 2, 21_000, 0.204],
    ["xlarge", 4, 41_700, 0.408],
    ["2xlarge", 8, 66_700, 0.816],
    ["4xlarge", 16, 66_700, 1.632],
  ] as const
).map(([size, vCpu, capacity, perHour]) => ({
  id: `kafka.m7g.${size}`,
  vCpu,
  capacityPerInstance: capacity,
  serviceTimeMs: 5,
  perInstanceHour: perHour,
  evidence: "estimate",
}));

/** mq.m7g sizes: per-broker aggregate and per-queue ceiling, msgs/s at 1 KB on quorum queues. */
const RABBITMQ_CLASSES: TechClass[] = (
  [
    ["large", 2, 19_500, 15_000, 0.2734],
    ["xlarge", 4, 39_000, 20_000, 0.5467],
    ["2xlarge", 8, 78_000, 20_000, 1.0934],
    ["4xlarge", 16, 185_000, 20_000, 2.1869],
  ] as const
).map(([size, vCpu, capacity, perQueue, perHour]) => ({
  id: `mq.m7g.${size}`,
  vCpu,
  capacityPerInstance: capacity,
  serviceTimeMs: 25,
  perInstanceHour: perHour,
  quota: { sharedRps: perQueue },
  evidence: "estimate",
}));

export const MESSAGING_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "sns",
    componentIds: PUB_SUB,
    defaultFor: PUB_SUB,
    label: "Amazon SNS",
    short: "SNS",
    description:
      "AWS's managed pub/sub: pushes every published message to all of a topic's subscriptions (SQS, Lambda, HTTP, email, mobile).",
    consistency:
      "At-least-once with best-effort ordering: subscribers can get duplicates or out-of-order messages; each message is stored in several AZs before the publish returns.",
    billing: "managed",
    managed: {
      capacityPerInstance: 30_000,
      serviceTimeMs: 20,
      evidence: "estimate",
      perMillionReads: 0.5,
      perMillionWrites: 0.5,
    },
    params: {},
    mechanics: { kind: "quota", quota: { sharedRps: 30_000 } },
    sources: [
      {
        title: "Amazon SNS endpoints and quotas (AWS docs)",
        url: "https://docs.aws.amazon.com/general/latest/gr/sns.html",
        year: 2026,
      },
      {
        title: "Amazon SNS pricing",
        url: "https://aws.amazon.com/sns/pricing/",
        year: 2026,
      },
      {
        title: "Amazon SNS FAQs",
        url: "https://aws.amazon.com/sns/faqs/",
        year: 2026,
      },
      {
        title: "Amazon SNS message delivery retries (AWS docs)",
        url: "https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html",
        year: 2026,
      },
    ],
    assumptions:
      "Publish quota in us-east-1: 30,000 messages per second per account (a soft limit; 9,000 in us-west-2 and eu-west-1, 300 in many Regions), counting Publish and PublishBatch on standard and FIFO topics; the excess is throttled. $0.50 per million publishes (each 64 KB chunk counts as one); delivery to SQS and Lambda is free, to HTTP $0.06 per 100,000. AWS publishes no delivery latency: the 20 ms publish time is an estimate in the API-latency class of SQS.",
  },
  {
    id: "kafka",
    componentIds: [...QUEUE, ...PUB_SUB],
    defaultFor: QUEUE,
    label: "Kafka (MSK)",
    short: "Kafka",
    description:
      "Distributed commit log: partitioned, replicated topics that consumers read at their own pace and can replay; built for high-throughput streams.",
    consistency:
      "Order only within a partition; acks=all with min.insync.replicas 2 survives a broker loss; at-least-once by default, exactly-once with idempotent producers and transactions.",
    billing: "instance",
    classes: KAFKA_CLASSES,
    defaultClass: "kafka.m7g.xlarge",
    params: { partitions: 6 },
    mechanics: { kind: "kafka" },
    sources: [
      {
        title:
          "Best practices for right-sizing your Apache Kafka clusters to optimize performance and cost (AWS Big Data Blog)",
        url: "https://aws.amazon.com/blogs/big-data/best-practices-for-right-sizing-your-apache-kafka-clusters-to-optimize-performance-and-cost/",
        year: 2022,
      },
      {
        title: "Best practices for Standard brokers (Amazon MSK docs)",
        url: "https://docs.aws.amazon.com/msk/latest/developerguide/bestpractices.html",
        year: 2026,
      },
      {
        title: "Default Amazon MSK configuration (AWS docs)",
        url: "https://docs.aws.amazon.com/msk/latest/developerguide/msk-default-configuration.html",
        year: 2026,
      },
      {
        title:
          "Benchmarking Apache Kafka, Apache Pulsar, and RabbitMQ: Which is the Fastest? (Confluent)",
        url: "https://www.confluent.io/blog/kafka-fastest-messaging-system/",
        year: 2020,
      },
      {
        title: "AWS Price List API: AmazonMSK, us-east-1",
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/current/us-east-1/index.json",
        year: 2026,
      },
    ],
    assumptions:
      "Per-broker sustained ingress from AWS's MSK sizing formula (3 brokers, replication factor 3, 2 consumer groups, gp2 volumes over 334 GB, 80% headroom): cluster ingress of 63, 125, 200 and 200 MB/s for m7g.large to 4xlarge, ÷ 3 brokers, at 1 KB per message; the 4xlarge is storage-bound (400 MB/s with provisioned storage throughput). More consumer groups lower it (m7g.large: 63 MB/s with 2 groups, 35 with 6). A consumer group has at most one consumer per partition, so consumers beyond the partition count sit idle; 6 partitions is a starting point (MSK's default is 1). The 5 ms service time is an estimate (linger.ms ≈ 5 ms plus cross-AZ replication; p99 25–50 ms). As pub/sub, every consumer group reads every message. Storage not modeled.",
  },
  {
    id: "rabbitmq",
    componentIds: QUEUE,
    label: "RabbitMQ (Amazon MQ)",
    short: "RabbitMQ",
    description:
      "Message broker with exchanges, routing keys and per-message acks; quorum queues replicate each queue with Raft.",
    consistency:
      "Quorum queues go through a Raft leader: at-least-once with publisher confirms and consumer acks; FIFO per queue, but redeliveries can reorder.",
    billing: "instance",
    classes: RABBITMQ_CLASSES,
    defaultClass: "mq.m7g.xlarge",
    params: {},
    mechanics: { kind: "quota" },
    sources: [
      {
        title:
          "Improve RabbitMQ performance on Amazon MQ with AWS Graviton3-based M7g instances (AWS Big Data Blog)",
        url: "https://aws.amazon.com/blogs/big-data/improve-rabbitmq-performance-on-amazon-mq-with-aws-graviton3-based-m7g-instances/",
        year: 2025,
      },
      {
        title: "AMQP 1.0 Benchmarks (RabbitMQ blog)",
        url: "https://www.rabbitmq.com/blog/2024/08/21/amqp-benchmarks",
        year: 2024,
      },
      {
        title: "Quorum Queues (RabbitMQ 4.2 docs)",
        url: "https://www.rabbitmq.com/docs/4.2/quorum-queues",
        year: 2025,
      },
      {
        title: "RabbitMQ best practice for high performance (CloudAMQP)",
        url: "https://www.cloudamqp.com/blog/part2-rabbitmq-best-practice-for-high-performance.html",
        year: 2025,
      },
      {
        title: "Amazon MQ for RabbitMQ sizing guidelines (AWS docs)",
        url: "https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-sizing-guidelines.html",
        year: 2026,
      },
      {
        title: "AWS Price List API: AmazonMQ, us-east-1",
        url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMQ/current/us-east-1/index.json",
        year: 2026,
      },
    ],
    assumptions:
      'AWS publishes no absolute message rate for Amazon MQ, so every figure is an estimate. Per broker (3-node cluster, quorum queues, 1 KB messages, publisher confirms): estimated mq.m5 aggregates of 15k, 30k, 60k and 100k msgs/s, × 1.3 for m7g (× 1.85 at 4xlarge, AWS\'s "up to 85%"). A queue is one Erlang process on about one core, so one queue tops out near 15k msgs/s on large and 20k above, whatever the broker (single-node quorum-queue benchmarks: 10k–70k msgs/s with 12 B bodies). The 25 ms service time sits in the 15–35 ms p50 of quorum queues replicated across AZs. Price per broker; a 3-node cluster bills 3. Storage not modeled.',
  },
  {
    id: "sqs-standard",
    componentIds: QUEUE,
    label: "SQS Standard",
    short: "SQS",
    description:
      "AWS's managed message queue: nearly unlimited throughput; consumers poll, process and delete each message.",
    consistency:
      "At-least-once with best-effort ordering: a message can arrive twice or out of order, so consumers must be idempotent; stored across AZs.",
    billing: "managed",
    managed: {
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 20,
      evidence: "estimate",
      perMillionReads: 1.2,
      perMillionWrites: 1.2,
    },
    params: {},
    sources: [
      {
        title: "Amazon SQS standard queues (AWS docs)",
        url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html",
        year: 2026,
      },
      {
        title: "Amazon SQS standard queue quotas (AWS docs)",
        url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-queues.html",
        year: 2026,
      },
      SQS_MESSAGE_QUOTAS,
      SQS_PRICING,
      {
        title: "Amazon SQS FAQs",
        url: "https://www.amazonaws.cn/en/sqs/faqs/",
        year: 2026,
      },
    ],
    assumptions:
      'AWS: a "nearly unlimited number of API calls per second, per action"; 1,000,000 msgs/s is a planning cap, not a published figure. Price per message: send, receive and delete are three requests at $0.40 per million (first 100 billion a month), so $1.20 per million messages; each 64 KB chunk counts as a request, and batches of up to 10 cut it. Typical API latency is "in the tens or low hundreds of milliseconds" (SQS FAQ); the 20 ms send time is an estimate at the low end. Messages up to 1 MiB (older material says 256 KiB); about 120,000 in flight per queue; retention 4 days by default, 14 at most.',
  },
  {
    id: "sqs-fifo",
    componentIds: QUEUE,
    label: "SQS FIFO",
    short: "SQS FIFO",
    description:
      "AWS's ordered message queue: strict order per message group and deduplicated sends, at a capped rate.",
    consistency:
      "Strict order within a message group; a send retried within 5 minutes is deduplicated (exactly-once processing); parallelism comes from many groups.",
    billing: "managed",
    managed: {
      capacityPerInstance: 3_000,
      serviceTimeMs: 25,
      evidence: "estimate",
      perMillionReads: 1.5,
      perMillionWrites: 1.5,
    },
    params: {},
    mechanics: { kind: "quota", quota: { sharedRps: 3_000 } },
    sources: [
      {
        title: "High throughput for FIFO queues in Amazon SQS (AWS docs)",
        url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html",
        year: 2026,
      },
      SQS_MESSAGE_QUOTAS,
      {
        title: "Exactly-once processing in Amazon SQS (AWS docs)",
        url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html",
        year: 2026,
      },
      {
        title: "Amazon SQS increases in-flight limit for FIFO queues from 20K to 120K (What's New)",
        url: "https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-sqs-increases-in-flight-limit-fifo-queues",
        year: 2024,
      },
      SQS_PRICING,
    ],
    assumptions:
      "Quota without high-throughput mode: 300 API calls per second per action, so 3,000 messages per second with batches of 10; the excess is throttled. High-throughput mode (70,000 calls, 700,000 messages per second in us-east-1) is not modeled. Price: $0.50 per million requests × 3 (send, receive, delete) = $1.50 per million messages. No FIFO-specific latency is published; the 25 ms send time is an estimate. Up to 120,000 messages in flight per queue since November 2024 (20,000 before).",
  },
];
