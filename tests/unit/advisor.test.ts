import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { structureFindings } from "@/advisor/structure";
import { PROBLEMS } from "@/data/problems";
import { buildReferenceGraph } from "@/lib/loadReference";
import { comp as node, text, wire } from "./engineFixtures";

const ids = (nodes: Node[], edges: Edge[]) => structureFindings(nodes, edges).map((f) => f.id);

describe("structure hints (ADV-03)", () => {
  it("nothing to say about an empty canvas or text-only notes", () => {
    expect(structureFindings([], [])).toEqual([]);
    expect(structureFindings([text("t")], [])).toEqual([]);
  });

  it("no entry point: a lone node or a pure cycle is critical; wiring an entry fixes it", () => {
    expect(ids([node("a", "app-server")], [])).toEqual(["no-entry"]);
    const cycle = [node("a", "app-server"), node("b", "app-server")];
    const [f] = structureFindings(cycle, [wire("a", "b"), wire("b", "a")]);
    expect(f).toMatchObject({ id: "no-entry", severity: "critical", source: "structure" });
    expect(
      ids([...cycle, node("c", "client")], [wire("c", "a"), wire("a", "b"), wire("b", "a")]),
    ).toEqual([]);
  });

  it("disconnected nodes are warned about until they are wired", () => {
    const nodes = [node("c", "client"), node("app", "app-server"), node("cache", "cache")];
    const f = structureFindings(nodes, [wire("c", "app")]);
    expect(f).toEqual([
      expect.objectContaining({
        id: "disconnected:cache",
        severity: "warning",
        targetIds: ["cache"],
      }),
    ]);
    expect(ids(nodes, [wire("c", "app"), wire("app", "cache")])).toEqual([]);
  });

  it("SPOF: a single-instance SQL database on the sync path", () => {
    const nodes = [node("c", "client"), node("app", "app-server"), node("db", "sql-db")];
    const edges = [wire("c", "app"), wire("app", "db")];
    expect(ids(nodes, edges)).toEqual(["spof:db"]);
    // App Server scales horizontally (catalog `scalable`), like the scorer assumes.
    expect(ids([node("c", "client"), node("app", "app-server")], [wire("c", "app")])).toEqual([]);
    // Fixed by a second instance, or by a read replica next to it…
    expect(ids([nodes[0], nodes[1], node("db", "sql-db", { instances: 2 })], edges)).toEqual([]);
    expect(
      ids(
        [...nodes, node("rr", "read-replica")],
        [...edges, wire("app", "rr", { rule: { kind: "reads" } })],
      ),
    ).toEqual([]);
    // …and not flagged off the user path (async, or behind a queue).
    expect(ids(nodes, [wire("c", "app"), wire("app", "db", { async: true })])).toEqual([]);
    expect(
      ids(
        [...nodes, node("q", "message-queue")],
        [wire("c", "app"), wire("app", "q"), wire("q", "db")],
      ),
    ).toEqual([]);
  });

  it("critical findings come first", () => {
    const f = structureFindings(
      [node("a", "app-server"), node("b", "app-server")],
      [wire("a", "b"), wire("b", "a")],
    );
    expect(f[0].severity).toBe("critical");
  });

  it("reference solutions have an entry point and nothing disconnected", () => {
    for (const p of PROBLEMS) {
      const { nodes, edges } = buildReferenceGraph(p);
      const found = structureFindings(nodes, edges);
      const blocking = found.filter((f) => f.id === "no-entry" || f.id.startsWith("disconnected:"));
      expect(blocking, p.id).toEqual([]);
    }
  });
});
