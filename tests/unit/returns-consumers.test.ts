import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

/**
 * "Only `src/domain/graph/returns.ts` knows what a response is" (CLAUDE.md,
 * Calls and responses): the field `responseTo` and the id prefix `ret:` appear
 * in no other source file (comments aside), so every reader goes through the
 * helpers (`responseToOf`, `returnData`, `returnIdOf`, ...). A file that must
 * name them stays in ALLOWED with the reason.
 */
const SRC = resolve(__dirname, "../../src");
const OWNER = "src/domain/graph/returns.ts";

const ALLOWED: Record<string, string> = {
  "src/domain/persistence/serialize.ts":
    "SerializedEdgeData declares the on-disk field `responseTo` (the v4 file format); reads and writes go through the helpers",
};

const LITERAL = /\bresponseTo\b|\bret:/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Code without comments (block comments, and `//` at a line start or after whitespace). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("response consumers", () => {
  const files = sourceFiles(SRC).map((p) => ({
    rel: relative(resolve(SRC, ".."), p).replaceAll("\\", "/"),
    code: withoutComments(readFileSync(p, "utf8")),
  }));

  it("only returns.ts names `responseTo` or `ret:` outside the allowlist", () => {
    const offenders = files
      .filter((f) => f.rel !== OWNER && !(f.rel in ALLOWED) && LITERAL.test(f.code))
      .map((f) => f.rel);
    expect(offenders, "use the returns.ts helpers, or allowlist the file with a reason").toEqual(
      [],
    );
  });

  it("the allowlist has no stale entries", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const f = files.find((x) => x.rel === rel);
      return !f || !LITERAL.test(f.code);
    });
    expect(stale).toEqual([]);
  });

  it("returns.ts itself still owns the literals", () => {
    const owner = files.find((f) => f.rel === OWNER);
    expect(owner && LITERAL.test(owner.code)).toBe(true);
  });
});
