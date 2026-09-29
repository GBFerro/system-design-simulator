import { create } from "zustand";
import type { FaultRecord } from "@/engine/faults/types";

/**
 * Faults of the live run (Spec 08). NOT persisted: faults exist only while a
 * simulation is loaded, and they never touch the graph. Mirrored from the
 * engine by `SimController` (inject/heal results and tick frames); cleared on
 * reset. Game-day scripts (CHS-05) will add the loaded `chaosScript` here.
 */
interface ChaosState {
  /** Every fault of the run, oldest first (the timeline). */
  faults: FaultRecord[];
  /** Engine fault version the list reflects (ignores stale updates). */
  version: number;

  setFaults: (faults: FaultRecord[], version: number) => void;
  clear: () => void;
}

export const useChaosStore = create<ChaosState>((set, get) => ({
  faults: [],
  version: -1,

  setFaults: (faults, version) => {
    if (version < get().version) return;
    set({ faults, version });
  },
  clear: () => set({ faults: [], version: -1 }),
}));

// Playwright reads the run's faults through this handle (same gate as `__runtimeStore`).
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("e2e"))
) {
  (window as unknown as { __chaosStore?: typeof useChaosStore }).__chaosStore = useChaosStore;
}
