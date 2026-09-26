import { routingFor } from "@/domain/components/registry";
import type { EdgeRule, EdgeRuleKind } from "@/domain/components/types";

/** Default one-way network latency per protocol, in ms. */
export const PROTOCOL_LATENCY_MS: Record<string, number> = {
  http: 1,
  grpc: 0.5,
  websocket: 0.5,
  pubsub: 2,
  tcp: 0.5,
  custom: 1,
};

const RULE_KINDS: readonly EdgeRuleKind[] = ["always", "on_miss", "reads", "writes", "fraction"];

function networkLatencyFor(protocol: unknown): number {
  return (
    (typeof protocol === "string" && PROTOCOL_LATENCY_MS[protocol]) || PROTOCOL_LATENCY_MS.http
  );
}

/**
 * Rule a new edge gets when the user connects `source` → `target`
 * (both component ids). Spec 03, "Defaults ao conectar":
 * - out of a Cache/CDN → `on_miss`
 * - out of an LB → `always` (the LB splits by algorithm)
 * - anything else → `always`
 */
export function defaultEdgeRule(
  sourceComponentId: string | undefined,
  _targetComponentId?: string,
  protocol?: unknown,
): EdgeRule {
  const kind: EdgeRuleKind =
    sourceComponentId && routingFor(sourceComponentId) === "cache" ? "on_miss" : "always";
  return {
    kind,
    callsPerRequest: 1,
    networkLatencyMs: networkLatencyFor(protocol),
    packetLoss: 0,
  };
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * Normalize a raw rule (from storage, import or UI). Missing/invalid fields
 * take the default for this edge. Never throws.
 */
export function sanitizeEdgeRule(raw: unknown, fallback: EdgeRule): EdgeRule {
  if (typeof raw !== "object" || raw === null) return { ...fallback };
  const r = raw as Record<string, unknown>;
  const kind = RULE_KINDS.includes(r.kind as EdgeRuleKind)
    ? (r.kind as EdgeRuleKind)
    : fallback.kind;
  const rule: EdgeRule = {
    kind,
    callsPerRequest: clamp(r.callsPerRequest, 0, 100, fallback.callsPerRequest),
    networkLatencyMs: clamp(r.networkLatencyMs, 0, 10_000, fallback.networkLatencyMs),
    packetLoss: clamp(r.packetLoss, 0, 1, fallback.packetLoss),
  };
  if (kind === "fraction") rule.fraction = clamp(r.fraction, 0, 1, fallback.fraction ?? 1);
  return rule;
}
