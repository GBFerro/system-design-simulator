import type { TechClass, Technology } from "./types";

/**
 * Load balancers and API gateways, AWS us-east-1 on-demand. The managed ones
 * (NLB, ALB, AWS API Gateway) bill per hour and per request; HAProxy, Envoy
 * and Kong run self-managed on c6g (Graviton2) and bill per instance-hour.
 */

const LB = ["load-balancer"] as const;
const GATEWAY = ["api-gateway"] as const;

/** c6g sizes at 4 KB responses: vCPU, req/s; prices from the AWS price list. */
function c6gClasses(
  capacities: readonly number[],
  serviceTimeMs: number,
  evidence: TechClass["evidence"],
): TechClass[] {
  const sizes = [
    ["large", 2, 0.068],
    ["xlarge", 4, 0.136],
    ["2xlarge", 8, 0.272],
    ["4xlarge", 16, 0.544],
  ] as const;
  return sizes.map(([size, vCpu, perHour], i) => ({
    id: `c6g.${size}`,
    vCpu,
    capacityPerInstance: capacities[i],
    serviceTimeMs,
    perInstanceHour: perHour,
    evidence,
  }));
}

const ELB_PRICING = {
  title: "Elastic Load Balancing pricing",
  url: "https://aws.amazon.com/elasticloadbalancing/pricing/",
  year: 2026,
};

const LCU_RESERVATION = {
  title:
    "Using Load Balancer Capacity Unit Reservation to prepare for sharp increases in traffic (AWS blog)",
  url: "https://aws.amazon.com/blogs/networking-and-content-delivery/using-load-balancer-capacity-unit-reservation-to-prepare-for-sharp-increases-in-traffic/",
  year: 2025,
};

const C6G_PRICE = {
  title: "c6g.large pricing and specs (Vantage, mirrors the AWS price list)",
  url: "https://instances.vantage.sh/aws/ec2/c6g.large",
  year: 2026,
};

const EC2_NETWORK = {
  title: "Amazon EC2 compute optimized instance specifications: network (AWS docs)",
  url: "https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html",
  year: 2026,
};

const HAPROXY_2M = {
  title: "HAProxy Forwards Over 2 Million HTTP Requests per Second on a Single AWS Arm Instance",
  url: "https://www.haproxy.com/blog/haproxy-forwards-over-2-million-http-requests-per-second-on-a-single-aws-arm-instance",
  year: 2021,
};

const STATELESS = "Stateless proxy: it holds no data, so no consistency model applies;";

const NETWORK_CAP =
  "At 4 KB responses over keep-alive the instance's baseline network caps it (c6g.large 0.75 Gbps ≈ 23k req/s) before the CPU; the planning figures are about 90% of that ceiling.";

const HA_NOTE = "Run at least 2 instances for high availability.";

