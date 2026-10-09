import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { applyDiff, insertBetween } from "@/advisor/graph";
import { makeReturnEdge, responseOf } from "@/domain/graph/returns";
import { comp, wire } from "./engineFixtures";

const nodes = [comp("a", "client"), comp("b", "app-server"), comp("c", "sql-db")];

describe("insertBetween keeps the response of the link it splits (RET-26, RET-27)", () => {
  it("a synchronous link gives both halves a response and drops the old one", () => {
    const ab = wire("a", "b");
    const graph = { nodes, edges: [ab, makeReturnEdge(ab)] };
    const diff = insertBetween(graph, ab, "rate-limiter", { idBase: "rl" });
    const added = diff.addEdges;
    const requests = added.filter((e) => !e.id.startsWith("ret:"));
    expect(requests.map((e) => [e.source, e.target])).toEqual([
      ["a", "rl"],
      ["rl", "b"],
    ]);
    expect(requests.map((e) => responseOf(added).has(e.id))).toEqual([true, true]);
    expect(diff.removeEdgeIds).toEqual([ab.id, "ret:" + ab.id]);

    const after = applyDiff(graph, diff);
    expect(after.edges.some((e) => e.id === "ret:" + ab.id)).toBe(false);
    expect(after.edges.filter((e) => e.id.startsWith("ret:"))).toHaveLength(2);
  });

  it("an async link stays async: no response on either half (RET-27)", () => {
    const ab = wire("a", "b", { async: true });
    const diff = insertBetween({ nodes, edges: [ab] }, ab, "message-queue", { idBase: "q" });
    expect(diff.addEdges.some((e) => e.id.startsWith("ret:"))).toBe(false);
    expect(diff.addEdges.every((e) => (e.data as { async?: boolean }).async === true)).toBe(true);
    expect(diff.removeEdgeIds).toEqual([ab.id]);
  });

  it("keepLinkOnOut keeps the old id on the out half and answers it with the same id", () => {
    const bc = wire("b", "c");
    const graph = { nodes, edges: [bc, makeReturnEdge(bc)] };
    const diff = insertBetween(graph, bc, "circuit-breaker", { idBase: "cb", keepLinkOnOut: true });
    const out = diff.addEdges.find((e) => e.id === bc.id) as Edge;
    expect([out.source, out.target]).toEqual(["cb", "c"]);
    const response = diff.addEdges.find((e) => e.id === "ret:" + bc.id) as Edge;
    expect([response.source, response.target]).toEqual(["c", "cb"]);
    const after = applyDiff(graph, diff);
    expect(after.edges.filter((e) => e.id === "ret:" + bc.id)).toHaveLength(1);
    expect(responseOf(after.edges).get(bc.id)!.source).toBe("c");
  });
});
