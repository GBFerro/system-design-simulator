import type { TechClass, Technology } from "./types";

/**
 * NoSQL databases (NoSQL Database), AWS us-east-1 on-demand. DynamoDB is
 * billed per request unit; Cassandra, ScyllaDB and MongoDB run self-managed
 * on EC2 and are billed per instance-hour.
 */

const NOSQL = ["nosql-db"] as const;

/** Four sizes of one EC2 family: vCPU, capacity, $/h. */
function ec2Classes(
  family: (size: string) => string,
  rows: readonly (readonly [vCpu: number, capacity: number, perHour: number])[],
  serviceTimeMs: number,
  evidence: TechClass["evidence"],
): TechClass[] {
  const sizes = ["large", "xlarge", "2xlarge", "4xlarge"];
  return rows.map(([vCpu, capacity, perHour], i) => ({
    id: family(sizes[i]),
    vCpu,
    capacityPerInstance: capacity,
    serviceTimeMs,
    perInstanceHour: perHour,
    evidence,
  }));
}

/** i4i (local NVMe) prices, us-east-1. */
const I4I = (rows: readonly [vCpu: number, capacity: number][]) =>
  rows.map(([vCpu, capacity], i) => [vCpu, capacity, [0.172, 0.343, 0.686, 1.373][i]] as const);

const SCYLLA_VS_CASSANDRA_2026 = {
  title:
    "F. C. Mendes, ScyllaDB Tablets vs Cassandra vNodes: Scaling Performance Comparison (ScyllaDB blog)",
  url: "https://www.scylladb.com/2026/01/13/scaling-performance-comparison-vs-cassandra/",
  year: 2026,
};

const SCYLLA_VS_CASSANDRA_2021 = {
  title: "ScyllaDB vs Cassandra: Performance Results (ScyllaDB blog)",
  url: "https://www.scylladb.com/2021/08/24/scylladb-vs-cassandra-performance-results/",
  year: 2021,
};

const BENCHANT = {
  title: "benchANT Database Ranking raw data (YCSB, CRUD general purpose)",
  url: "https://github.com/benchANT/database-ranking",
  year: 2026,
};

const I4I_PRICE = {
  title: "i4i.xlarge pricing and specs (Vantage, mirrors the AWS price list)",
  url: "https://instances.vantage.sh/aws/ec2/i4i.xlarge",
  year: 2026,
};

const REPLICA_OPS =
  "Capacity counts replica operations per second per node: client ops at RF 3 × 2.5 replica ops each (a QUORUM read touches 2 replicas, a write all 3; 50/50 mix).";

const I4I_SCOPE =
  "Self-managed on EC2 i4i (local NVMe, no EBS cost); inter-AZ transfer and operations work not modeled.";

