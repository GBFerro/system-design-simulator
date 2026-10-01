import { describe, expect, it } from "vitest";
import { INTERVIEW_DATA } from "@/data/interviewData";
import { PROBLEMS } from "@/data/problems";
import { buildReport } from "@/interview/report";
import { scoreDesign } from "@/scoring/scorer";
import { EMPTY_ANSWERS } from "@/store/interviewStore";

const problem = PROBLEMS.find((p) => p.id === "url-shortener")!;
const data = INTERVIEW_DATA.find((d) => d.problemId === "url-shortener")!;
const phases = [
  { name: "Requirements", targetMinutes: 5 },
  { name: "Estimation", targetMinutes: 5 },
];

describe("buildReport (Spec 09)", () => {
  it("grades every phase answer, adds the process score and is JSON-safe", () => {
    const critical = data.requirements.filter((r) => r.importance === "critical").map((r) => r.id);
    const report = buildReport({
      problem,
      data,
      answers: {
        ...EMPTY_ANSWERS,
        requirements: critical,
        estimates: { readsPerSec: problem.requirements.readsPerSec },
        apis: [{ method: data.referenceAPIs[0].method, path: data.referenceAPIs[0].path }],
      },
      phases,
      phaseSeconds: [120, 700],
      score: scoreDesign([], []),
      measured: true,
      drill: [{ label: "Kill node · App", mitigated: true, reactionSec: 12, budgetUsed: 0.4 }],
      now: new Date("2026-09-30T12:00:00Z"),
    });
    expect(report.problemId).toBe("url-shortener");
    expect(report.durationSec).toBe(820);
    expect(report.phases).toEqual([
      { name: "Requirements", seconds: 120, targetSeconds: 300 },
      { name: "Estimation", seconds: 700, targetSeconds: 300 },
    ]);
    expect(report.requirements.covered).toBe(critical.length);
    expect(report.estimates.find((e) => e.field === "readsPerSec")!.ok).toBe(true);
    expect(report.apis.matched).toHaveLength(1);
    expect(report.dataModel.entities.every((e) => !e.found)).toBe(true);
    const time = report.process.items.find((i) => i.label === "Time management")!;
    expect(time.detail).toMatch(/1 phase ran over/);
    expect(report.process.items.find((i) => i.label === "Drill reaction time")!.score).toBe(1);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
