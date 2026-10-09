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
      for (const r of requests) {
        const flagged = (r.data as { async?: boolean }).async === true;
        expect(responses.has(r.id), `${problem.id}: ${r.id}`).toBe(!flagged);
      }
      for (const res of edges.filter(isReturnEdge)) {
        const req = requests.find((r) => r.id === (res.data as { responseTo: string }).responseTo)!;
        expect([res.source, res.target], res.id).toEqual([req.target, req.source]);
        expect(nodeIds.has(res.source) && nodeIds.has(res.target)).toBe(true);
      }
    }
  });
});
