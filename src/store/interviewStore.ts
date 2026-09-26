import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";

export interface Phase {
  name: string;
  targetMinutes: number;
  description: string;
  icon: string;
}

const PHASES: Phase[] = [
  {
    name: "Requirements",
    targetMinutes: 5,
    description: "Clarify functional and non-functional requirements",
    icon: "ClipboardList",
  },
  {
    name: "Estimation",
    targetMinutes: 5,
    description: "Back-of-envelope calculations",
    icon: "Calculator",
  },
  {
    name: "API Design",
    targetMinutes: 5,
    description: "Define core API endpoints",
    icon: "FileCode2",
  },
  {
    name: "Data Model",
    targetMinutes: 2,
    description: "Design key entities and relationships",
    icon: "Database",
  },
  {
    name: "High-Level Design",
    targetMinutes: 15,
    description: "Build the architecture on the canvas",
    icon: "LayoutDashboard",
  },
  {
    name: "Deep Dive",
    targetMinutes: 10,
    description: "Discuss trade-offs, failure modes, scaling",
    icon: "Search",
  },
];

interface InterviewState {
  mode: "free" | "interview";
  currentPhase: number;
  phases: Phase[];
  timerRunning: boolean;
  /**
   * Display value (total elapsed seconds). This is DERIVED from the
   * timestamp fields below — `tickTimer` resyncs it every second so
   * consumers re-render, but correctness never depends on tick cadence
   * (background-tab interval throttling cannot drift the timer).
   */
  timerSeconds: number;
  /** Total elapsed seconds at the moment the current phase started. */
  phaseStartTime: number;
  /** Epoch ms when the timer was last started/resumed; null while paused. */
  startedAt: number | null;
  /** Elapsed ms accumulated across previous run segments (before startedAt). */
  accumulatedMs: number;

  /** Source of truth for elapsed time, computed from timestamps. */
  elapsedSeconds: () => number;
  startInterview: () => void;
  endInterview: () => void;
  nextPhase: () => void;
  prevPhase: () => void;
  setPhase: (index: number) => void;
  tickTimer: () => void;
  toggleTimer: () => void;
}

function elapsedMsOf(s: { startedAt: number | null; accumulatedMs: number }): number {
  return s.accumulatedMs + (s.startedAt !== null ? Date.now() - s.startedAt : 0);
}

export const useInterviewStore = create<InterviewState>()(
  persist(
    (set, get) => ({
      mode: "free",
      currentPhase: 0,
      phases: PHASES,
      timerRunning: false,
      timerSeconds: 0,
      phaseStartTime: 0,
      startedAt: null,
      accumulatedMs: 0,

      elapsedSeconds: () => Math.floor(elapsedMsOf(get()) / 1000),

      startInterview: () =>
        set({
          mode: "interview",
          currentPhase: 0,
          timerRunning: true,
          timerSeconds: 0,
          phaseStartTime: 0,
          startedAt: Date.now(),
          accumulatedMs: 0,
        }),

      endInterview: () =>
        set({
          mode: "free",
          currentPhase: 0,
          timerRunning: false,
          timerSeconds: 0,
          phaseStartTime: 0,
          startedAt: null,
          accumulatedMs: 0,
        }),

      nextPhase: () => {
        const { currentPhase, phases, elapsedSeconds } = get();
        if (currentPhase < phases.length - 1) {
          const elapsed = elapsedSeconds();
          set({
            currentPhase: currentPhase + 1,
            phaseStartTime: elapsed,
            timerSeconds: elapsed,
          });
        }
      },

      prevPhase: () => {
        const { currentPhase, elapsedSeconds } = get();
        if (currentPhase > 0) {
          const elapsed = elapsedSeconds();
          set({
            currentPhase: currentPhase - 1,
            phaseStartTime: elapsed,
            timerSeconds: elapsed,
          });
        }
      },

      setPhase: (index) => {
        const { phases, elapsedSeconds } = get();
        if (index >= 0 && index < phases.length) {
          const elapsed = elapsedSeconds();
          set({
            currentPhase: index,
            phaseStartTime: elapsed,
            timerSeconds: elapsed,
          });
        }
      },

      // Called every second by the app shell while the timer runs. It only
      // resyncs the derived display value (and thereby triggers re-renders);
      // the elapsed time itself comes from timestamps, so missed ticks in
      // throttled background tabs cause no drift.
      tickTimer: () => {
        const elapsed = get().elapsedSeconds();
        if (elapsed !== get().timerSeconds) {
          set({ timerSeconds: elapsed });
        }
      },

      toggleTimer: () => {
        const s = get();
        if (s.timerRunning) {
          const elapsedMs = elapsedMsOf(s);
          set({
            timerRunning: false,
            accumulatedMs: elapsedMs,
            startedAt: null,
            timerSeconds: Math.floor(elapsedMs / 1000),
          });
        } else {
          set({ timerRunning: true, startedAt: Date.now() });
        }
      },
    }),
    {
      name: "systemsim-interview",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (state) => state as any,
      partialize: (state) => ({
        mode: state.mode,
        currentPhase: state.currentPhase,
        timerRunning: state.timerRunning,
        timerSeconds: state.timerSeconds,
        phaseStartTime: state.phaseStartTime,
        startedAt: state.startedAt,
        accumulatedMs: state.accumulatedMs,
      }),
      onRehydrateStorage: () => (state) => {
        // Resync the derived display seconds from timestamps after a
        // refresh (the persisted timerSeconds may be stale if the tab was
        // closed while the timer was running).
        state?.tickTimer();
      },
    },
  ),
);
