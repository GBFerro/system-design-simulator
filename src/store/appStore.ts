import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "./safeStorage";
import { passThroughMigration, STORE_VERSION } from "./persistVersion";
import { isCurrency, type Currency } from "@/cost/currency";

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
  activeLeftTab: "components" | "problems" | "learn";
  activeRightTab:
    | "properties"
    | "simulation"
    | "chaos"
    | "score"
    | "advisor"
    | "cost"
    | "capacity"
    | "tradeoffs";
  /** Display currency of the cost estimates (Spec 10, CST-04). */
  currency: Currency;
  toast: ToastData | null;

  setSelectedProblem: (id: string) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setActiveLeftTab: (tab: AppState["activeLeftTab"]) => void;
  setActiveRightTab: (tab: AppState["activeRightTab"]) => void;
  setCurrency: (currency: Currency) => void;
  showToast: (message: string, type: ToastType) => void;
  clearToast: () => void;
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
      activeLeftTab: "components",
      activeRightTab: "properties",
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
      setActiveLeftTab: (tab) => set({ activeLeftTab: tab }),
      setActiveRightTab: (tab) => set({ activeRightTab: tab }),
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
      name: "systemsim-app",
      version: STORE_VERSION,
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      // Shape unchanged in v2 (`currency` is optional: the default fills it in).
      migrate: passThroughMigration,
      partialize: (state) => ({
        selectedProblemId: state.selectedProblemId,
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
        };
      },
      // Apply the persisted theme to <html> as soon as the store rehydrates.
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyThemeClass(state.theme);
      },
    },
  ),
);
