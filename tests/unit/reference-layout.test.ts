import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { buildReferenceGraph } from "@/lib/loadReference";
import { DEFAULT_NODE_SIZE } from "@/lib/placement";

/** Strict overlap: boxes that only touch along an edge do not overlap. */
export function boxesOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
  size = DEFAULT_NODE_SIZE,
): boolean {
  return (
    a.x < b.x + size.width &&
    b.x < a.x + size.width &&
    a.y < b.y + size.height &&
    b.y < a.y + size.height
  );
}

describe("reference layouts", () => {
  it("DEFAULT_NODE_SIZE is the 160 x 120 isometric footprint", () => {
    expect(DEFAULT_NODE_SIZE).toEqual({ width: 160, height: 120 });
  });

  it("covers every reference solution", () => {
    const withRef = PROBLEMS.filter((p) => p.referenceSolution.nodes.length > 0);
    expect(withRef.length).toBeGreaterThan(0);
    expect(withRef).toHaveLength(PROBLEMS.length);
  });

  describe.each(PROBLEMS.map((p) => [p.id, p] as const))("%s", (_id, problem) => {
    it("places every node box without overlap at DEFAULT_NODE_SIZE", () => {
      const { nodes } = buildReferenceGraph(problem);
      expect(nodes.length).toBe(problem.referenceSolution.nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          expect(
            boxesOverlap(a.position, b.position),
            `${problem.id}: nodes ${a.id} (${a.position.x},${a.position.y}) and ${b.id} (${b.position.x},${b.position.y}) overlap`,
          ).toBe(false);
        }
      }
    });
    it("keeps a 16 px clearance between node boxes", () => {
      const { nodes } = buildReferenceGraph(problem);
      const padded = {
        width: DEFAULT_NODE_SIZE.width + 16,
        height: DEFAULT_NODE_SIZE.height + 16,
      };
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          expect(
            boxesOverlap(nodes[i].position, nodes[j].position, padded),
            `${problem.id}: nodes ${nodes[i].id} and ${nodes[j].id} are closer than 16 px`,
          ).toBe(false);
        }
      }
    });
  });
});
