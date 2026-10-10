import { describe, expect, it } from "vitest";
import { PROBLEMS } from "@/data/problems";
import { isReturnEdge, requestEdges, responseOf } from "@/domain/graph/returns";
import { buildReferenceGraph } from "@/lib/loadReference";

describe("reference solutions open with their responses (RET-25)", () => {
  it("every reference edge that is not async gets a response, and async ones get none", () => {
    expect(PROBLEMS).toHaveLength(35);
    for (const problem of PROBLEMS) {
      const { nodes, edges } = buildReferenceGraph(problem);
      const requests = requestEdges(edges);
      const responses = responseOf(edges);
      const nodeIds = new Set(nodes.map((n) => n.id));
      expect(requests.length, problem.id).toBeGreaterThan(0);
      const componentOf = new Map(
        nodes.map((n) => [n.id, (n.data as { componentId: string }).componentId]),
      );
      const asyncPairs = new Set(
        problem.referenceSolution.edges
          .filter((e) => e.async === true)
          .map((e) => `${e.source}>${e.target}`),
      );
      for (const r of requests) {
        const isAsync = asyncPairs.has(`${componentOf.get(r.source)}>${componentOf.get(r.target)}`);
        expect(responses.has(r.id), `${problem.id}: ${r.id}`).toBe(!isAsync);
        expect(r.data).not.toHaveProperty("async");
      }
      for (const res of edges.filter(isReturnEdge)) {
        const req = requests.find((r) => r.id === (res.data as { responseTo: string }).responseTo)!;
        expect([res.source, res.target], res.id).toEqual([req.target, req.source]);
        expect(nodeIds.has(res.source) && nodeIds.has(res.target)).toBe(true);
      }
    }
  });
});
