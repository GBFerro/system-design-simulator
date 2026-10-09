import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { applyDiff } from "@/advisor/graph";
import {
  mitigationsFor,
  MITIGATION_RETRIES,
  STABLE_UNHEALTHY_THRESHOLD,
} from "@/advisor/mitigation";
import type { AdvisorContext } from "@/advisor/types";
import { edgeRuleOf } from "@/domain/graph/edgeRules";
import { FlowEngine } from "@/engine/engine";
import { edgeTargets, FAULT_CATALOG, nodeTargets } from "@/engine/faults/catalog";
import type { FaultSpec } from "@/engine/faults/types";
import { TICK_SEC } from "@/engine/traffic/types";
import { comp, wire, compileV3 } from "./engineFixtures";

type Graph = { nodes: Node[]; edges: Edge[] };

const ctx: AdvisorContext = { readRatio: 0.9, load: { lb: 1000, a: 500, b: 500, db: 100, q: 50 } };

/**
 * DNS → LB → App A, App B (no retries) → Payments; A → Cache → DB; A, B → DB;
 * A → Queue → Worker.
 * One of everything a fault in the catalog can target.
 */
function design(): Graph {
  return {
    nodes: [
      comp("dns", "dns", { lookupShare: 0.2 }),
      comp("lb", "load-balancer", { instances: 2 }),
      comp("a", "app-server", { instances: 2, maxRetries: 0 }),
      comp("b", "app-server", { instances: 2, maxRetries: 0 }),
      comp("pay", "app-server", { instances: 1 }),
      comp("db", "sql-db", { instances: 1 }),
      comp("cache", "cache"),
      comp("q", "message-queue"),
      comp("wk", "worker-pool"),
    ],
    edges: [
      wire("dns", "lb"),
      wire("lb", "a"),
      wire("lb", "b"),
      wire("a", "pay"),
      wire("a", "cache"),
      wire("cache", "db", { sourceComponent: "cache" }),
      wire("a", "db"),
      wire("b", "db"),
      wire("a", "q"),
      wire("q", "wk"),
    ],
  };
}

/** A fault of every type on its first valid target in `design()`. */
function everyFault(): FaultSpec[] {
  const sim = compileV3(design().nodes, design().edges);
  return FAULT_CATALOG.map((f) => ({
    type: f.type,
    target: f.targets.includes("global")
      ? { kind: "global" }
      : f.targets.includes("edge")
        ? { kind: "edge", id: edgeTargets(f, sim)[0].id }
        : { kind: "node", id: nodeTargets(f, sim)[0].id },
    ...(f.intensity ? { intensity: f.intensity.default } : {}),
  }));
}

const fixOf = (fault: FaultSpec, id: string, g = design()) =>
  mitigationsFor(fault, g, ctx).find((m) => m.id === `${fault.type}:${id}`)?.fix;
const params = (g: Graph, id: string) =>
  (g.nodes.find((n) => n.id === id)!.data as { params: Record<string, unknown> }).params;
const ofType = (g: Graph, componentId: string) =>
  g.nodes.find((n) => (n.data as { componentId?: string }).componentId === componentId);

