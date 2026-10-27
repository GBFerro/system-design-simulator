import { describe, expect, it } from "vitest";
import { analyze } from "@/engine/analyze";
import { steadyStateToSnapshot } from "@/engine/snapshot";
import type { NodeSteadyState, SteadyState, TickSnapshot } from "@/engine/types";
import { nodeMetricsEqual, shareUnchanged } from "@/lib/runtimeMetrics";
import { comp, compileV3, wire } from "./engineFixtures";

/** A generic client → app → db steady state (no node has a technology). */
function genericSteady(): SteadyState {
  const graph = compileV3(
    [comp("client", "client"), comp("app", "app-server"), comp("db", "sql-db")],
    [wire("client", "app"), wire("app", "db")],
  );
  return analyze(graph, 500, { seed: 1, samples: 200 });
}

/** The same steady state with the limit fields set on `db`. */
function withLimit(
  steady: SteadyState,
  fields: Pick<NodeSteadyState, "limitKind" | "limitUtilization" | "writeRps">,
): SteadyState {
  return {
    ...steady,
    nodes: steady.nodes.map((n) => (n.nodeId === "db" ? { ...n, ...fields } : n)),
  };
}

describe("limit fields in the steady state and the snapshot (T26, TEC-41)", () => {
  it("a node's limitKind, limitUtilization and writeRps reach the snapshot unchanged", () => {
    const steady = withLimit(genericSteady(), {
      limitKind: "write-primary",
      limitUtilization: 1.25,
      writeRps: 6_250,
    });
    const db = steadyStateToSnapshot(steady).nodes.db;
    expect(db.limitKind).toBe("write-primary");
    expect(db.limitUtilization).toBe(1.25);
    expect(db.writeRps).toBe(6_250);
  });

  it("without them the snapshot gains no keys (the same snapshot as before)", () => {
    const steady = genericSteady();
    const snap = steadyStateToSnapshot(steady);
    for (const m of Object.values(snap.nodes)) {
      expect(Object.keys(m)).not.toContain("limitKind");
      expect(Object.keys(m)).not.toContain("limitUtilization");
      expect(Object.keys(m)).not.toContain("writeRps");
    }
    const db = steady.nodes.find((n) => n.nodeId === "db")!;
    expect(snap.nodes.db).toStrictEqual({
      rpsIn: db.offeredRps,
      rpsOut: db.servedRps,
      utilization: db.utilization,
      queueDepth: db.queueDepth,
      p50: db.p50Ms,
      p95: db.p95Ms,
      p99: db.p99Ms,
      errorRate: db.errorRate,
      drops: db.droppedRps,
      status: snap.nodes.db.status,
    });
  });

  describe("nodeMetricsEqual keeps sharing the node object", () => {
    const fields = {
      limitKind: "hot-partition",
      limitUtilization: 0.8,
      writeRps: 100,
    } as const;
    const snap = (f: Parameters<typeof withLimit>[1]): TickSnapshot =>
      steadyStateToSnapshot(withLimit(genericSteady(), f));

    it("shares the previous object when the three fields don't change", () => {
      const prev = snap(fields);
      const next = snap({ ...fields });
      expect(nodeMetricsEqual(prev.nodes.db, next.nodes.db)).toBe(true);
      expect(shareUnchanged(prev, next).nodes.db).toBe(prev.nodes.db);
    });

    it.each([
      ["limitKind", { ...fields, limitKind: "replica-ops" }],
      ["limitUtilization", { ...fields, limitUtilization: 0.81 }],
      ["writeRps", { ...fields, writeRps: 101 }],
    ] as const)("a new object when %s changes", (_name, changed) => {
      const prev = snap(fields);
      const next = snap(changed);
      expect(nodeMetricsEqual(prev.nodes.db, next.nodes.db)).toBe(false);
      const shared = shareUnchanged(prev, next);
      expect(shared.nodes.db).toBe(next.nodes.db);
      // (the other nodes keep their objects)
      expect(shared.nodes.app).toBe(prev.nodes.app);
    });
  });
});
