import { getTechnology } from "./technologies";

/**
 * Component traits that the engine, the scorer and the advisor must agree
 * on, kept in one place (the engine can't import from `scoring/`).
 */

/**
 * The traffic source and managed services redundant by construction: DNS is
 * anycast over several name servers, a CDN serves from many edge locations,
 * object storage replicates across availability zones. One instance isn't a
 * single point of failure (scorer, advisor), and a zone outage doesn't take
 * them down (chaos, Spec 08).
 */
export const MANAGED_MULTI_ZONE: ReadonlySet<string> = new Set([
  "client",
  "dns",
  "cdn",
  "object-storage",
]);

/**
 * Redundant by construction (`MANAGED_MULTI_ZONE`), or a managed service by
 * its technology (component-technologies, TEC-50): DynamoDB, S3, SQS, SNS,
 * AWS API Gateway, NLB and ALB run across zones whatever `instances` says.
 * `params` is the node's (raw or validated); a `generic` node is judged by
 * its type alone, as before.
 */
export function isManagedMultiZone(componentId: string, params?: unknown): boolean {
  if (MANAGED_MULTI_ZONE.has(componentId)) return true;
  const techId =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>).technology
      : undefined;
  return typeof techId === "string" && getTechnology(componentId, techId)?.billing === "managed";
}

/** General-purpose databases (relational and NoSQL). */
export const DATABASES: ReadonlySet<string> = new Set(["sql-db", "nosql-db"]);
