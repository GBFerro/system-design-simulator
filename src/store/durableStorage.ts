import { createStore, del, get, set, type UseStore } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";

/**
 * IndexedDB-backed storage for data that outgrows localStorage (Spec 05):
 * saved designs now, run history (Specs 07/09) later.
 *
 * - Values live in IndexedDB (via idb-keyval, database "systemforge").
 * - Migration from localStorage: whenever a key exists in localStorage it is
 *   copied to IndexedDB and removed from localStorage only after the write is
 *   confirmed. localStorage wins because it's either v1 data never moved, or
 *   writes from a session that had to fall back — both newer than IndexedDB.
 * - If IndexedDB is unavailable or fails (private mode in some browsers),
 *   everything falls back to `safeLocalStorage` with a one-time warning toast.
 */

/** Minimal async key-value backend (IndexedDB in the app, a fake in tests). */
export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface DurableStorageDeps {
  /** null = IndexedDB unavailable. */
  idb: KeyValueBackend | null;
  /** Synchronous fallback / legacy source. */
  local: StateStorage;
  /** Called once, the first time we fall back to `local`. */
  onFallback: () => void;
}

export interface DurableStorage {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
  /** True once IndexedDB proved unusable and `local` is used instead. */
  readonly usingFallback: boolean;
}

export function createDurableStorage(deps: DurableStorageDeps): DurableStorage {
  const { idb, local, onFallback } = deps;
  let fallen = false;
  let notified = false;

  const fallBack = () => {
    fallen = true;
    if (!notified) {
      notified = true;
      onFallback();
    }
  };
  const localOnly = () => {
    if (!idb) fallBack();
    return fallen || !idb;
  };
  const localGet = (name: string) => (local.getItem(name) as string | null) ?? null;

  return {
    get usingFallback() {
      return fallen;
    },

    async getItem(name) {
      if (localOnly()) return localGet(name);
      const legacy = localGet(name);
      if (legacy !== null) {
        try {
          await idb!.set(name, legacy);
        } catch {
          fallBack();
          return legacy;
        }
        // Write confirmed (the IDB transaction completed) — now it's safe.
        await local.removeItem(name);
        return legacy;
      }
      try {
        const value = await idb!.get(name);
        return typeof value === "string" ? value : null;
      } catch {
        fallBack();
        return null;
      }
    },

    async setItem(name, value) {
      if (!localOnly()) {
        try {
          await idb!.set(name, value);
          return;
        } catch {
          fallBack();
        }
      }
      await local.setItem(name, value);
    },

    async removeItem(name) {
      await local.removeItem(name);
      if (fallen || !idb) return;
      try {
        await idb.del(name);
      } catch {
        fallBack();
      }
    },
  };
}

/* ---------- app wiring ---------- */

let idbStore: UseStore | null = null;

/** Lazily opened so nothing touches IndexedDB during SSR or at import time. */
function openStore(): UseStore {
  idbStore ??= createStore("systemforge", "kv");
  return idbStore;
}

function browserIdb(): KeyValueBackend | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    get: async (key) => get(key, openStore()),
    set: async (key, value) => set(key, value, openStore()),
    del: async (key) => del(key, openStore()),
  };
}

function notifyFallback(): void {
  if (typeof window === "undefined") return;
  // Lazy import: appStore persists through safeStorage (avoid import cycles).
  import("./appStore")
    .then(({ useAppStore }) => {
      useAppStore
        .getState()
        .showToast("IndexedDB unavailable — saved designs use limited browser storage", "info");
    })
    .catch(() => {});
}

/** The app's durable storage: IndexedDB with a localStorage fallback. */
export const durableStorage: DurableStorage = createDurableStorage({
  idb: browserIdb(),
  local: safeLocalStorage,
  onFallback: notifyFallback,
});

/**
 * JSON key-value helper over any `DurableStorage` — the reusable piece for
 * run history (Spec 07 pinned runs, Spec 09 attempts). Keys should be
 * namespaced, e.g. `systemsim-runs:<problemId>`.
 */
export function createDurableKV(storage: DurableStorage = durableStorage) {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = await storage.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    set<T>(key: string, value: T): Promise<void> {
      return storage.setItem(key, JSON.stringify(value));
    },
    del(key: string): Promise<void> {
      return storage.removeItem(key);
    },
  };
}
