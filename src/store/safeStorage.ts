import type { StateStorage } from "zustand/middleware";

/**
 * localStorage wrapper that never throws.
 *
 * `setItem` can fail with QuotaExceededError (storage full, private
 * browsing, etc.). When that happens we surface a toast instead of
 * crashing the state update that triggered the persist write.
 *
 * NOTE: appStore itself persists through this storage, so we must NOT
 * import appStore statically here (import cycle). The toast is fired
 * through a lazy dynamic import instead.
 */
function notifyStorageFull(): void {
  import("./appStore")
    .then(({ useAppStore }) => {
      useAppStore.getState().showToast("Storage full — changes not persisted", "error");
    })
    .catch(() => {
      // Nothing else we can do — persistence is best-effort.
    });
}

export const safeLocalStorage: StateStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      notifyStorageFull();
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Ignore — worst case a stale key stays behind.
    }
  },
};
