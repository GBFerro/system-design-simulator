import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  asyncRequestIds,
  isReturnEdge,
  makeReturnEdge,
  requestEdges,
  responseOf,
  returnIdOf,
  withReturns,
} from "@/domain/graph/returns";

const req = (
  id: string,
  source: string,
  target: string,
  data: Record<string, unknown> = {},
): Edge => ({
  id,
  source,
  target,
  data,
});

describe("returns (RET-04, RET-09)", () => {
  it("makeReturnEdge reverses the ends and uses the return handles and a derived id", () => {
    const ret = makeReturnEdge(req("e-a-b", "a", "b"));
    expect(ret.id).toBe("ret:e-a-b");
    expect(returnIdOf("e-a-b")).toBe("ret:e-a-b");
    expect(ret.source).toBe("b");
    expect(ret.target).toBe("a");
    expect(ret.sourceHandle).toBe("ret-out");
    expect(ret.targetHandle).toBe("ret-in");
    expect(ret.data).toEqual({ responseTo: "e-a-b" });
    expect(isReturnEdge(ret)).toBe(true);
  });

  it("requestEdges drops responses, keeping requests in order", () => {
    const a = req("e1", "a", "b");
    const b = req("e2", "b", "a");
    const edges = [a, makeReturnEdge(a), b];
    expect(requestEdges(edges).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("responseOf maps the request id to its response", () => {
    const a = req("e1", "a", "b");
    const ret = makeReturnEdge(a);
    expect(responseOf([a, ret]).get("e1")).toBe(ret);
    expect(responseOf([a]).has("e1")).toBe(false);
  });

  it("asyncRequestIds holds only the requests without a response", () => {
    const a = req("e1", "a", "b");
    const b = req("e2", "b", "c");
    const c = req("e3", "c", "d", { async: true });
    const answeredLegacy = [a, makeReturnEdge(a), b, c, makeReturnEdge(c)];
    // e1 has a response; e2 has none; e3 carries the legacy flag even with a response.
    expect([...asyncRequestIds(answeredLegacy)].sort()).toEqual(["e2", "e3"]);
  });

  it("withReturns adds a response for every non-async request, and is idempotent", () => {
    const a = req("e1", "a", "b");
    const b = req("e2", "b", "c", { async: true });
    const once = withReturns([a, b]);
    expect(once.map((e) => e.id)).toEqual(["e1", "e2", "ret:e1"]);
    expect(withReturns(once).map((e) => e.id)).toEqual(["e1", "e2", "ret:e1"]);
  });

  it("withReturns honors a custom async predicate", () => {
    const a = req("e1", "a", "b");
    expect(withReturns([a], () => true).map((e) => e.id)).toEqual(["e1"]);
  });
});
