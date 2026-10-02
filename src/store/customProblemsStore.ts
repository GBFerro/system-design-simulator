import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";
import { passThroughMigration, STORE_VERSION } from "./persistVersion";

/** crypto.randomUUID is unavailable on non-secure (http) origins. */
function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the non-crypto fallback
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export interface CustomProblem {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  description: string;
  requirements: {
    readsPerSec: number;
    writesPerSec: number;
    storageGB: number;
    latencyMs: number;
    users: string;
    /** Monthly budget in USD (Spec 10); problems created before it have none. */
    budgetMonthlyUsd?: number;
  };
  constraints: string[];
  tags: string[];
  createdAt: string;
}

interface CustomProblemsState {
  problems: CustomProblem[];
  addProblem: (problem: Omit<CustomProblem, "id" | "createdAt">) => string;
  updateProblem: (id: string, updates: Partial<CustomProblem>) => void;
  deleteProblem: (id: string) => void;
}

export const useCustomProblemsStore = create<CustomProblemsState>()(
  persist(
    (set) => ({
      problems: [],

      addProblem: (problem) => {
        const id = `custom-${randomId()}`;
        const newProblem: CustomProblem = {
          ...problem,
          id,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ problems: [newProblem, ...s.problems] }));
        return id;
      },

      updateProblem: (id, updates) => {
        set((s) => ({
          problems: s.problems.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        }));
      },

      deleteProblem: (id) => {
        set((s) => ({
          problems: s.problems.filter((p) => p.id !== id),
        }));
      },
    }),
    {
      name: "systemsim-custom-problems",
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // Shape unchanged in v2.
      migrate: passThroughMigration,
    },
  ),
);
