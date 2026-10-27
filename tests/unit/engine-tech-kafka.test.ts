import { describe, expect, it } from "vitest";
import { techPreset } from "@/domain/components/technologies";
import type { Params } from "@/domain/components/types";
import { analyze } from "@/engine/analyze";
import { TickSimulator } from "@/engine/core/tick";
import { comp, compileV3, wire } from "./engineFixtures";

/** Kafka consumers capped by partitions (component-technologies T29, TEC-34). */

const WORKER_CAP = 100; // per instance, req/s

/** client → queue → worker, the queue as Kafka (or `generic` with the same params). */
function design(technology: "kafka" | "generic", workers: number) {
  const queueParams: Params = {
    ...(technology === "kafka" ? techPreset("message-queue", "kafka") : { technology }),
    consumers: 12,
    partitions: 6,
  };
  return compileV3(
    [
      comp("client", "client"),
      comp("q", "message-queue", queueParams),
      comp("worker", "worker-pool", { instances: workers, capacityPerInstance: WORKER_CAP }),
    ],
    [wire("client", "q"), wire("q", "worker")],
  );
}

function drainedInAnalyze(technology: "kafka" | "generic", workers: number) {
  const steady = analyze(design(technology, workers), 2_000, { seed: 1, samples: 200 });
  return {
    edge: steady.edges.find((e) => e.edgeId === "e-q-worker")!.rps,
    queue: steady.nodes.find((n) => n.nodeId === "q")!,
  };
}

function lastTick(technology: "kafka" | "generic", workers: number) {
  const sim = new TickSimulator(design(technology, workers), { seed: 1, tickSamples: 50 });
  let snap = sim.step(2_000);
  for (let i = 1; i < 20; i++) snap = sim.step(2_000);
  return snap;
}

describe("Kafka: at most one consumer per partition (TEC-34)", () => {
  it("12 consumers, 6 partitions and 12 workers drain like 6 in analyze()", () => {
    const kafka = drainedInAnalyze("kafka", 12);
    expect(kafka.edge).toBeCloseTo(6 * WORKER_CAP, 9);
    expect(kafka.queue.limitKind).toBe("consumers-partitions");
    expect(kafka.queue.limitUtilization).toBeCloseTo(2_000 / (6 * WORKER_CAP), 9);
    expect(kafka.queue.utilization).toBe(kafka.queue.limitUtilization);
  });

  it("and in the tick", () => {
    const snap = lastTick("kafka", 12);
    // (the lag is long past one tick of pulling: the edge carries the full pull)
    expect(snap.edges["e-q-worker"].rps).toBeCloseTo(6 * WORKER_CAP, 9);
    expect(snap.nodes.q.limitKind).toBe("consumers-partitions");
    expect(snap.nodes.q.limitUtilization).toBeCloseTo(snap.nodes.q.rpsOut / (6 * WORKER_CAP), 9);
  });

  it("the same params on a generic queue drain like 12", () => {
    expect(drainedInAnalyze("generic", 12).edge).toBeCloseTo(12 * WORKER_CAP, 9);
    expect(lastTick("generic", 12).edges["e-q-worker"].rps).toBeCloseTo(12 * WORKER_CAP, 9);
    expect(Object.keys(drainedInAnalyze("generic", 12).queue)).not.toContain("limitKind");
  });

  it("fewer workers than partitions: the consumers limit, not the partitions", () => {
    const kafka = drainedInAnalyze("kafka", 4);
    expect(kafka.edge).toBeCloseTo(4 * WORKER_CAP, 9);
    expect(kafka.queue.limitKind).toBe("consumers");
  });
});