export const NOSQL_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "dynamodb",
    componentIds: NOSQL,
    defaultFor: NOSQL,
    label: "DynamoDB (on-demand)",
    short: "DynamoDB",
    description:
      "AWS's serverless key-value and document store: reads and writes by partition key in single-digit ms, billed per request.",
    consistency:
      "3 replicas across AZs with quorum writes; strongly consistent reads are linearizable per item (CP-like), default eventually consistent reads may be stale.",
    billing: "managed",
    managed: {
      capacityPerInstance: 40_000,
      serviceTimeMs: 3,
      evidence: "estimate",
      perMillionReads: 0.125,
      perMillionWrites: 0.625,
    },
    params: { readConsistency: "eventual" },
    mechanics: {
      kind: "dynamo",
      perPartition: { readUnits: 3_000, writeUnits: 1_000 },
      readUnitCost: { eventual: 0.5, strong: 1 },
      quota: { readRps: 40_000, writeRps: 40_000 },
    },
    sources: [
      {
        title: "Quotas in Amazon DynamoDB (AWS docs)",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html",
        year: 2026,
      },
      {
        title: "DynamoDB burst and adaptive capacity (AWS docs)",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html",
        year: 2026,
      },
      {
        title:
          "Best practices for designing and using partition keys effectively in DynamoDB (AWS docs)",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html",
        year: 2026,
      },
      {
        title: "Amazon DynamoDB pricing for on-demand capacity",
        url: "https://aws.amazon.com/dynamodb/pricing/on-demand/",
        year: 2026,
      },
      {
        title:
          "Elhemali et al., Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service (USENIX ATC '22)",
        url: "https://www.usenix.org/system/files/atc22-elhemali.pdf",
        year: 2022,
      },
      {
        title: "DynamoDB read consistency (AWS docs)",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html",
        year: 2026,
      },
    ],
    assumptions:
      'Default table quota: 40,000 read and 40,000 write request units per second (adjustable). One partition serves at most 3,000 read and 1,000 write units per second, and one hot item can\'t go past that. Items up to 1 KB: a write costs 1 WRU, an eventually consistent read 0.5 RRU, a strongly consistent read 1 RRU. Prices per request unit after the November 2024 cut ($0.125 per million RRU, $0.625 per million WRU). The 3 ms service time is an estimate: AWS publishes only "single-digit milliseconds". Transactions (2× units), GSIs, storage, global tables and the 2×-previous-peak instant scaling are not modeled.',
  },
  {
    id: "cassandra",
    componentIds: NOSQL,
    label: "Apache Cassandra",
    short: "Cassandra",
    description:
      "Wide-column store with leaderless replication: every write goes to all replicas, and throughput grows by adding nodes; built for write-heavy loads.",
    consistency:
      "AP with tunable consistency: ONE, QUORUM or ALL per query; QUORUM reads with QUORUM writes (R + W > RF) read your own writes.",
    billing: "instance",
    classes: ec2Classes(
      (size) => `i4i.${size}`,
      I4I([
        [2, 5_000],
        [4, 16_000],
        [8, 32_000],
        [16, 67_000],
      ]),
      1.5,
      "derived",
    ),
    defaultClass: "i4i.xlarge",
    params: { replicationFactor: 3, consistencyLevel: "quorum" },
    mechanics: { kind: "replica-quorum" },
    sources: [
      SCYLLA_VS_CASSANDRA_2026,
      SCYLLA_VS_CASSANDRA_2021,
      {
        title:
          "Instaclustr, Node throughput Benchmarking for Apache Cassandra on AWS, Azure and GCP",
        url: "https://www.instaclustr.com/blog/node-throughput-benchmarking-for-apache-cassandra/",
        year: 2024,
      },
      BENCHANT,
      {
        title: "Apache Cassandra docs: Dynamo (replication and consistency levels)",
        url: "https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html",
        year: 2026,
      },
      I4I_PRICE,
    ],
    assumptions: `${REPLICA_OPS} Anchor: 3 × i4i.4xlarge, Cassandra 5.0, RF 3, LOCAL_QUORUM, ~1 KB rows: about 27k client ops/s per node with p99 under 10 ms (benchmark published by ScyllaDB, a competitor). Smaller classes scale at about 1.67k client ops/s per vCPU; i4i.large gets a third of linear, as 2-vCPU nodes measure far below it (JVM, compaction and GC overhead). The 1.5 ms service time is the middle of the 1–2 ms p50 expected at about half load (saturated runs measured 2.2–3.5 ms, mostly queueing). ${I4I_SCOPE}`,
  },
  {
    id: "scylladb",
    componentIds: NOSQL,
    label: "ScyllaDB",
    short: "ScyllaDB",
    description:
      "Cassandra-compatible wide-column store written in C++ with one shard per core: more throughput and a lower tail latency per node.",
    consistency:
      "AP with tunable consistency like Cassandra (ONE, QUORUM or ALL per query); a write is always sent to every replica.",
    billing: "instance",
    classes: ec2Classes(
      (size) => `i4i.${size}`,
      I4I([
        [2, 25_000],
        [4, 57_000],
        [8, 115_000],
        [16, 232_000],
      ]),
      0.7,
      "derived",
    ),
    defaultClass: "i4i.xlarge",
    params: { replicationFactor: 3, consistencyLevel: "quorum" },
    mechanics: { kind: "replica-quorum" },
    sources: [
      SCYLLA_VS_CASSANDRA_2026,
      {
        title: "Benchmarking ScyllaDB 5.0 on AWS i4i.4xlarge (ScyllaDB blog)",
        url: "https://www.scylladb.com/2022/09/07/benchmarking-scylladb-5-0-on-aws-i4i-4xlarge/",
        year: 2022,
      },
      SCYLLA_VS_CASSANDRA_2021,
      {
        title: "ScyllaDB docs: Fault Tolerance (replication factor, consistency levels, CAP)",
        url: "https://docs.scylladb.com/manual/stable/architecture/architecture-fault-tolerance.html",
        year: 2026,
      },
      I4I_PRICE,
    ],
    assumptions: `${REPLICA_OPS} Anchor: 3 × i4i.4xlarge, ScyllaDB with tablets, RF 3, LOCAL_QUORUM, ~1 KB rows, 80% hot set: about 93k client ops/s per node with p99 under 10 ms (vendor benchmark). Smaller classes scale at about 5.8k client ops/s per vCPU (one shard per core). A uniform load over a dataset much larger than RAM gets far less (about 37k per node at 50/50 in the 2022 disk-bound run). The 0.7 ms service time sits below the 1.2 ms (writes) to 2.4 ms (reads) means measured at about half load on i4i.4xlarge, which include the network and queueing. ${I4I_SCOPE}`,
  },
  {
    id: "mongodb",
    componentIds: NOSQL,
    label: "MongoDB (replica set)",
    short: "MongoDB",
    description:
      "Document database with flexible JSON-like documents and secondary indexes; one primary per replica set (per shard) takes the writes.",
    consistency:
      "CP-leaning: one primary per replica set, majority writes survive a failover, secondary reads may be stale; no writes during an election (median ≤ 12 s).",
    billing: "instance",
    classes: ec2Classes(
      (size) => `r6g.${size}`,
      [
        [2, 7_000, 0.1008],
        [4, 14_000, 0.2016],
        [8, 24_000, 0.4032],
        [16, 40_000, 0.8064],
      ],
      0.7,
      "estimate",
    ),
    defaultClass: "r6g.xlarge",
    params: { shards: 1, readPreference: "primary", writeConcern: "majority" },
    mechanics: { kind: "mongo", replicationRttMs: 2 },
    sources: [
      { ...BENCHANT, year: 2024 },
      {
        title: "MongoDB manual: Read Preference",
        url: "https://www.mongodb.com/docs/manual/core/read-preference/",
        year: 2026,
      },
      {
        title: "MongoDB manual: Write Concern",
        url: "https://www.mongodb.com/docs/manual/reference/write-concern/",
        year: 2026,
      },
      {
        title: "MongoDB manual: Replica Set Elections",
        url: "https://www.mongodb.com/docs/manual/core/replica-set-elections/",
        year: 2026,
      },
      {
        title: "r6g.xlarge pricing and specs (Vantage, mirrors the AWS price list)",
        url: "https://instances.vantage.sh/aws/ec2/r6g.xlarge",
        year: 2026,
      },
    ],
    assumptions:
      "Capacity per member, point reads and inserts on documents in memory. Measured: benchANT YCSB on MongoDB 8.0, a 3-member replica set, 50/50 reads and inserts of 500 B documents: 14.1k ops/s on m5.xlarge and 24.3k on m5.2xlarge, all on the primary. The r6g figures are estimates from those (same vCPU, twice the RAM for the WiredTiger cache): large is half of xlarge, 4xlarge applies the measured 1.72× per doubling again. Write concern majority adds about 2 ms per write (a cross-AZ round trip plus a journal flush on a secondary), an estimate. A replica set is usually 3 members: give each shard 3 instances. Self-managed on EC2; EBS storage not priced, and Atlas prices differently.",
  },
];
