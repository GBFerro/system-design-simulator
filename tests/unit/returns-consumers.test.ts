import { describe, expect, it } from "vitest";
import { computeFindings } from "@/advisor/advisor";
import { makeReturnEdge, requestsWithAsync, withReturns } from "@/domain/graph/returns";
import { topologySignature } from "@/lib/topology";
import { buildScoringGraph } from "@/scoring/scorer";
import { syncPath } from "@/scoring/paths";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { Node } from "@xyflow/react";
import { comp, wire } from "./engineFixtures";

// guided-ui, RET-07/RET-09: the readers of a design see requests only, and
// "sync" is the response.

const nodes = [
  comp("c", "client"),
  comp("app", "app-server"),
  comp("db", "sql-db"),
  comp("mon", "monitoring"),
] as Node<ComponentNodeData>[];
const requests = [wire("c", "app"), wire("app", "db"), wire("app", "mon")];
const answered = (ids: string[]) =>
  requests.flatMap((r) => (ids.includes(r.id) ? [r, makeReturnEdge(r)] : [r]));

describe("requestsWithAsync", () => {
  it("drops the responses and marks a request async when nothing answers it", () => {
    const edges = answered(["e-c-app", "e-app-db"]);
    const view = requestsWithAsync(edges);
    expect(view.map((e) => [e.id, (e.data as { async: boolean }).async])).toEqual([
      ["e-c-app", false],
      ["e-app-db", false],
      ["e-app-mon", true],
    ]);
  });
});

describe("scoring reads requests, with async from the missing response (RET-09)", () => {
  const depthOf = (edges: ReturnType<typeof answered>) => {
    const view = requestsWithAsync(edges);
    const path = syncPath(nodes, view, buildScoringGraph(nodes, view));
    return { depth: path.depth, onPath: [...path.onPath].sort() };
  };

  it("responses add no node to the path and no depth: client → app → db and monitoring", () => {
    const path = depthOf(withReturns(requests));
    expect(path.onPath).toEqual(["app", "c", "db", "mon"]);
    expect(path.depth).toBe(3);
  });

  it("a request without a response is off the user path", () => {
    const path = depthOf(answered(["e-c-app", "e-app-db"]));
    expect(path.onPath).toEqual(["app", "c", "db"]);
  });
});

describe("advisor findings ignore the responses (RET-09)", () => {
  it("a design with all its responses has an entry point and no cycle, in any edge order", () => {
    const ctx = { readRatio: 0.5 };
    const all = withReturns(requests);
    const findings = computeFindings({ nodes, edges: all }, ctx).map((f) => f.id);
    expect(findings).not.toContain("no-entry");
    const reversed = computeFindings({ nodes, edges: [...all].reverse() }, ctx).map((f) => f.id);
    expect(reversed.sort()).toEqual([...findings].sort());
  });
});

describe("topologySignature and the responses (RET-07)", () => {
  it("changes when a response is drawn or deleted, not when a node moves", () => {
    const all = answered(["e-c-app", "e-app-db"]);
    const without = all.filter((e) => e.id !== "ret:e-app-db");
    expect(topologySignature(nodes, all)).not.toBe(topologySignature(nodes, without));
    const moved = nodes.map((n) => ({ ...n, position: { x: 99, y: 99 } }));
    expect(topologySignature(moved, all)).toBe(topologySignature(nodes, all));
  });
});
