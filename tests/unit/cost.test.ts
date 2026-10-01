import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getComponentById } from "@/data/components";
import { formatMoney, formatPrice } from "@/cost/currency";
import { costLine, costPerMillionRequests, estimateCost } from "@/cost/estimate";
import {
  MIN_INSTANCES_PER_TIER,
  rightSize,
  rightSizeDelta,
  suggestedInstances,
  TARGET_UTILIZATION,
} from "@/cost/rightSize";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import { createComponentNode } from "@/lib/nodeFactory";
import { buildScoringGraph } from "@/scoring/scorer";
import { BUDGET, budgetPoints, scoreCost } from "@/scoring/rules/cost";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { Measurements } from "@/types/scoring";

function node(
  componentId: string,
  id: string,
  params: Record<string, number> = {},
): Node<ComponentNodeData> {
  const created = createComponentNode(getComponentById(componentId)!, { x: 0, y: 0 });
  return {
    ...created,
    id,
    data: { ...created.data, params: { ...created.data.params, ...params } },
  };
}

const rpsOf = (map: Record<string, number>) => (id: string) => map[id] ?? 0;

describe("cost estimate (CST-01/02)", () => {
  it("prices a fixed graph as computed by hand", () => {
    const nodes = [
      node("app-server", "app", { instances: 3 }),
      node("load-balancer", "lb", { instances: 2 }),
      node("dns", "dns", { lookupShare: 0.01 }),
      node("waf", "waf"),
    ];
    const est = estimateCost(nodes, rpsOf({ app: 1000, lb: 1000, dns: 1000, waf: 1000 }));
    // App Server: 3 × $0.096/h × 730 h, nothing per request
    const app = est.lines.find((l) => l.nodeId === "app")!;
    expect(app.monthly).toBeCloseTo(3 * 0.096 * 730, 6);
    // ALB: 2 × $0.0225/h × 730 h + 1000 rps × 2.592 M/month × $0.03/M
    const lb = est.lines.find((l) => l.nodeId === "lb")!;
    expect(lb.monthly).toBeCloseTo(2 * 0.0225 * 730 + 1000 * 2.592 * 0.03, 6);
    // Route 53: $0.50 zone + only the 1% uncached lookups at $0.40/M
    const dns = est.lines.find((l) => l.nodeId === "dns")!;
    expect(dns.billedRps).toBeCloseTo(10, 9);
    expect(dns.monthly).toBeCloseTo(0.5 + 10 * 2.592 * 0.4, 6);
    // WAF: $5 ACL + 10 rules × $1 + $0.60/M
    const waf = est.lines.find((l) => l.nodeId === "waf")!;
    expect(waf.monthly).toBeCloseTo(15 + 1000 * 2.592 * 0.6, 6);

    expect(est.monthly).toBeCloseTo(app.monthly + lb.monthly + dns.monthly + waf.monthly, 6);
    const amounts = est.lines.map((l) => l.monthly);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const areas = Object.values(est.byArea).reduce((a, b) => a + b, 0);
    expect(areas).toBeCloseTo(est.monthly, 6);
    expect(est.byArea.compute).toBeCloseTo(app.monthly, 6);
    expect(est.byArea.network).toBeCloseTo(lb.monthly + dns.monthly + waf.monthly, 6);
  });

  it("skips text nodes, prices unloaded nodes at their fixed cost, ignores bad loads", () => {
    const text = { id: "t", type: "text", position: { x: 0, y: 0 }, data: { text: "note" } };
    const est = estimateCost(
      [text, node("cache", "c", { instances: 2 })],
      rpsOf({ c: Number.NaN }),
    );
    expect(est.lines).toHaveLength(1);
    expect(est.monthly).toBeCloseTo(2 * 0.21 * 730, 6);
    expect(costLine(node("cdn", "cdn"), -5).monthly).toBe(0);
  });

  it("$ per million requests divides by the entry load, null without traffic", () => {
    expect(costPerMillionRequests(2592, 1000)).toBeCloseTo(1, 9);
    expect(costPerMillionRequests(100, 0)).toBeNull();
  });

  it("formats money and unit prices", () => {
    expect(formatMoney(275_867)).toBe("$275,867");
    expect(formatMoney(275_867, "USD", true)).toBe("$275.9K");
    expect(formatMoney(12.345)).toBe("$12.35");
    expect(formatMoney(0.004)).toBe("$0.0040");
    expect(formatPrice(0.096)).toBe("$0.096");
    expect(formatPrice(0.4)).toBe("$0.40");
    expect(formatMoney(100, "BRL")).toMatch(/^R\$/);
  });
});

