import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createDurableKV,
  createDurableStorage,
  type KeyValueBackend,
} from "@/store/durableStorage";

// Spec 05: saved designs move from localStorage to IndexedDB, falling back
// to localStorage when IndexedDB is unavailable.

function memoryLocal(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StateStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { map, storage };
}

function memoryIdb() {
  const map = new Map<string, unknown>();
  const backend: KeyValueBackend = {
    get: async (k) => map.get(k),
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  };
  return { map, backend };
}

const failing: KeyValueBackend = {
  get: () => Promise.reject(new Error("InvalidStateError")),
  set: () => Promise.reject(new Error("InvalidStateError")),
  del: () => Promise.reject(new Error("InvalidStateError")),
};

describe("durable storage (IndexedDB + localStorage fallback)", () => {
  it("reads and writes IndexedDB", async () => {
    const idb = memoryIdb();
    const local = memoryLocal();
    const onFallback = vi.fn();
    const storage = createDurableStorage({ idb: idb.backend, local: local.storage, onFallback });
    await storage.setItem("k", "v");
    expect(idb.map.get("k")).toBe("v");
    expect(local.map.size).toBe(0);
    expect(await storage.getItem("k")).toBe("v");
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
    expect(onFallback).not.toHaveBeenCalled();
    expect(storage.usingFallback).toBe(false);
  });

  it("moves a localStorage value to IndexedDB, removing it only after the write is confirmed", async () => {
    const local = memoryLocal({ designs: '{"v":1}' });
    const idb = memoryIdb();
    let confirm!: () => void;
    const backend: KeyValueBackend = {
      ...idb.backend,
      set: (k, v) =>
        new Promise<void>((resolve) => {
          confirm = () => {
            idb.map.set(k, v);
            resolve();
          };
        }),
    };
    const storage = createDurableStorage({
      idb: backend,
      local: local.storage,
      onFallback: vi.fn(),
    });

    const pending = storage.getItem("designs");
    await Promise.resolve();
    // Write not confirmed yet: the localStorage copy must still be there
    expect(local.map.get("designs")).toBe('{"v":1}');
    confirm();
    expect(await pending).toBe('{"v":1}');
    expect(idb.map.get("designs")).toBe('{"v":1}');
    expect(local.map.has("designs")).toBe(false);
  });

  it("prefers a localStorage copy over IndexedDB (fallback writes are newer)", async () => {
    const local = memoryLocal({ k: "newer" });
    const idb = memoryIdb();
    idb.map.set("k", "older");
    const storage = createDurableStorage({
      idb: idb.backend,
      local: local.storage,
      onFallback: vi.fn(),
    });
    expect(await storage.getItem("k")).toBe("newer");
    expect(idb.map.get("k")).toBe("newer");
    expect(local.map.has("k")).toBe(false);
  });

  it("keeps the localStorage copy and falls back when the IndexedDB write fails", async () => {
    const local = memoryLocal({ k: "legacy" });
    const onFallback = vi.fn();
    const storage = createDurableStorage({ idb: failing, local: local.storage, onFallback });
    expect(await storage.getItem("k")).toBe("legacy");
    expect(local.map.get("k")).toBe("legacy");
    expect(storage.usingFallback).toBe(true);
    await storage.setItem("k", "next");
    expect(local.map.get("k")).toBe("next");
    await storage.setItem("k", "again");
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("uses localStorage (with one warning) when IndexedDB is unavailable", async () => {
    const local = memoryLocal();
    const onFallback = vi.fn();
    const storage = createDurableStorage({ idb: null, local: local.storage, onFallback });
    await storage.setItem("k", "v");
    expect(await storage.getItem("k")).toBe("v");
    expect(local.map.get("k")).toBe("v");
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("createDurableKV stores JSON values (reusable for run history)", async () => {
    const idb = memoryIdb();
    const kv = createDurableKV(
      createDurableStorage({ idb: idb.backend, local: memoryLocal().storage, onFallback: vi.fn() }),
    );
    await kv.set("systemsim-runs:url-shortener", [{ at: 1, p99: 120 }]);
    expect(await kv.get("systemsim-runs:url-shortener")).toEqual([{ at: 1, p99: 120 }]);
    await kv.del("systemsim-runs:url-shortener");
    expect(await kv.get("systemsim-runs:url-shortener")).toBeUndefined();
  });
});
