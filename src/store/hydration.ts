import { useSyncExternalStore } from "react";
import { useAppStore } from "./appStore";
import { useCanvasStore } from "./canvasStore";
import { usePenStore } from "./penStore";
import { useSavedDesignsStore } from "./savedDesignsStore";
import { useCustomProblemsStore } from "./customProblemsStore";
import { useCustomComponentsStore } from "./customComponentsStore";
import { useTradeoffStore } from "./tradeoffStore";
import { useInterviewStore } from "./interviewStore";

/**
 * All persisted stores use `skipHydration: true` so that the server render
 * and the first client render agree (no hydration mismatch). Call
 * `rehydrateAllStores()` once after mount (e.g. in AppShell's useEffect)
 * to load the persisted state (localStorage; saved designs from IndexedDB).
 */

let hasHydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rehydrateAllStores(): Promise<void> {
  const results: (void | Promise<void>)[] = [
    // Custom components first: the v1 → v2 migration of the canvas and saved
    // designs needs them to tell a custom component from an unknown type.
    // localStorage stores hydrate synchronously, in this order.
    useCustomComponentsStore.persist.rehydrate(),
    useAppStore.persist.rehydrate(),
    useCanvasStore.persist.rehydrate(),
    usePenStore.persist.rehydrate(),
    // Async (IndexedDB); resolves once designs are loaded or migrated.
    useSavedDesignsStore.persist.rehydrate(),
    useCustomProblemsStore.persist.rehydrate(),
    useTradeoffStore.persist.rehydrate(),
    useInterviewStore.persist.rehydrate(),
  ];
  return Promise.all(results.map((r) => Promise.resolve(r))).then(() => {
    hasHydrated = true;
    emit();
  });
}

/**
 * Returns false on the server and until `rehydrateAllStores()` has
 * completed on the client; true afterwards. Use it to gate UI that must
 * only render persisted state.
 */
export function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasHydrated,
    () => false,
  );
}
