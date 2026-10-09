import { stepForTab, type RightTab } from "@/lib/steps";
import { useAppStore } from "./appStore";
import { useInterviewStore } from "./interviewStore";

/**
 * Open a tool of the right panel (the cost chip opens Cost, the SLO chip SLO,
 * Score opens the report). In free mode a tool the current step doesn't show
 * moves to the step that has it; in an interview the free-mode step is left
 * alone, so abandoning the interview returns to where the user was (WIZ-27).
 */
export function openTool(tab: RightTab): void {
  const app = useAppStore.getState();
  if (useInterviewStore.getState().mode !== "interview") {
    const step = stepForTab(tab, app.step);
    if (step !== app.step) app.setStep(step);
  }
  app.setActiveRightTab(tab);
}
