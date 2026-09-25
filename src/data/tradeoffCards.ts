export interface TradeoffCard {
  id: string;
  title: string;
  optionA: { name: string; pros: string[]; cons: string[] };
  optionB: { name: string; pros: string[]; cons: string[] };
  whenToChooseA: string;
  whenToChooseB: string;
}

export const TRADEOFF_CARDS: TradeoffCard[] = [
  {
    id: "sql-vs-nosql",
    title: "SQL vs NoSQL",
    optionA: {
      name: "SQL (Relational)",
      pros: [
        "ACID transactions",
        "Strong consistency",
        "Complex joins and queries",
        "Well-understood schema enforcement",
      ],
      cons: [
        "Harder to scale horizontally",
        "Rigid schema — migrations can be painful",
        "Lower write throughput at extreme scale",
      ],
    },
    optionB: {
      name: "NoSQL (Document/Key-Value)",
      pros: [
        "Horizontal scaling built-in",
        "Flexible schema",
        "High write throughput",
        "Low-latency key-value lookups",
      ],
      cons: [
        "Limited join support",
        "Eventual consistency by default",
        "Data modeling requires denormalization",
      ],
    },
    whenToChooseA:
      "When you need complex queries, transactions, or strong consistency (payments, inventory, user accounts).",
    whenToChooseB:
      "When you need massive scale, flexible schema, or high write throughput (social feeds, IoT data, session stores).",
  },
  {
    id: "push-vs-pull",
    title: "Push vs Pull (Fan-out)",
    optionA: {
      name: "Fan-out on Write (Push)",
      pros: [
        "Fast reads — timeline is pre-computed",
        "Simple read path",
        "Consistent user experience",
      ],
      cons: [
        "High write amplification for popular users",
        "Wasted work if followers never read",
        "Slow writes for celebrity accounts",
      ],
    },
    optionB: {
      name: "Fan-out on Read (Pull)",
      pros: ["No write amplification", "Always fresh data", "Simple write path"],
      cons: [
        "Slow reads — must aggregate at read time",
        "Higher read latency",
        "Complex read path with many DB queries",
      ],
    },
    whenToChooseA: "For most users with moderate follower counts where read latency matters most.",
    whenToChooseB:
      "For celebrity/high-follower accounts, or when write simplicity is more important than read speed.",
  },
  {
    id: "sync-vs-async",
    title: "Sync vs Async Communication",
    optionA: {
      name: "Synchronous (Request-Response)",
      pros: [
        "Simple to reason about",
        "Immediate feedback",
        "Easy error handling",
        "Natural request-response pattern",
      ],
      cons: [
        "Tight coupling between services",
        "Cascading failures",
        "Caller blocks until response",
      ],
    },
    optionB: {
      name: "Asynchronous (Message Queue)",
      pros: [
        "Loose coupling",
        "Better fault tolerance",
        "Natural load leveling",
        "Retry and dead-letter support",
      ],
      cons: [
        "Harder to debug",
        "Eventual consistency",
        "Message ordering challenges",
        "Additional infrastructure (broker)",
      ],
    },
    whenToChooseA:
      "When you need immediate responses and simple request-response flows (API gateway to service, user-facing reads).",
    whenToChooseB:
      "For fire-and-forget tasks, cross-service events, or when you need to decouple producers from consumers (notifications, analytics, order processing).",
  },
  {
    id: "strong-vs-eventual",
    title: "Strong vs Eventual Consistency",
    optionA: {
      name: "Strong Consistency",
      pros: [
        "All reads see the latest write",
        "Simplifies application logic",
        "No stale data surprises",
      ],
      cons: [
        "Higher latency (coordination overhead)",
        "Lower availability during partitions",
        "Harder to scale geographically",
      ],
    },
    optionB: {
      name: "Eventual Consistency",
      pros: [
        "Higher availability",
        "Lower latency",
        "Better geographic distribution",
        "Higher throughput",
      ],
      cons: [
        "Stale reads possible",
        "Complex conflict resolution",
        "Application must handle inconsistency",
      ],
    },
    whenToChooseA:
      "For financial transactions, inventory counts, or anywhere correctness is non-negotiable.",
    whenToChooseB:
      "For social feeds, analytics, caches, or anywhere slight staleness is acceptable for better performance.",
  },
  {
    id: "monolith-vs-microservices",
    title: "Monolith vs Microservices",
    optionA: {
      name: "Monolith",
      pros: [
        "Simple deployment",
        "Easy local development",
        "No network overhead between modules",
        "Straightforward debugging",
      ],
      cons: [
        "Harder to scale individual components",
        "Longer build/deploy cycles at scale",
        "Technology lock-in",
        "Team coupling",
      ],
    },
    optionB: {
      name: "Microservices",
      pros: [
        "Independent scaling per service",
        "Independent deployments",
        "Technology flexibility per service",
        "Team autonomy",
      ],
      cons: [
        "Distributed system complexity",
        "Network latency between services",
        "Operational overhead (monitoring, tracing)",
        "Data consistency challenges",
      ],
    },
    whenToChooseA:
      "For early-stage products, small teams, or when the domain is not yet well understood.",
    whenToChooseB:
      "For large organizations with clear domain boundaries, independent scaling needs, and dedicated platform teams.",
  },
  {
    id: "rest-vs-grpc",
    title: "REST vs gRPC",
    optionA: {
      name: "REST (HTTP/JSON)",
      pros: [
        "Universal browser support",
        "Human-readable payloads",
        "Simple tooling (curl, Postman)",
        "Wide ecosystem",
      ],
      cons: [
        "Larger payload size (JSON)",
        "No built-in streaming",
        "No strict schema enforcement",
        "HTTP/1.1 overhead",
      ],
    },
    optionB: {
      name: "gRPC (Protocol Buffers)",
      pros: [
        "Binary protocol — smaller payloads",
        "Built-in bi-directional streaming",
        "Strong schema via .proto files",
        "HTTP/2 multiplexing",
      ],
      cons: [
        "No native browser support (needs proxy)",
        "Binary payloads harder to debug",
        "Steeper learning curve",
        "Code generation required",
      ],
    },
    whenToChooseA:
      "For public APIs, browser clients, or when developer experience and debuggability matter most.",
    whenToChooseB:
      "For internal service-to-service communication where performance, streaming, and strict contracts matter.",
  },
  {
    id: "cache-aside-vs-write-through",
    title: "Cache-aside vs Write-through",
    optionA: {
      name: "Cache-aside (Lazy Loading)",
      pros: [
        "Only caches data that is actually read",
        "Cache failure does not block writes",
        "Simple implementation",
      ],
      cons: [
        "Cache miss penalty (extra DB read)",
        "Stale data until TTL expires",
        "Cold start problem",
      ],
    },
    optionB: {
      name: "Write-through",
      pros: ["Cache is always up-to-date", "No stale data", "Consistent read performance"],
      cons: [
        "Write latency increases (write to cache + DB)",
        "Caches data that may never be read",
        "More complex write path",
      ],
    },
    whenToChooseA:
      "For read-heavy workloads where some staleness is acceptable and you want to minimize cache size.",
    whenToChooseB: "When data freshness is critical and the write volume is manageable.",
  },
  {
    id: "vertical-vs-horizontal",
    title: "Vertical vs Horizontal Scaling",
    optionA: {
      name: "Vertical Scaling (Scale Up)",
      pros: [
        "No code changes needed",
        "No distributed system complexity",
        "Simple data consistency",
        "Lower operational overhead",
      ],
      cons: [
        "Hardware limits (single machine ceiling)",
        "Single point of failure",
        "Expensive at high end",
        "Downtime during upgrades",
      ],
    },
    optionB: {
      name: "Horizontal Scaling (Scale Out)",
      pros: [
        "Virtually unlimited capacity",
        "Better fault tolerance",
        "Cost-effective with commodity hardware",
        "Zero-downtime scaling",
      ],
      cons: [
        "Distributed system complexity",
        "Data partitioning challenges",
        "Network overhead",
        "Consistency challenges",
      ],
    },
    whenToChooseA:
      "For early-stage systems, databases that are hard to shard, or when simplicity outweighs scale needs.",
    whenToChooseB:
      "When you need fault tolerance, unlimited growth, or when individual machines cannot handle the load.",
  },
  {
    id: "polling-vs-websocket",
    title: "Polling vs WebSocket",
    optionA: {
      name: "Polling (Short/Long)",
      pros: [
        "Simple to implement",
        "Works through all proxies/firewalls",
        "Stateless — easy to load balance",
        "HTTP caching friendly",
      ],
      cons: [
        "Wasted requests when no new data",
        "Higher latency (polling interval)",
        "More server load at scale",
      ],
    },
    optionB: {
      name: "WebSocket",
      pros: [
        "Real-time bidirectional communication",
        "Low latency",
        "Efficient — no repeated handshakes",
        "Server can push updates instantly",
      ],
      cons: [
        "Stateful connections — harder to load balance",
        "Connection management overhead",
        "Proxy/firewall compatibility issues",
        "Reconnection logic needed",
      ],
    },
    whenToChooseA:
      "For infrequent updates, simple dashboards, or when infrastructure does not support persistent connections.",
    whenToChooseB:
      "For chat, live feeds, collaborative editing, gaming, or any feature needing sub-second updates.",
  },
  {
    id: "single-vs-multi-leader",
    title: "Single Leader vs Multi-Leader Replication",
    optionA: {
      name: "Single Leader",
      pros: ["No write conflicts", "Simple consistency model", "Easy to reason about ordering"],
      cons: [
        "Single point of failure for writes",
        "Write latency for remote clients",
        "Leader failover complexity",
      ],
    },
    optionB: {
      name: "Multi-Leader",
      pros: [
        "Writes accepted at any datacenter",
        "Better write latency for geo-distributed users",
        "Tolerates datacenter outages",
      ],
      cons: [
        "Write conflicts must be resolved",
        "Complex conflict resolution logic",
        "Harder to maintain consistency",
      ],
    },
    whenToChooseA: "When strong consistency is required and most users are in one region.",
    whenToChooseB:
      "For geo-distributed systems where write latency matters and you can handle conflict resolution (collaborative docs, multi-region apps).",
  },
  {
    id: "hash-vs-range-partitioning",
    title: "Hash Partitioning vs Range Partitioning",
    optionA: {
      name: "Hash Partitioning",
      pros: [
        "Even data distribution",
        "No hotspots from sequential keys",
        "Simple partition assignment",
      ],
      cons: [
        "Range queries require scatter-gather",
        "Rebalancing on cluster resize",
        "Loses data locality",
      ],
    },
    optionB: {
      name: "Range Partitioning",
      pros: [
        "Efficient range queries",
        "Data locality for related keys",
        "Natural ordering preserved",
      ],
      cons: [
        "Hotspots from sequential writes",
        "Uneven partition sizes",
        "Requires careful split-point selection",
      ],
    },
    whenToChooseA:
      "For key-value lookups where even distribution matters (user IDs, session tokens, URL shortener).",
    whenToChooseB:
      "When range scans are common (time-series data, alphabetical listings, log analysis).",
  },
  {
    id: "cdn-push-vs-pull",
    title: "CDN Push vs CDN Pull",
    optionA: {
      name: "CDN Push (Origin Push)",
      pros: [
        "Content available immediately",
        "No first-request latency penalty",
        "Full control over what is cached",
      ],
      cons: [
        "Storage costs for all pushed content",
        "Must manage cache invalidation",
        "Wasted space for unpopular content",
      ],
    },
    optionB: {
      name: "CDN Pull (Origin Pull)",
      pros: ["Only popular content is cached", "Lower storage costs", "Automatic cache population"],
      cons: [
        "First request is slow (cache miss)",
        "Thundering herd on cache expiry",
        "Less control over cached content",
      ],
    },
    whenToChooseA:
      "For critical content that must always be fast (homepage assets, popular videos, app bundles).",
    whenToChooseB:
      "For long-tail content where most items are rarely accessed (user profile images, old blog posts).",
  },
  {
    id: "token-bucket-vs-sliding-window",
    title: "Rate Limiting: Token Bucket vs Sliding Window",
    optionA: {
      name: "Token Bucket",
      pros: [
        "Allows controlled bursts",
        "Simple to implement",
        "Memory efficient (few counters)",
        "Smooth rate limiting",
      ],
      cons: [
        "Burst traffic can spike",
        "Tuning bucket size and refill rate",
        "Less precise at boundaries",
      ],
    },
    optionB: {
      name: "Sliding Window Log/Counter",
      pros: ["Precise rate limiting", "No boundary spikes", "Accurate per-window counting"],
      cons: [
        "Higher memory usage (log of timestamps)",
        "More complex implementation",
        "Sliding window counter trades precision for memory",
      ],
    },
    whenToChooseA:
      "When you want to allow short bursts while enforcing average rate (API gateways, general rate limiting).",
    whenToChooseB:
      "When strict per-window accuracy matters and you cannot tolerate boundary bursts (financial APIs, security-sensitive endpoints).",
  },
  {
    id: "at-least-once-vs-exactly-once",
    title: "Exactly-once Processing (EOS)",
    optionA: {
      name: "At-least-once Delivery + Idempotent Consumers",
      pros: [
        "Honest about network reality — retries on uncertainty",
        "No message loss",
        "High throughput, low coordination overhead",
        "Works on any broker",
      ],
      cons: [
        "Duplicate deliveries are guaranteed to happen eventually",
        "Every consumer must dedupe or be idempotent",
        "Dedup state (keys, TTLs) is your problem",
      ],
    },
    optionB: {
      name: "Exactly-once Processing (Kafka-style EOS)",
      pros: [
        "Idempotent producers — broker dedupes retries via sequence numbers",
        "Transactions make consume-transform-produce atomic across partitions",
        "Effectively-once results without app-level dedup inside the pipeline",
      ],
      cons: [
        "It is NOT exactly-once delivery — that is impossible over an unreliable network (Two Generals problem)",
        "Underneath it is still at-least-once delivery plus deduplication",
        "Guarantee ends at the pipeline edge — external side effects (emails, API calls) still need idempotency or transactional offsets",
        "Transaction coordination adds latency and complexity",
      ],
    },
    whenToChooseA:
      "For most messaging — accept duplicates and design idempotent consumers (notifications, analytics events, log processing).",
    whenToChooseB:
      "For stream pipelines where duplicated results corrupt state (payments ledgers, counters, Kafka Streams apps) — knowing it dedupes processing, not delivery.",
  },
  {
    id: "optimistic-vs-pessimistic-locking",
    title: "Optimistic vs Pessimistic Locking",
    optionA: {
      name: "Optimistic Locking (Version Check at Write)",
      pros: [
        "No locks held — readers never block",
        "Great throughput under low contention",
        "No deadlocks or lock management",
        "Maps naturally to compare-and-swap / row versioning",
      ],
      cons: [
        "Conflicts detected only at write time",
        "Failed writes must retry — wasted work",
        "Retry storms under high contention",
      ],
    },
    optionB: {
      name: "Pessimistic Locking (Lock Before Read)",
      pros: [
        "Conflicts prevented up front — no retries",
        "Predictable behavior under heavy contention",
        "Simple application logic (no retry loops)",
      ],
      cons: [
        "Locks block other transactions — lower concurrency",
        "Deadlock risk requires detection/timeouts",
        "Lock held too long stalls everyone (e.g., SELECT FOR UPDATE across a slow operation)",
      ],
    },
    whenToChooseA:
      "When conflicts are rare and throughput matters — version columns or CAS on user profiles, documents, low-contention rows.",
    whenToChooseB:
      "When many writers fight over the same rows and retries would storm (ticket/seat booking, inventory decrement on a hot SKU).",
  },
  {
    id: "sse-vs-websocket",
    title: "SSE vs WebSocket",
    optionA: {
      name: "Server-Sent Events (SSE)",
      pros: [
        "Plain HTTP — works with existing proxies, LBs, and HTTP/2 multiplexing",
        "Built-in auto-reconnect with last-event-ID",
        "Simple server and client code",
        "Much cheaper than long-polling (no re-request per message)",
      ],
      cons: [
        "One-way only — server to client",
        "Text-only (UTF-8) — binary must be encoded",
        "Client-to-server messages need separate HTTP requests",
      ],
    },
    optionB: {
      name: "WebSocket",
      pros: [
        "Full-duplex — both sides push anytime",
        "Binary frame support",
        "Lowest per-message overhead once connected",
      ],
      cons: [
        "Stateful connections — sticky routing or connection registries needed",
        "Trickier through proxies/LBs (protocol upgrade)",
        "You own reconnection, heartbeats, and backpressure logic",
      ],
    },
    whenToChooseA:
      "For one-way streams — notifications, live feeds, progress updates, LLM token streaming. (Long-polling remains the lowest-common-denominator fallback: an HTTP request held open per message — simple, works everywhere, highest overhead.)",
    whenToChooseB:
      "For bidirectional, low-latency interaction — chat, multiplayer games, collaborative editing.",
  },
  {
    id: "kafka-vs-rabbitmq",
    title: "Kafka Log vs RabbitMQ Broker",
    optionA: {
      name: "Kafka (Distributed Log)",
      pros: [
        "Messages retained and re-readable — consumers track their own offsets",
        "Replay from any offset for reprocessing or new consumers",
        "Ordered within a partition",
        "Massive throughput via sequential disk I/O and batching",
      ],
      cons: [
        "No per-message ack/delete — a slow message blocks its partition",
        "Routing is just topics + partitions; no broker-side filtering",
        "Heavier operational footprint (partitions, consumer groups, rebalances)",
      ],
    },
    optionB: {
      name: "RabbitMQ (Smart Broker Queue)",
      pros: [
        "Per-message ack, requeue, and delete semantics",
        "Flexible routing via exchanges (topic, fanout, headers)",
        "Priority queues, per-message TTL, dead-letter exchanges built in",
      ],
      cons: [
        "Messages deleted on ack — no replay for new consumers",
        "Lower throughput than a log at high volume",
        "Deep queues degrade broker performance",
      ],
    },
    whenToChooseA:
      "For event streaming, analytics pipelines, event sourcing, or when multiple independent consumers need the same data with replay.",
    whenToChooseB:
      "For task/work queues, complex routing rules, or per-message guarantees (job dispatch, RPC-style messaging, retry with dead-lettering).",
  },
  {
    id: "jwt-vs-session-tokens",
    title: "JWT vs Session Tokens",
    optionA: {
      name: "JWT (Stateless)",
      pros: [
        "No server-side lookup — claims verified via signature",
        "Works across services and domains without shared session store",
        "Scales horizontally with zero session affinity",
      ],
      cons: [
        "Hard to revoke before expiry — token is valid until it expires",
        "Token carries all claims — size overhead on every request",
        "Signing key rotation must be handled carefully (key IDs, JWKS)",
        "Stolen token is usable until expiry",
      ],
    },
    optionB: {
      name: "Session Tokens (Stateful)",
      pros: [
        "Instant revocation — delete the server-side record and the session dies",
        "Small opaque cookie — no claims exposed to the client",
        "Easy to inspect and manage active sessions",
      ],
      cons: [
        "Lookup on every request (DB or Redis)",
        "Session store is shared infrastructure to scale and keep available",
        "Cross-domain/microservice use needs extra plumbing",
      ],
    },
    whenToChooseA:
      "For microservices and cross-domain APIs — keep JWTs short-lived and pair with refresh tokens to limit the revocation gap.",
    whenToChooseB:
      "For classic web apps needing instant logout, ban, or session management — typically backed by Redis.",
  },
  {
    id: "normalization-vs-denormalization",
    title: "Normalization vs Denormalization",
    optionA: {
      name: "Normalization (Write-Optimized)",
      pros: [
        "Single source of truth — no update anomalies",
        "Writes touch one place",
        "Smaller storage footprint",
        "Schema enforces integrity",
      ],
      cons: [
        "Reads pay for joins at query time",
        "Complex queries get slow as join depth grows",
        "Poor fit for distributed stores with weak join support",
      ],
    },
    optionB: {
      name: "Denormalization (Read-Optimized)",
      pros: [
        "Joins precomputed — fast, simple reads",
        "One document/row fetch serves the whole view",
        "Natural fit for NoSQL aggregates and feeds",
      ],
      cons: [
        "Duplicated data must be kept consistent",
        "Updates fan out to every copy",
        "Stale copies if propagation fails",
      ],
    },
    whenToChooseA:
      "For OLTP relational cores where correctness and write integrity dominate (orders, accounts, inventory).",
    whenToChooseB:
      "For read-heavy views (feeds, product pages, NoSQL aggregates) — and note most mature systems do both: a normalized source of truth plus denormalized read models or materialized views (CQRS).",
  },
  {
    id: "batch-vs-stream-processing",
    title: "Batch vs Stream Processing",
    optionA: {
      name: "Batch Processing",
      pros: [
        "High throughput over bounded datasets",
        "Simple mental model — run, finish, inspect output",
        "Easy reprocessing — just rerun the job",
        "Mature tooling (MapReduce, Spark)",
      ],
      cons: [
        "Results lag by the schedule interval — often hours",
        "Bursty resource usage around job runs",
        "Late-arriving data waits for the next run",
      ],
    },
    optionB: {
      name: "Stream Processing",
      pros: [
        "Low-latency results over unbounded data",
        "Windowing and watermarks handle event-time vs processing-time skew",
        "Continuous, steady resource usage (Flink, Kafka Streams)",
      ],
      cons: [
        "Harder operations — state management, backpressure, exactly-once semantics",
        "Late/out-of-order events need explicit handling",
        "Reprocessing requires replayable sources and careful state resets",
      ],
    },
    whenToChooseA:
      "For reports, ML training, billing runs — anywhere hours of latency is fine and reprocessability matters.",
    whenToChooseB:
      "For fraud detection, live dashboards, alerting — anywhere seconds matter. (Lambda architecture runs both layers; Kappa simplifies to stream-only with replay.)",
  },
  {
    id: "active-active-vs-active-passive",
    title: "Active-Active vs Active-Passive Multi-Region",
    optionA: {
      name: "Active-Active",
      pros: [
        "Both regions serve traffic — lower latency for nearby users",
        "All provisioned capacity is doing work",
        "Failover is just traffic shifting — region loss degrades, not breaks",
      ],
      cons: [
        "Concurrent writes in both regions can conflict",
        "Needs conflict resolution: conflict-free design, CRDTs, or region-pinned writes",
        "Cross-region replication lag means regions can briefly disagree",
      ],
    },
    optionB: {
      name: "Active-Passive",
      pros: [
        "Single write region — simple, strong consistency story",
        "No write conflicts to resolve",
        "Easier to reason about and operate",
      ],
      cons: [
        "Failover takes time (RTO) and may lose unreplicated writes (RPO)",
        "Standby capacity sits mostly idle",
        "Remote users pay cross-region write latency",
        "Failover paths rot unless regularly tested",
      ],
    },
    whenToChooseA:
      "For global, latency-sensitive products that can resolve or avoid write conflicts (DynamoDB global tables, CRDT-based or region-pinned designs).",
    whenToChooseB:
      "For systems where consistency is paramount and an RTO of minutes is acceptable (classic primary/DR Postgres setups).",
  },
];
