import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { compileGraph } from "@/domain/graph/compile";
import { makeReturnEdge } from "@/domain/graph/returns";
import { comp, wire } from "./engineFixtures";

const nodes = [comp("client", "client"), comp("svc", "app-server"), comp("db", "sql-db")];
const call = (source: string, target: string): Edge => wire(source, target);

describe("compileGraph ignores responses (RET-09, RET-31)", () => {
  it("responses are not edges of the SimGraph: no load, no cycle, no back edge (RET-09)", () => {
    const a = call("client", "svc");
    const b = call("svc", "db");
    const plain = compileGraph(nodes, [a, b]);
    const graph = compileGraph(nodes, [a, makeReturnEdge(a), b, makeReturnEdge(b)]);
    expect(graph.edges.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(graph.edges.every((e) => !e.back)).toBe(true);
    expect(graph.cycleIds).toEqual([]);
    expect(graph.order).toEqual(["client", "svc", "db"]);
    expect(graph.entryIds).toEqual(["client"]);
    expect(graph.warnings).toEqual(plain.warnings);
  });

  it("A → B and B → A with their own responses compile as the same two requests (RET-31)", () => {
    const ab = call("svc", "db");
    const ba = call("db", "svc");
    const plain = compileGraph(nodes, [ab, ba]);
    const withReturns = compileGraph(nodes, [ab, makeReturnEdge(ab), ba, makeReturnEdge(ba)]);
    expect(withReturns.cycleIds).toEqual(plain.cycleIds);
    expect(withReturns.edges.map((e) => [e.id, e.back])).toEqual(
      plain.edges.map((e) => [e.id, e.back]),
    );
  });

  it("a response without its request is ignored with a warning, never an exception", () => {
    const orphan = makeReturnEdge(call("client", "svc"));
    const graph = compileGraph(nodes, [orphan]);
    expect(graph.edges).toEqual([]);
    expect(graph.warnings.some((w) => w.includes("response"))).toBe(true);
  });

  it("the legacy async flag still forces async", () => {
    const a = wire("client", "svc", { async: true });
    expect(compileGraph(nodes, [a, makeReturnEdge(a)]).edges[0].async).toBe(true);
  });
});

describe("compileV3 fixture helper (RET-22)", () => {
  it("answers each call that is not async, so both compile as they did before responses existed", async () => {
    const { compileV3 } = await import("./engineFixtures");
    const sync = wire("client", "svc");
    const async = wire("svc", "db", { async: true });
    const direct = compileGraph(nodes, [sync, async]);
    const viaV3 = compileV3(nodes, [sync, async]);
    expect(viaV3.edges.map((e) => [e.id, e.async])).toEqual(
      direct.edges.map((e) => [e.id, e.async]),
    );
    expect(viaV3.order).toEqual(direct.order);
  });
});
