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
  it("answers each call that is not async, so it compiles as sync where a bare edge is now async", async () => {
    const { compileV3 } = await import("./engineFixtures");
    const sync = wire("client", "svc");
    const async = wire("svc", "db", { async: true });
    const direct = compileGraph(nodes, [sync, async]);
    const viaV3 = compileV3(nodes, [sync, async]);
    expect(direct.edges.map((e) => e.async)).toEqual([true, true]);
    expect(viaV3.edges.map((e) => e.async)).toEqual([false, true]);
    expect(viaV3.order).toEqual(direct.order);
  });
});

describe("async is the absence of a response (RET-06, RET-07)", () => {
  it("a request with a response compiles as sync, without one as async", () => {
    const a = call("client", "svc");
    const b = call("svc", "db");
    const byId = new Map(
      compileGraph(nodes, [a, makeReturnEdge(a), b]).edges.map((e) => [e.id, e]),
    );
    expect(byId.get(a.id)!.async).toBe(false);
    expect(byId.get(b.id)!.async).toBe(true);
  });

  it("deleting the response makes the request async on the next compile", () => {
    const a = call("client", "svc");
    expect(compileGraph(nodes, [a, makeReturnEdge(a)]).edges[0].async).toBe(false);
    expect(compileGraph(nodes, [a]).edges[0].async).toBe(true);
  });

  it("an async request still carries its load but is off the user path (same SimGraph as the flag before)", () => {
    const a = call("client", "svc");
    const b = call("svc", "db");
    const sync = compileGraph(nodes, [a, makeReturnEdge(a), b, makeReturnEdge(b)]);
    const mixed = compileGraph(nodes, [a, makeReturnEdge(a), b]);
    expect(sync.edges.map((e) => e.async)).toEqual([false, false]);
    expect(mixed.edges.map((e) => e.async)).toEqual([false, true]);
    expect(mixed.edges.map((e) => e.id)).toEqual(sync.edges.map((e) => e.id));
    expect(mixed.order).toEqual(sync.order);
  });
});
