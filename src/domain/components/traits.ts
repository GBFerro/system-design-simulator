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

/** General-purpose databases (relational and NoSQL). */
export const DATABASES: ReadonlySet<string> = new Set(["sql-db", "nosql-db"]);