export const EDGE_TECHNOLOGIES: readonly Technology[] = [
  {
    id: "aws-nlb",
    componentIds: LB,
    label: "AWS NLB",
    short: "NLB",
    layer: "L4",
    description:
      "AWS Network Load Balancer: forwards TCP/UDP flows without parsing HTTP; very high throughput, static IPs, the lowest added latency.",
    consistency: `${STATELESS} a flow hash pins each connection to one target for its life.`,
    cap: "none",
    billing: "managed",
    managed: {
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 0.1,
      evidence: "estimate",
      perHour: 0.0225,
      perMillionReads: 0.025,
      perMillionWrites: 0.025,
    },
    params: { lbAlgorithm: "hash" },
    options: { lbAlgorithm: ["hash"] },
    sources: [
      {
        title: "What is a Network Load Balancer? (AWS docs)",
        url: "https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html",
        year: 2026,
      },
      {
        title: "Network Load Balancer (AWS product page)",
        url: "https://aws.amazon.com/elasticloadbalancing/network-load-balancer/",
        year: 2026,
      },
      ELB_PRICING,
      LCU_RESERVATION,
    ],
    assumptions:
      'AWS says an NLB "can handle millions of requests per second"; 1,000,000 req/s is a planning cap, not a published figure. The 0.1 ms added latency is an estimate: AWS calls it "ultra-low" without a number. Price: $0.0225 per hour plus $0.006 per NLCU-hour; at 4 KB per request with keep-alive the bytes dimension dominates, ≈ $0.025 per million requests. Algorithm: flow hash on protocol, source and destination IP and port (plus the TCP sequence number). It starts at 3 Gbps and adds about 3 Gbps per minute, so a sudden spike can outrun it.',
  },
  {
    id: "aws-alb",
    componentIds: LB,
    defaultFor: LB,
    label: "AWS ALB",
    short: "ALB",
    layer: "L7",
    description:
      "AWS Application Load Balancer: terminates HTTP(S), routes by host, path and header rules, and health-checks its targets.",
    consistency: `${STATELESS} requests on one connection can reach different targets.`,
    cap: "none",
    billing: "managed",
    managed: {
      capacityPerInstance: 1_000_000,
      serviceTimeMs: 2,
      evidence: "estimate",
      perHour: 0.0225,
      perMillionReads: 0.033,
      perMillionWrites: 0.033,
    },
    params: { lbAlgorithm: "round-robin" },
    options: { lbAlgorithm: ["round-robin", "least-connections", "weighted"] },
    sources: [
      {
        title: "Target groups for your Application Load Balancers (AWS docs)",
        url: "https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html",
        year: 2026,
      },
      ELB_PRICING,
      LCU_RESERVATION,
    ],
    assumptions:
      "An ALB scales out with load (AWS: it can double its capacity within five minutes), so 1,000,000 req/s is a planning cap, not a published figure. The 2 ms added latency is an estimate for an L7 proxy (TCP/TLS termination, HTTP parsing, rule evaluation); AWS publishes no number. Price: $0.0225 per hour plus $0.008 per LCU-hour; at 4 KB per request with keep-alive the bytes dimension dominates, ≈ $0.033 per million (one new connection per request: ≈ $0.089). Algorithms: round robin (default), least outstanding requests (least connections here), weighted random.",
  },
  {
    id: "haproxy",
    componentIds: LB,
    label: "HAProxy",
    short: "HAProxy",
    layer: "L7",
    description:
      "Open-source L4/L7 load balancer and reverse proxy: very high request rates per core, many balancing algorithms and health checks.",
    consistency: `${STATELESS} sticky sessions or a hash on a key keep a client on one server.`,
    cap: "none",
    billing: "instance",
    classes: c6gClasses([20_000, 35_000, 70_000, 140_000], 0.4, "derived"),
    defaultClass: "c6g.xlarge",
    params: {},
    sources: [
      HAPROXY_2M,
      {
        title: "W. Tarreau, F. Lallemand, The State of SSL Stacks (HAProxy blog)",
        url: "https://www.haproxy.com/blog/state-of-ssl-stacks",
        year: 2025,
      },
      {
        title: "HAProxy Configuration Manual: balance",
        url: "https://docs.haproxy.org/3.0/configuration.html#4.2-balance",
        year: 2026,
      },
      EC2_NETWORK,
      C6G_PRICE,
    ],
    assumptions: `HTTP/1.1 with keep-alive and 4 KB responses. CPU ceiling ≈ 35k req/s per vCPU, the conservative end of HAProxy's 2.04M req/s on a 64-vCPU c6gn.16xlarge with 0-byte bodies. ${NETWORK_CAP} TLS over kept-alive connections costs 0–25%; one new TLS handshake per request caps a core at ≈ 650–1,000 per second. Added latency up to 0.4 ms, measured on a saturated machine. ${HA_NOTE}`,
  },
  {
    id: "envoy",
    componentIds: LB,
    label: "Envoy",
    short: "Envoy",
    layer: "L7",
    description:
      "Open-source L7 proxy built for service meshes and edge gateways: dynamic configuration over xDS, HTTP/2 and gRPC, rich telemetry.",
    consistency: `${STATELESS} ring hash or Maglev keep a key on one upstream.`,
    cap: "none",
    billing: "instance",
    classes: c6gClasses([20_000, 35_000, 70_000, 140_000], 0.5, "estimate"),
    defaultClass: "c6g.xlarge",
    params: {},
    sources: [
      {
        title: "How fast is Envoy? (Envoy FAQ)",
        url: "https://www.envoyproxy.io/docs/envoy/latest/faq/performance/how_fast_is_envoy",
        year: 2026,
      },
      {
        title: "Istio Performance and Scalability (v1.19)",
        url: "https://istio.io/v1.19/docs/ops/deployment/performance-and-scalability",
        year: 2023,
      },
      {
        title: "Istio Performance and Scalability",
        url: "https://istio.io/latest/docs/ops/deployment/performance-and-scalability/",
        year: 2025,
      },
      {
        title: "Envoy supported load balancers",
        url: "https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers",
        year: 2026,
      },
      EC2_NETWORK,
      C6G_PRICE,
    ],
    assumptions: `Envoy publishes no official benchmarks. Estimate: ≈ 15k req/s per vCPU bare (0.4–0.9× HAProxy in third-party comparisons), ≈ 5k with mTLS and full telemetry (Istio sidecar). ${NETWORK_CAP} With small responses its CPU ceiling comes first. Added latency 0.5 ms per hop, from Istio's 1.31 ms p90 for two proxies with mTLS. ${HA_NOTE}`,
  },
  {
    id: "aws-api-gateway",
    componentIds: GATEWAY,
    defaultFor: GATEWAY,
    label: "AWS API Gateway (HTTP API)",
    short: "API Gateway",
    description:
      "AWS's managed API front door: routing, authorization and throttling with nothing to run, billed per request.",
    consistency:
      "Stateless: it holds no data, so no consistency model applies; the account's throttle is shared by every API in the Region.",
    cap: "none",
    billing: "managed",
    managed: {
      capacityPerInstance: 10_000,
      serviceTimeMs: 8,
      evidence: "estimate",
      perMillionReads: 1,
      perMillionWrites: 1,
    },
    params: { timeoutMs: 30_000 },
    mechanics: { kind: "quota", quota: { sharedRps: 10_000, burst: 5_000 } },
    sources: [
      {
        title: "Amazon API Gateway quotas (AWS docs)",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html",
        year: 2026,
      },
      {
        title: "Quotas for an HTTP API in API Gateway (AWS docs)",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html",
        year: 2026,
      },
      {
        title: "Amazon API Gateway pricing",
        url: "https://aws.amazon.com/api-gateway/pricing/",
        year: 2026,
      },
      {
        title: "Review: API Gateway HTTP APIs, cheaper and faster REST APIs? (cloudonaut)",
        url: "https://cloudonaut.io/review-api-gateway-http-apis/",
        year: 2020,
      },
    ],
    assumptions:
      "Account throttle per Region: 10,000 req/s steady with a 5,000-request token bucket, shared by HTTP, REST and WebSocket APIs (raisable on request; AWS sets the burst); the excess gets 429. HTTP API price: $1.00 per million for the first 300 million a month (REST API: $3.50). Integration timeout 30 s, not adjustable. The 8 ms added latency is an estimate from a 2020 measurement (14 ms average end to end, including a warm Lambda call).",
  },
  {
    id: "kong",
    componentIds: GATEWAY,
    label: "Kong Gateway",
    short: "Kong",
    description:
      "Open-source API gateway on NGINX/OpenResty: routing plus plugins for authentication, rate limiting and transformations.",
    consistency: `${STATELESS} plugin state such as rate-limit counters lives in its datastore or Redis.`,
    cap: "none",
    billing: "instance",
    classes: c6gClasses([18_000, 36_000, 72_000, 144_000], 1.5, "derived"),
    defaultClass: "c6g.xlarge",
    params: {},
    sources: [
      {
        title: "Kong Gateway performance testing benchmarks",
        url: "https://developer.konghq.com/gateway/performance/benchmarks/",
        year: 2026,
      },
      EC2_NETWORK,
      C6G_PRICE,
    ],
    assumptions: `Kong 3.16 on one c5.4xlarge (16 vCPU), HTTPS, no plugins: 144k req/s, ≈ 9,000 per vCPU; with rate limiting and key-auth 102k (about 29% less). A Graviton c6g vCPU is taken as equal to a c5 vCPU (no Kong-on-Graviton figure); Kong is CPU-bound before the network at 4 KB. The 1.5 ms service time is within the 1–2 ms p50 expected without plugins at moderate load (the published p95/p99 are at saturation). ${HA_NOTE}`,
  },
];