describe("mitigations (CHS-06)", () => {
  it("every fault type has tips; every fix is pure and leaves a graph that compiles", () => {
    const g = design();
    const before = JSON.stringify(g);
    for (const fault of everyFault()) {
      const tips = mitigationsFor(fault, g, ctx);
      expect(tips.length, fault.type).toBeGreaterThan(0);
      expect(new Set(tips.map((t) => t.id)).size, fault.type).toBe(tips.length);
      for (const t of tips.filter((x) => x.fix)) {
        const diff = t.fix!.preview(g);
        expect(t.fix!.preview(g), t.id).toEqual(diff);
        expect(JSON.stringify(g), t.id).toBe(before);
        const after = applyDiff(g, diff);
        expect(compileV3(after.nodes, after.edges).warnings, t.id).toEqual([]);
      }
    }
  });

  it("a dead node: N+1 instances (a standby for a single one)", () => {
    const kill: FaultSpec = { type: "kill-node", target: { kind: "node", id: "a" } };
    expect(
      params(applyDiff(design(), fixOf(kill, "redundancy")!.preview(design())), "a").instances,
    ).toBe(3);
    const db: FaultSpec = { type: "db-primary-failure", target: { kind: "node", id: "db" } };
    expect(
      params(applyDiff(design(), fixOf(db, "standby")!.preview(design())), "db").instances,
    ).toBe(2);
  });

  it("a zone outage: every single-instance tier gets a second instance", () => {
    const zone: FaultSpec = { type: "zone-failure", target: { kind: "global" }, intensity: 3 };
    const after = applyDiff(design(), fixOf(zone, "spread")!.preview(design()));
    for (const id of ["pay", "db", "q", "wk"]) expect(params(after, id).instances, id).toBe(2);
    // DNS is managed and multi-zone: untouched.
    expect(params(after, "dns").instances).toBe(params(design(), "dns").instances);
  });

  it("a cut link: a circuit breaker that keeps the link — and opens when it's cut", () => {
    const g = design();
    const partition: FaultSpec = { type: "partition", target: { kind: "edge", id: "e-a-pay" } };
    const after = applyDiff(g, fixOf(partition, "breaker")!.preview(g));
    const cb = ofType(after, "circuit-breaker")!;
    // The faulted link now runs breaker → Payments, under its old id.
    expect(after.edges.find((e) => e.id === "e-a-pay")).toMatchObject({
      source: cb.id,
      target: "pay",
    });
    expect(after.edges.some((e) => e.source === "a" && e.target === cb.id)).toBe(true);

    const engine = new FlowEngine({ tickSamples: 50 });
    engine.load(compileV3(after.nodes, after.edges), { seed: 2 });
    engine.setTraffic({ kind: "constant", rps: 1000 });
    engine.step(Math.round(2 / TICK_SEC));
    engine.inject(partition);
    const states: unknown[] = [];
    engine.onTick((s) => states.push(s.nodes[cb.id].extra?.breakerState));
    engine.step(Math.round(1 / TICK_SEC));
    expect(states).toContain("open");
  });

  it("lossy calls and deadlocks: retries with backoff on the callers", () => {
    const loss: FaultSpec = { type: "packet-loss", target: { kind: "edge", id: "e-a-db" } };
    expect(
      params(applyDiff(design(), fixOf(loss, "retries")!.preview(design())), "a").maxRetries,
    ).toBe(MITIGATION_RETRIES);
    const deadlock: FaultSpec = { type: "deadlock", target: { kind: "node", id: "db" } };
    const after = applyDiff(design(), fixOf(deadlock, "retries")!.preview(design()));
    expect(params(after, "a").maxRetries).toBe(MITIGATION_RETRIES);
    expect(params(after, "b").maxRetries).toBe(MITIGATION_RETRIES);
  });

  it("a stopped consumer: a dead-letter queue off its queue", () => {
    const g = design();
    const stopped: FaultSpec = { type: "consumer-stopped", target: { kind: "node", id: "wk" } };
    const after = applyDiff(g, fixOf(stopped, "dlq")!.preview(g));
    const dlq = ofType(after, "dlq")!;
    const edge = after.edges.find((e) => e.source === "q" && e.target === dlq.id)!;
    expect(edgeRuleOf(after, edge).calls.map((c) => c.kind)).toEqual(["fraction"]);
    // With one already there, no fix.
    expect(fixOf(stopped, "dlq", after)).toBeUndefined();
  });

  it("a traffic spike: a rate limit at 2× the load before the spike", () => {
    const spike: FaultSpec = { type: "traffic-spike", target: { kind: "global" }, intensity: 5 };
    const g: Graph = {
      nodes: [comp("c", "client"), comp("app", "app-server", { instances: 4 })],
      edges: [wire("c", "app")],
    };
    const spiking = { ...ctx, load: { c: 5000, app: 5000 } };
    const fix = mitigationsFor(spike, g, spiking).find(
      (m) => m.id === "traffic-spike:rate-limit",
    )!.fix!;
    const after = applyDiff(g, fix.preview(g));
    // 5000 rps with a ×5 spike = 1000 normal → limit 2000.
    expect(params(after, ofType(after, "rate-limiter")!.id).limitRps).toBe(2000);
  });

  it("flapping health checks: hysteresis on the LB; a DNS outage: longer TTLs", () => {
    const flap: FaultSpec = {
      type: "health-check-flapping",
      target: { kind: "edge", id: "e-lb-a" },
    };
    expect(
      params(applyDiff(design(), fixOf(flap, "hysteresis")!.preview(design())), "lb")
        .unhealthyThreshold,
    ).toBe(STABLE_UNHEALTHY_THRESHOLD);
    const dns: FaultSpec = { type: "dns-outage", target: { kind: "node", id: "dns" } };
    expect(
      params(applyDiff(design(), fixOf(dns, "ttl")!.preview(design())), "dns").lookupShare,
    ).toBe(0.1);
  });

  it("no fix when it's already there", () => {
    const g = design();
    const partition: FaultSpec = { type: "partition", target: { kind: "edge", id: "e-a-pay" } };
    const after = applyDiff(g, fixOf(partition, "breaker")!.preview(g));
    const cb = ofType(after, "circuit-breaker")!;
    const again: FaultSpec = { type: "partition", target: { kind: "edge", id: "e-a-pay" } };
    // The link out of the breaker: a breaker in front already.
    expect(fixOf(again, "breaker", after)).toBeUndefined();
    expect(after.edges.find((e) => e.id === "e-a-pay")!.source).toBe(cb.id);
  });
});
