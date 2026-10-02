import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getProblemById } from "@/data/problems";
import { problemSlo, resolveSlo, sanitizeSloOverrides } from "@/slo/slo";
import type { Slo, SloOverrides } from "@/slo/types";
import { useAppStore } from "./appStore";
import { useInterviewStore } from "./interviewStore";
import { passThroughMigration, STORE_VERSION } from "./persistVersion";
import { safeLocalStorage } from "./safeStorage";

/**
 * The user's SLO overrides (Spec 11, SLO-01), per problem. Saving a design
 * stores its problem's override in the design (and the export envelope);
 * loading one restores it. An interview ignores them: the problem's SLO holds.
 */
interface SloState {
  overrides: Record<string, SloOverrides>;
  /** Replace a problem's override (undefined or nothing valid clears it). */
  setOverrides: (problemId: string, overrides: SloOverrides | undefined) => void;
}

export const useSloStore = create<SloState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverrides: (problemId, raw) =>
        set((s) => {
          const clean = sanitizeSloOverrides(raw);
          const next = { ...s.overrides };
          if (clean) next[problemId] = clean;
          else delete next[problemId];
          return { overrides: next };
        }),
    }),
    {
      name: "systemsim-slo",
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // New in v2: nothing older to migrate.
      migrate: passThroughMigration,
      partialize: (s) => ({ overrides: s.overrides }),
      // Anything malformed in storage is dropped, field by field.
      merge: (persisted, current) => {
        const raw = (persisted as { overrides?: unknown } | undefined)?.overrides;
        const overrides: Record<string, SloOverrides> = {};
        if (typeof raw === "object" && raw !== null) {
          for (const [id, o] of Object.entries(raw)) {
            const clean = sanitizeSloOverrides(o);
            if (clean) overrides[id] = clean;
          }
        }
        return { ...current, overrides };
      },
    },
  ),
);

/** The problem's own SLO; null when the problem is unknown. */
export function baseSloOf(problemId: string): Slo | null {
  const problem = getProblemById(problemId);
  return problem ? problemSlo(problem.requirements) : null;
}

/** The SLO in force: the problem's, with the user's override outside an interview. */
export function effectiveSlo(
  problemId: string,
  overrides: Record<string, SloOverrides>,
  interview: boolean,
): Slo | null {
  const base = baseSloOf(problemId);
  if (!base) return null;
  return interview ? base : resolveSlo(base, overrides[problemId]);
}

/** Non-hook: the SLO in force right now. */
export function getEffectiveSlo(): Slo | null {
  return effectiveSlo(
    useAppStore.getState().selectedProblemId,
    useSloStore.getState().overrides,
    useInterviewStore.getState().mode === "interview",
  );
}

/** Calls `cb` whenever the SLO in force may have changed (problem, override, interview). */
export function subscribeEffectiveSlo(cb: () => void): () => void {
  const unsubs = [
    useAppStore.subscribe((s, p) => {
      if (s.selectedProblemId !== p.selectedProblemId) cb();
    }),
    useSloStore.subscribe((s, p) => {
      if (s.overrides !== p.overrides) cb();
    }),
    useInterviewStore.subscribe((s, p) => {
      if (s.mode !== p.mode) cb();
    }),
  ];
  return () => unsubs.forEach((u) => u());
}

/** Hook: the SLO in force (memoized on its inputs). */
export function useEffectiveSlo(): Slo | null {
  const problemId = useAppStore((s) => s.selectedProblemId);
  const overrides = useSloStore((s) => s.overrides);
  const interview = useInterviewStore((s) => s.mode === "interview");
  return useMemo(
    () => effectiveSlo(problemId, overrides, interview),
    [problemId, overrides, interview],
  );
}
