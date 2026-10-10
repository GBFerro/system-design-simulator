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

/**
 * The localStorage key of the persisted app state (`appStore`). Lives here, free of the
 * store's dependencies, so the root layout's pre-paint theme script and the E2E helpers
 * (which seed the saved step) can read it without loading the store.
 */
export const APP_STORAGE_KEY = "systemsim-app";
