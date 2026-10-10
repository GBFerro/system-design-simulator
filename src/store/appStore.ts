import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";
import { APP_STORAGE_KEY, passThroughMigration, STORE_VERSION } from "./persistVersion";
import { isCurrency, type Currency } from "@/cost/currency";
import {
  STEPS,
  TOOLS_BY_STEP,
  sanitizeStep,
  stepIndex,
  type RightTab,
  type Step,
} from "@/lib/steps";

export { APP_STORAGE_KEY };

export type ToastType = "success" | "error" | "info";
export type Theme = "dark" | "light";

interface ToastData {
  message: string;
  type: ToastType;
}

/** Apply the theme by toggling the `dark` class on <html> (Tailwind dark variant). */
export function applyThemeClass(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface AppState {
  selectedProblemId: string;
  theme: Theme;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  activeRightTab: RightTab;
  /** The step of the guided layout in free mode (WIZ-*); an interview has its own phase. Persisted. */
  step: Step;
  /** Display currency of the cost estimates (Spec 10, CST-04). */
  currency: Currency;
  toast: ToastData | null;

  setSelectedProblem: (id: string) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setActiveRightTab: (tab: AppState["activeRightTab"]) => void;
  /** The next step; the last has none (WIZ-02, WIZ-15). */
  nextStep: () => void;
  /** The previous step; the first has none (WIZ-03, WIZ-04). */
  backStep: () => void;
  /** Jump to the current or an earlier step only: nothing ahead is reachable by clicking (WIZ-05, WIZ-06). */
  goToStep: (step: Step) => void;
  /** Set the step directly (finishing an interview lands in Evaluate, WIZ-26). */
  setStep: (step: Step) => void;
  setCurrency: (currency: Currency) => void;
  showToast: (message: string, type: ToastType) => void;
  clearToast: () => void;
}

/** The patch that moves to `step`: its first tool opens with it. */
function withStep(
  s: { activeRightTab: RightTab },
  step: Step,
): Pick<AppState, "step" | "activeRightTab"> {
  return { step, activeRightTab: TOOLS_BY_STEP[step][0] ?? s.activeRightTab };
}

// Single owner of the toast auto-dismiss timer (4s). showToast resets it,
// clearToast cancels it — no other code should schedule toast dismissal.
let toastTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedProblemId: "url-shortener",
      theme: "dark",
      leftSidebarOpen: true,
      rightPanelOpen: true,
      activeRightTab: "properties",
      step: "problem",
      currency: "USD",
      toast: null,

      setSelectedProblem: (id) => set({ selectedProblemId: id }),
      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },
      toggleTheme: () =>
        set((s) => {
          const theme: Theme = s.theme === "dark" ? "light" : "dark";
          applyThemeClass(theme);
          return { theme };
        }),
      toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
      setActiveRightTab: (tab) => set({ activeRightTab: tab }),
      // Changing step only changes what is visible: never the graph, the history or a live run (AD-004).
      // The step's first tool opens with it.
      nextStep: () =>
        set((s) => withStep(s, STEPS[Math.min(STEPS.length - 1, stepIndex(s.step) + 1)])),
      backStep: () => set((s) => withStep(s, STEPS[Math.max(0, stepIndex(s.step) - 1)])),
      goToStep: (step) =>
        set((s) => (stepIndex(step) <= stepIndex(s.step) ? withStep(s, step) : s)),
      setStep: (step) => set((s) => withStep(s, sanitizeStep(step))),
      setCurrency: (currency) => set({ currency: isCurrency(currency) ? currency : "USD" }),
      showToast: (message, type) => {
        if (toastTimeoutId !== null) {
          clearTimeout(toastTimeoutId);
        }
        set({ toast: { message, type } });
        toastTimeoutId = setTimeout(() => {
          set({ toast: null });
          toastTimeoutId = null;
        }, 4000);
      },
      clearToast: () => {
        if (toastTimeoutId !== null) {
          clearTimeout(toastTimeoutId);
          toastTimeoutId = null;
        }
        set({ toast: null });
      },
    }),
    {
      name: APP_STORAGE_KEY,
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // Shape unchanged in v2 (`currency` is optional: the default fills it in).
      migrate: passThroughMigration,
      partialize: (state) => ({
        selectedProblemId: state.selectedProblemId,
        step: state.step,
        theme: state.theme,
        currency: state.currency,
      }),
      // A stored currency this build doesn't know falls back to the default.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          currency: isCurrency(p.currency) ? p.currency : current.currency,
          step: sanitizeStep(p.step),
        };
      },
      // Apply the persisted theme to <html> as soon as the store rehydrates.
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyThemeClass(state.theme);
      },
    },
  ),
);
