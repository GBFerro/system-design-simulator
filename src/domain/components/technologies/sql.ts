import type { TechClass, Technology } from "./types";

/**
 * Relational databases (SQL Database and Read Replica), AWS us-east-1
 * on-demand, Single-AZ, db.r6g (Graviton2). Read capacity ≈ point selects
 * per vCPU; write capacity = single-row durable commits on the primary.
 */

const SQL_TYPES = ["sql-db", "read-replica"] as const;

/** db.r6g sizes: vCPU, read rps, write rps, $/h. */
function r6gClasses(
  rows: readonly [vCpu: number, reads: number, writes: number, perHour: number][],
  readMs: number,
  writeMs: number,
  evidence: TechClass["evidence"],
): TechClass[] {
  const sizes = ["large", "xlarge", "2xlarge", "4xlarge"];
  return rows.map(([vCpu, reads, writes, perHour], i) => ({
    id: `db.r6g.${sizes[i]}`,
    vCpu,
    capacityPerInstance: reads,
    serviceTimeMs: readMs,
    perInstanceHour: perHour,
    params: { writeCapacityRps: writes, writeServiceTimeMs: writeMs },
    evidence,
  }));
}

const RDS_FAILOVER = {
  title: "Failing over a Multi-AZ DB instance for Amazon RDS (AWS docs)",
  url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html",
  year: 2026,
};

const RDS_STORAGE = {
  title: "Amazon RDS DB instance storage (AWS docs)",
  url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html",
  year: 2026,
};

const POSTGRES_BENCH = {
  title: "ClickHouse, PostgresBench: A Reproducible Benchmark for Postgres Services",
  url: "https://clickhouse.com/blog/postgresbench",
  year: 2026,
};

const VIITALA = {
  title: "A. Viitala, AWS PostgreSQL 15.2: RDS vs. Aurora Performance comparison",
  url: "https://aviitala.com/posts/aws-rds-vs-aurora-postgresql-performance-comparison/",
  year: 2023,
};

const SINGLE_PRIMARY =
  "Single primary, strongly consistent there; async read replicas can serve stale reads (CAP doesn't classify a single-primary database).";

const SQL_SCOPE =
  "`instances` = the primary plus readable copies, not a Multi-AZ standby. Single-AZ on-demand price; storage not modeled.";

