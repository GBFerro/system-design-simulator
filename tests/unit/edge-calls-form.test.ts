import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { callFormContext } from "@/components/panel/EdgeCallsForm";
import { comp, wire } from "./engineFixtures";

/**
 * The caches "reads after a miss" offers for a call of `app → db` (FLW-08):
 * only the source's synchronous calls to a node with a hit rate.
 */

const nodes = [
  comp("app", "app-server"),
  comp("db", "sql-db"),
  comp("redis", "cache"),
  comp("events", "cache"),
  comp("search", "search"),
];
const toDb = wire("app", "db");

const cachesFor = (others: Edge[]) =>
  callFormContext({ nodes, edges: [...others, toDb] }, toDb).caches;

describe("callFormContext: the caches a call can depend on (FLW-08)", () => {
  it("an async edge to a cache is left out", () => {
    expect(cachesFor([wire("app", "events", { async: true })])).toEqual([]);
  });

  it("a sync edge to a node without a hit rate is left out", () => {
    expect(cachesFor([wire("app", "search")])).toEqual([]);
  });

  it("a sync edge to a cache is offered", () => {
    expect(cachesFor([wire("app", "redis")])).toEqual([{ id: "redis", label: "redis" }]);
  });

  it("with all three, only the sync cache is offered", () => {
    expect(
      cachesFor([
        wire("app", "events", { async: true }),
        wire("app", "search"),
        wire("app", "redis"),
      ]),
    ).toEqual([{ id: "redis", label: "redis" }]);
  });
});
