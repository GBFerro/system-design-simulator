import { describe, expect, it } from "vitest";
import { INTERVIEW_DATA } from "@/data/interviewData";
import { LEARNING_PATH, PROBLEM_CONCEPTS } from "@/data/learningPath";
import { PROBLEMS } from "@/data/problems";

// Ids, duplicates and learning-path coverage are in catalog.test.ts; this file
// checks the "Data conventions" of CLAUDE.md that are about order and wiring.

/** Problem ids in learning-path order (tiers in order, problems in tier order). */
const pathOrder = LEARNING_PATH.flatMap((tier) => tier.problemIds);

describe("learning path", () => {
  it("prerequisites are concepts taught by a strictly earlier problem", () => {
    const concepts = new Map(PROBLEM_CONCEPTS.map((c) => [c.problemId, c]));
    const taught = new Set<string>();
    for (const problemId of pathOrder) {
      const entry = concepts.get(problemId);
      expect(entry, `${problemId} has no PROBLEM_CONCEPTS entry`).toBeDefined();
      for (const prereq of entry!.prerequisites)
        expect(taught.has(prereq), `${problemId} requires "${prereq}" before it is taught`).toBe(
          true,
        );
      for (const concept of entry!.concepts) taught.add(concept);
    }
  });

  it("every problem has a tier and interview data", () => {
    const withInterviewData = INTERVIEW_DATA.map((d) => d.problemId);
    expect(new Set(withInterviewData).size).toBe(withInterviewData.length);
    for (const { id } of PROBLEMS) {
      expect(pathOrder, `${id} has no learning-path tier`).toContain(id);
      expect(withInterviewData, `${id} has no interviewData entry`).toContain(id);
    }
  });
});

describe("reference solutions", () => {
  it("each has an entry node (in-degree 0 with an outgoing edge)", () => {
    for (const { id, referenceSolution } of PROBLEMS) {
      const { nodes, edges } = referenceSolution;
      const hasEntry = nodes.some(
        (n) =>
          edges.some((e) => e.source === n.componentId && e.target !== n.componentId) &&
          !edges.some((e) => e.target === n.componentId && e.source !== n.componentId),
      );
      expect(hasEntry, `${id}: no entry node, nothing on the request path is reachable`).toBe(true);
    }
  });
});
