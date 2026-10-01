import { create } from "zustand";
import type { InterviewReport } from "@/interview/report";
import { createDurableKV } from "./durableStorage";

/**
 * Interview reports (Spec 09). The open report is unpersisted UI state; the
 * attempt history lives in IndexedDB (via `createDurableKV`, one key per
 * problem) so progress on a problem survives across sessions.
 */
export const MAX_ATTEMPTS = 20;
const key = (problemId: string) => `systemsim-attempts:${problemId}`;

const kv = createDurableKV();

/** Attempts at a problem, newest first. */
export async function loadAttempts(problemId: string): Promise<InterviewReport[]> {
  const list = await kv.get<InterviewReport[]>(key(problemId));
  return Array.isArray(list) ? list : [];
}

/** Stores a finished attempt (newest first, capped); returns the updated history. */
export async function saveAttempt(report: InterviewReport): Promise<InterviewReport[]> {
  const list = [report, ...(await loadAttempts(report.problemId))].slice(0, MAX_ATTEMPTS);
  await kv.set(key(report.problemId), list);
  return list;
}

interface ReportState {
  report: InterviewReport | null;
  /** The same problem's attempts, newest first (the current one included). */
  history: InterviewReport[];
  open: boolean;
  show: (report: InterviewReport, history: InterviewReport[]) => void;
  close: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  report: null,
  history: [],
  open: false,
  show: (report, history) => set({ report, history, open: true }),
  close: () => set({ open: false }),
}));