export const SQL_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "postgres",
    componentIds: SQL_TYPES,
    defaultFor: SQL_TYPES,
    label: "PostgreSQL (RDS)",
    short: "Postgres",
    description:
      "General-purpose relational database: ACID transactions, rich SQL and indexes, one primary for every write.",
    consistency: SINGLE_PRIMARY,
    cap: "cp",
    billing: "instance",
    classes: r6gClasses(
      [
        [2, 20_000, 3_000, 0.225],
        [4, 40_000, 5_000, 0.45],
        [8, 80_000, 8_000, 0.899],
        [16, 160_000, 12_000, 1.798],
      ],
      0.1,
      1.5,
      "estimate",
    ),
    defaultClass: "db.r6g.xlarge",
    params: { failoverSec: 90, replicationLagMs: 100 },
    mechanics: { kind: "sql-primary" },
    sources: [
      {
        title: "G. Blake (Amazon), pgsql-hackers: pgbench select-only on m6g.16xlarge",
        url: "https://www.postgresql.org/message-id/7E987754-1C43-477B-8FEB-CE894C231B36%40amazon.com",
        year: 2021,
      },
      POSTGRES_BENCH,
      VIITALA,
      {
        title: "Leveling up Amazon RDS with AWS Graviton4: Benchmarks (AWS Database Blog)",
        url: "https://aws.amazon.com/blogs/database/leveling-up-amazon-rds-with-aws-graviton4-benchmarks/",
        year: 2025,
      },
      RDS_STORAGE,
      RDS_FAILOVER,
      {
        title: "AWS price list: RDS for PostgreSQL on-demand, us-east-1",
        url: "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-postgresql-ondemand.json",
        year: 2026,
      },
    ],
    assumptions: `Reads: primary-key point selects on ~1 KB rows, working set in memory, ≈ 10,000 per Graviton2 vCPU (pgbench select-only reached 666k TPS on 64 vCPU). Writes: durable single-row autocommits, normalized as 2 × pgbench TPC-B TPS, on gp3 (3,000 IOPS below 400 GiB for large/xlarge, 12,000 at ≥ 400 GiB for 2xlarge/4xlarge); they grow sublinearly because WAL flush and IOPS cap them. The 1.5 ms write service time (WAL fsync to EBS) is an estimate. Failover 90 s = midpoint of RDS Multi-AZ's typical 60–120 s; replica lag 100 ms is an estimate (AWS publishes no typical figure). ${SQL_SCOPE}`,
  },
  {
    id: "mysql",
    componentIds: SQL_TYPES,
    label: "MySQL (RDS)",
    short: "MySQL",
    description:
      "Widely used relational database (InnoDB): ACID transactions and fast point reads, one primary for every write.",
    consistency: SINGLE_PRIMARY,
    cap: "cp",
    billing: "instance",
    classes: r6gClasses(
      [
        [2, 24_000, 1_500, 0.215],
        [4, 48_000, 3_000, 0.43],
        [8, 96_000, 5_000, 0.859],
        [16, 190_000, 8_000, 1.718],
      ],
      0.08,
      2,
      "estimate",
    ),
    defaultClass: "db.r6g.xlarge",
    params: { failoverSec: 90, replicationLagMs: 100 },
    mechanics: { kind: "sql-primary" },
    sources: [
      {
        title: "bucket-sort, MySQL vs Aurora benchmark (sysbench, db.t3.medium)",
        url: "https://www.bucket-sort.com/posts/260212/",
        year: 2026,
      },
      {
        title:
          "N. Krichko (Percona), Economical Comparison of AWS CPUs for MySQL (ARM vs Intel vs AMD)",
        url: "https://www.percona.com/blog/economical-comparison-of-aws-cpus-for-mysql-arm-vs-intel-vs-amd",
        year: 2022,
      },
      {
        title: "D. Nichter, Are Aurora Performance Claims True?",
        url: "https://hackmysql.com/are-aurora-performance-claims-true/",
        year: 2023,
      },
      {
        title: "Graviton2 enhances Aurora price-performance (AWS China Blog)",
        url: "https://aws.amazon.com/cn/blogs/china/re-engendered-graviton2-enhances-aurora-price-performance/",
        year: 2021,
      },
      RDS_FAILOVER,
      {
        title: "AWS price list: RDS for MySQL on-demand, us-east-1",
        url: "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-mysql-ondemand.json",
        year: 2026,
      },
    ],
    assumptions: `Reads: primary-key point selects on ~1 KB rows in memory, ≈ 12,000 per vCPU (RDS MySQL sysbench oltp_point_select: 23.7k QPS on 2 vCPU). Writes: durable single-row autocommits with the binlog on (two flushes per commit), normalized as sysbench write-only row writes ÷ 2; RDS MySQL write capacity depends heavily on the redo log size and storage IOPS. The 2 ms write service time is an estimate. Failover 90 s = midpoint of RDS Multi-AZ's typical 60–120 s; replica lag 100 ms is an estimate, and MySQL replicas replay on one thread by default, so they fall behind under heavy writes. ${SQL_SCOPE}`,
  },
  {
    id: "aurora-postgres",
    componentIds: SQL_TYPES,
    label: "Aurora PostgreSQL (I/O-Optimized)",
    short: "Aurora PG",
    description:
      "AWS's PostgreSQL-compatible database on a shared storage volume replicated across 3 AZs: fast failover, readers share the volume.",
    consistency:
      "One writer; storage commits on a 4-of-6 quorum across 3 AZs; readers lag usually well under 100 ms, so replica reads can be slightly stale.",
    cap: "cp",
    billing: "instance",
    classes: r6gClasses(
      [
        [2, 18_000, 2_500, 0.338],
        [4, 36_000, 5_000, 0.675],
        [8, 72_000, 10_000, 1.349],
        [16, 145_000, 20_000, 2.699],
      ],
      0.11,
      3,
      "derived",
    ),
    defaultClass: "db.r6g.xlarge",
    params: { failoverSec: 30, replicationLagMs: 20 },
    mechanics: { kind: "sql-primary" },
    sources: [
      POSTGRES_BENCH,
      VIITALA,
      {
        title: "High availability for Amazon Aurora (AWS docs)",
        url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html",
        year: 2026,
      },
      {
        title: "Replication with Amazon Aurora (AWS docs)",
        url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html",
        year: 2026,
      },
      {
        title:
          "A. Gupta, Amazon Aurora under the hood: quorums and correlated failure (AWS Database Blog)",
        url: "https://aws.amazon.com/blogs/database/amazon-aurora-under-the-hood-quorum-and-correlated-failure/",
        year: 2017,
      },
      {
        title: "AWS price list: Aurora on-demand, us-east-1",
        url: "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-aurora-ondemand.json",
        year: 2026,
      },
    ],
    assumptions: `Reads: RDS PostgreSQL's 10,000 point selects per vCPU minus 10% (Aurora measured 10–12% below RDS on the same class). Writes: 2 × pgbench TPC-B TPS (Aurora PG 17 db.r6g.4xlarge: 12.6k TPS); no provisioned-IOPS cap, writes are log records sent to the storage fleet. The 3 ms write service time (a cross-AZ 4-of-6 storage quorum per commit) is derived from weak evidence. I/O-Optimized price: I/O included, no per-I/O charge. Failover 30 s with at least one replica ("typically under 60 seconds, often under 30"); replica lag 20 ms ("usually much less than 100 milliseconds"). ${SQL_SCOPE}`,
  },
];
