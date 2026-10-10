import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";
import { passThroughMigration, STORE_VERSION } from "./persistVersion";
import type { ApiDraft, EntityDraft, Estimates, EstimateField } from "@/interview/checks";

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
    description: "Failure drill: survive injected faults, then discuss trade-offs",
    icon: "Search",
  },
];

/** What the candidate answered in the checkable phases (Spec 09). Free text is never graded. */
export interface InterviewAnswers {
  /** Checked requirement ids (phase 1). */
  requirements: string[];
  requirementNotes: string;
  /** Phase 2. */
  estimates: Estimates;
  /** Phase 3. */
  apis: ApiDraft[];
  /** Phase 4. */
  entities: EntityDraft[];
}

export const EMPTY_ANSWERS: InterviewAnswers = {
  requirements: [],
  requirementNotes: "",
  estimates: {},
  apis: [],
  entities: [],
};

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
  /** Seconds spent in each phase so far (the current one is added on leaving it). */
  phaseSeconds: number[];
  answers: InterviewAnswers;

  /** Source of truth for elapsed time, computed from timestamps. */
  elapsedSeconds: () => number;
  startInterview: () => void;
  endInterview: () => void;
  nextPhase: () => void;
  prevPhase: () => void;
  setPhase: (index: number) => void;
  tickTimer: () => void;
  toggleTimer: () => void;
  /** Seconds per phase including the one in progress (for the report). */
  phaseSecondsNow: () => number[];
  toggleRequirement: (id: string) => void;
  setRequirementNotes: (text: string) => void;
  setEstimate: (field: EstimateField, value: number | undefined) => void;
  addApi: () => void;
  updateApi: (index: number, patch: Partial<ApiDraft>) => void;
  removeApi: (index: number) => void;
  addEntity: () => void;
  updateEntity: (index: number, patch: Partial<EntityDraft>) => void;
  removeEntity: (index: number) => void;
}

/** Add the time spent in the phase being left. */
function leavePhase(
  s: {
    phaseSeconds: number[];
    currentPhase: number;
    phaseStartTime: number;
  },
  elapsed: number,
): number[] {
  const out = [...s.phaseSeconds];
  out[s.currentPhase] = (out[s.currentPhase] ?? 0) + Math.max(0, elapsed - s.phaseStartTime);
  return out;
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
      phaseSeconds: [],
      answers: EMPTY_ANSWERS,

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
          phaseSeconds: [],
          answers: EMPTY_ANSWERS,
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
            phaseSeconds: leavePhase(get(), elapsed),
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
            phaseSeconds: leavePhase(get(), elapsed),
            currentPhase: currentPhase - 1,
            phaseStartTime: elapsed,
            timerSeconds: elapsed,
          });
        }
      },

      // Only the current phase or an earlier one: the way ahead is Next (WIZ-25).
      setPhase: (index) => {
        const { currentPhase, elapsedSeconds } = get();
        if (index >= 0 && index <= currentPhase) {
          const elapsed = elapsedSeconds();
          set({
            phaseSeconds: leavePhase(get(), elapsed),
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

      phaseSecondsNow: () => leavePhase(get(), get().elapsedSeconds()),

      toggleRequirement: (id) =>
        set((s) => {
          const has = s.answers.requirements.includes(id);
          return {
            answers: {
              ...s.answers,
              requirements: has
                ? s.answers.requirements.filter((x) => x !== id)
                : [...s.answers.requirements, id],
            },
          };
        }),
      setRequirementNotes: (text) =>
        set((s) => ({ answers: { ...s.answers, requirementNotes: text } })),
      setEstimate: (field, value) =>
        set((s) => {
          const estimates = { ...s.answers.estimates };
          if (value === undefined || !Number.isFinite(value) || value <= 0) delete estimates[field];
          else estimates[field] = value;
          return { answers: { ...s.answers, estimates } };
        }),
      addApi: () =>
        set((s) => ({
          answers: { ...s.answers, apis: [...s.answers.apis, { method: "GET", path: "" }] },
        })),
      updateApi: (index, patch) =>
        set((s) => ({
          answers: {
            ...s.answers,
            apis: s.answers.apis.map((a, i) => (i === index ? { ...a, ...patch } : a)),
          },
        })),
      removeApi: (index) =>
        set((s) => ({
          answers: { ...s.answers, apis: s.answers.apis.filter((_, i) => i !== index) },
        })),
      addEntity: () =>
        set((s) => ({
          answers: {
            ...s.answers,
            entities: [...s.answers.entities, { name: "", store: "sql", partitionKey: "" }],
          },
        })),
      updateEntity: (index, patch) =>
        set((s) => ({
          answers: {
            ...s.answers,
            entities: s.answers.entities.map((e, i) => (i === index ? { ...e, ...patch } : e)),
          },
        })),
      removeEntity: (index) =>
        set((s) => ({
          answers: { ...s.answers, entities: s.answers.entities.filter((_, i) => i !== index) },
        })),

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
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // Additive fields only (answers, phaseSeconds): old state merges over the defaults.
      migrate: passThroughMigration,
      partialize: (state) => ({
        mode: state.mode,
        currentPhase: state.currentPhase,
        timerRunning: state.timerRunning,
        timerSeconds: state.timerSeconds,
        phaseStartTime: state.phaseStartTime,
        startedAt: state.startedAt,
        accumulatedMs: state.accumulatedMs,
        phaseSeconds: state.phaseSeconds,
        answers: state.answers,
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