describe("right-size (CST-03)", () => {
  it("never suggests fewer than 2 instances and targets the utilization", () => {
    for (const cap of [100, 5000, 50_000]) {
      for (const rps of [1, 50, 999, 12_345, 400_000]) {
        const n = suggestedInstances(rps, cap);
        expect(n).toBeGreaterThanOrEqual(MIN_INSTANCES_PER_TIER);
        if (n < 1000) expect(rps / (n * cap)).toBeLessThanOrEqual(TARGET_UTILIZATION + 1e-9);
        // The smallest such count: one fewer would run hotter than the target.
        if (n > MIN_INSTANCES_PER_TIER && n < 1000)
          expect(rps / ((n - 1) * cap)).toBeGreaterThan(TARGET_UTILIZATION);
      }
    }
    expect(suggestedInstances(1e9, 1)).toBe(1000);
  });

  it("a 2× surge on a right-sized tier stays under saturation", () => {
    expect(2 * TARGET_UTILIZATION).toBeLessThan(1);
  });

  it("applies to stateless tiers, only suggests for stateful ones, skips unloaded or per-request ones", () => {
    const nodes = [
      node("app-server", "app", { instances: 10 }), // 5000 rps/instance
      node("sql-db", "db", { instances: 1 }),
      node("cdn", "cdn"),
      node("auth-service", "auth", { instances: 4 }),
    ];
    const s = rightSize(nodes, rpsOf({ app: 4500, db: 9000, cdn: 1e5 }));
    const app = s.find((x) => x.nodeId === "app")!;
    expect(app).toMatchObject({ from: 10, to: 2, applicable: true });
    expect(app.utilizationAfter).toBeLessThanOrEqual(TARGET_UTILIZATION);
    expect(app.monthlyAfter).toBeLessThan(app.monthlyBefore);
    const db = s.find((x) => x.nodeId === "db")!;
    expect(db.applicable).toBe(false);
    expect(db.to).toBeGreaterThan(1);
    expect(s.some((x) => x.nodeId === "cdn" || x.nodeId === "auth")).toBe(false);
    // Only applicable suggestions count toward the delta.
    expect(rightSizeDelta(s)).toBeCloseTo(app.monthlyAfter - app.monthlyBefore, 6);
  });
});

describe("cost rule (CST-05)", () => {
  it("budget points: full within budget, linear to 0 at twice it, any overspend costs a point", () => {
    expect(budgetPoints(0.5)).toBe(BUDGET.withinBudget);
    expect(budgetPoints(1)).toBe(BUDGET.withinBudget);
    expect(budgetPoints(1.001)).toBe(BUDGET.withinBudget - 1);
    expect(budgetPoints(1.5)).toBe(BUDGET.withinBudget / 2);
    expect(budgetPoints(2)).toBe(0);
    expect(budgetPoints(5)).toBe(0);
    expect(budgetPoints(Number.POSITIVE_INFINITY)).toBe(0);
  });

  const nodes = [
    node("load-balancer", "lb", { instances: 2 }),
    node("app-server", "app", { instances: 2 }),
    node("nosql-db", "db", { instances: 2 }),
  ];
  const edges: Edge[] = [
    { id: "e1", source: "lb", target: "app" },
    { id: "e2", source: "app", target: "db" },
  ];
  const graph = buildScoringGraph(nodes, edges);
  const measure = (budgetMonthlyUsd?: number, rps = 3000): Measurements => {
    const g = compileGraph(nodes, edges);
    return {
      peakRps: rps,
      sla: { p99Ms: 1000 },
      atPeak: analyze(g, rps, { samples: 200 }),
      atDoublePeak: analyze(g, 2 * rps, { samples: 200 }),
      underFaults: [],
      ...(budgetMonthlyUsd !== undefined ? { budgetMonthlyUsd } : {}),
    };
  };
  const monthly = (m: Measurements) => {
    const offered = new Map(m.atPeak.nodes.map((n) => [n.nodeId, n.offeredRps]));
    return estimateCost(nodes, (id) => offered.get(id) ?? 0).monthly;
  };

  it("within budget scores 20, over it loses budget points with the biggest lines named", () => {
    const m = measure();
    const cost = monthly(m);
    const ok = scoreCost(nodes, edges, graph, { ...m, budgetMonthlyUsd: cost * 1.2 });
    expect(ok.score).toBe(20);
    expect(ok.feedback).toEqual([]);

    const over = scoreCost(nodes, edges, graph, { ...m, budgetMonthlyUsd: cost / 1.5 });
    expect(over.score).toBe(20 - BUDGET.withinBudget / 2);
    expect(over.feedback.join(" ")).toMatch(/over the .* budget.*NoSQL/);

    const way = scoreCost(nodes, edges, graph, { ...m, budgetMonthlyUsd: cost / 3 });
    expect(way.score).toBe(20 - BUDGET.withinBudget);
  });

  it("without a budget or a measurement, the budget points aren't awarded and it says why", () => {
    const noBudget = scoreCost(nodes, edges, graph, measure());
    expect(noBudget.score).toBe(20 - BUDGET.withinBudget);
    expect(noBudget.feedback.join(" ")).toMatch(/no monthly budget/);
    const unmeasured = scoreCost(nodes, edges, graph);
    expect(unmeasured.score).toBe(0);
    expect(unmeasured.feedback.join(" ")).toMatch(/simulat/);
  });

  it("a design no request reaches scores 0", () => {
    const lone = [node("app-server", "solo", { instances: 3 })];
    const g = compileGraph(lone, []);
    const m: Measurements = {
      peakRps: 1000,
      sla: { p99Ms: 1000 },
      atPeak: analyze(g, 1000, { samples: 50 }),
      atDoublePeak: analyze(g, 2000, { samples: 50 }),
      underFaults: [],
      budgetMonthlyUsd: 1e9,
    };
    const r = scoreCost(lone, [], buildScoringGraph(lone, []), m);
    expect(r.score).toBe(0);
    expect(r.feedback.join(" ")).toMatch(/entry point/);
  });
});
