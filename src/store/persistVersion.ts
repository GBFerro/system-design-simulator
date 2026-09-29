import { SCHEMA_VERSION } from "@/domain/persistence/version";

/**
 * Shared by every persisted store. Kept free of heavier imports (the graph
 * migration pulls in the component catalog, which itself imports a store).
 */
export const STORE_VERSION = SCHEMA_VERSION;

/** `migrate` for stores whose persisted shape didn't change between versions. */
export function passThroughMigration<T>(persisted: unknown): T {
  return persisted as T;
}
