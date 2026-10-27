import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { techPreset } from "@/domain/components/technologies";
import type { Params } from "@/domain/components/types";
import type { SimNode } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { TickSimulator, techTickFlow, type TechTick } from "@/engine/core/tick";
import { TICK_SEC } from "@/engine/traffic/types";
import { comp, compileV3, wire } from "./engineFixtures";

/** Technology mechanics in the tick loop (component-technologies T28). */

function techNode(id: string, componentId: string, technology: string, params: Params = {}): Node {
  return comp(id, componentId, { ...techPreset(componentId, technology), ...params });
}

function simNode(node: Node): SimNode {
  return compileV3([node], []).nodes[0];
}

const WRITE_CAP = techPreset("sql-db", "postgres").writeCapacityRps as number; // 5,000

/** Steps a Postgres node's stations `ticks` times at a constant arrival rate. */
function stepPostgres(
  arriving: number,
  writeShare: number,
  ticks: number,
  maxQueue: number,
): TechTick[] {
  const db = simNode(techNode("db", "sql-db", "postgres", { instances: 8, shards: 1 }));
  const out: TechTick[] = [];
  let backlog = 0;
  let primaryBacklog = 0;
  for (let i = 0; i < ticks; i++) {
    const t = techTickFlow({
      profile: db.tech!,
      core: db,
      arriving,
      writeShare,
      backlog,
      primaryBacklog,
      maxQueue,
      dtSec: TICK_SEC,
      horizonSec: 10,
    });
    backlog = t.backlog;
    primaryBacklog = t.primaryBacklog;
    out.push(t);
  }
  return out;
}

describe("SQL write primary in the tick (TEC-26)", () => {
  it("the write backlog grows while the read backlog stays 0", () => {
    // 6,000 writes/s against a 5,000/s primary, 6,000 reads/s on 8 × 40,000.
    const ticks = stepPostgres(12_000, 0.5, 20, Infinity);
    ticks.forEach((t, i) => {
      expect(t.backlog).toBe(0);
      expect(t.primaryBacklog).toBeCloseTo((i + 1) * (6_000 - WRITE_CAP) * TICK_SEC, 6);
    });
    const last = ticks[ticks.length - 1];
    // The primary completes at its capacity, the reads all of theirs.
    expect(last.completed).toBeCloseTo(6_000 + WRITE_CAP, 6);
    expect(last.view.read.station.meanWaitMs).toBeLessThan(1);
    expect(last.view.write.station.meanWaitMs).toBeCloseTo(
      (last.primaryBacklog / WRITE_CAP) * 1000,
      6,
    );
  });

  it("past `maxQueue` the excess writes overflow and fail", () => {
    const ticks = stepPostgres(8_000, 1, 10, 100);
    const last = ticks[ticks.length - 1];
    expect(last.primaryBacklog).toBe(100);
    expect(last.overflow).toBeCloseTo(8_000 - WRITE_CAP, 6);
    expect(last.dropped).toBeCloseTo(8_000 - WRITE_CAP, 6);
    expect(last.view.write.dropProbability).toBeCloseTo(3 / 8, 9);
  });

  it("reads routed around the write backlog don't time out; writes do", () => {
    const graph = compileV3(
      [
        comp("client", "client"),
        comp("appR", "app-server", { instances: 4, timeoutMs: 200 }),
        comp("appW", "app-server", { instances: 4, timeoutMs: 200 }),
        techNode("db", "sql-db", "postgres", { instances: 8, shards: 1 }),
      ],
      [
        wire("client", "appR", { rule: { kind: "reads" } }),
        wire("client", "appW", { rule: { kind: "writes" } }),
        wire("appR", "db"),
        wire("appW", "db"),
      ],
    );
    const sim = new TickSimulator(graph, { seed: 3, readRatio: 0.5, tickSamples: 50 });
    let snap = sim.step(12_000);
    for (let i = 1; i < 60; i++) snap = sim.step(12_000);
    // After 3 s about 3,000 writes wait: 600 ms in line, past the 200 ms timeout.
    expect(snap.edgeLinkFailure!["e-appW-db"]).toBeGreaterThan(0.9);
    expect(snap.edgeLinkFailure!["e-appR-db"]).toBeLessThan(0.01);
    expect(snap.nodes.db.limitKind).toBe("write-primary");
    expect(snap.nodes.db.queueDepth).toBeGreaterThan(2_000);
  });
});

describe("AWS API Gateway burst in the tick (TEC-38)", () => {
  const gateway = () =>
    compileV3(
      [comp("client", "client"), techNode("gw", "api-gateway", "aws-api-gateway")],
      [wire("client", "gw")],
    );

  it("the 5,000 burst absorbs 1 s (within a tick), then 5,000 req/s fail", () => {
    const sim = new TickSimulator(gateway(), { seed: 11, tickSamples: 50 });
    const snaps = Array.from({ length: 60 }, () => sim.step(15_000));
    const firstDrop = snaps.find((s) => s.nodes.gw.drops > 0)!;
    // Full bucket: −750 + 500 per tick, so B ÷ (λ − L) = 1.0 s; Poisson arrivals move it a tick at most.
    expect(firstDrop.t).toBeGreaterThanOrEqual(0.95);
    expect(firstDrop.t).toBeLessThanOrEqual(1.05);
    for (const s of snaps.filter((x) => x.t < 0.95)) expect(s.nodes.gw.drops).toBe(0);
    for (const s of snaps.filter((x) => x.t > firstDrop.t)) {
      // Bucket empty: exactly the 10,000 req/s rate gets through.
      expect(s.nodes.gw.drops).toBeCloseTo(s.nodes.gw.rpsIn - 10_000, 6);
      expect(s.nodes.gw.status).toBe("critical");
      expect(s.nodes.gw.limitKind).toBe("account-throttle");
    }
  });

  it("below 10,000 req/s nothing fails, even on ticks whose Poisson arrivals pass the rate", () => {
    const sim = new TickSimulator(gateway(), { seed: 11, tickSamples: 50 });
    const snaps = Array.from({ length: 200 }, () => sim.step(9_800));
    // The noise does cross the rate on some ticks: the bucket absorbs them.
    expect(snaps.some((s) => s.nodes.gw.rpsIn > 10_000)).toBe(true);
    for (const s of snaps) expect(s.nodes.gw.drops).toBe(0);
  });
});

describe("the tick and analyze() report the same limit (TEC-41)", () => {
  it.each([
    ["postgres", techNode("db", "sql-db", "postgres", { instances: 2, shards: 1 }), 0.7, 30_000],
    ["dynamodb", techNode("db", "nosql-db", "dynamodb", { hotPartitionShare: 0.5 }), 0.9, 15_000],
    ["redis (no classes)", techNode("db", "cache", "redis"), 0.9, 50_000],
  ])("%s", (_name, node, readRatio, rps) => {
    const graph = compileV3([comp("client", "client"), node], [wire("client", "db")]);
    const config = { seed: 5, readRatio, samples: 200 };
    const snap = new TickSimulator(graph, { ...config, tickSamples: 50 }).step(rps);
    const tick = snap.nodes.db;
    const steady = analyze(graph, snap.offeredRps, config).nodes.find((n) => n.nodeId === "db")!;
    expect(tick.rpsIn).toBeCloseTo(steady.offeredRps, 9);
    expect(tick.limitKind).toBe(steady.limitKind);
    expect(tick.limitUtilization).toBeCloseTo(steady.limitUtilization!, 12);
    expect(tick.utilization).toBe(tick.limitUtilization);
    expect(tick.writeRps).toBeCloseTo(steady.writeRps!, 9);
  });
});
