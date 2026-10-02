import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { applyAllFixes, applyFix, computeFindings, readRatioFor } from "@/advisor/advisor";
import { applyDiff } from "@/advisor/graph";
import { edgeRuleOf } from "@/domain/graph/edgeRules";
import { structureFindings } from "@/advisor/structure";
import type { AdvisorContext } from "@/advisor/types";
import { suggestedInstances } from "@/cost/rightSize";
import { PROBLEMS } from "@/data/problems";
import { capacityPerInstanceOf, instancesOf } from "@/domain/components/registry";
import { compileGraph } from "@/domain/graph/compile";
import { analyze } from "@/engine/analyze";
import type { GlobalRuntimeMetrics, NodeRuntimeMetrics, TickSnapshot } from "@/engine/types";
import { buildReferenceGraph } from "@/lib/loadReference";
import {
  applyAllFindings,
  applyFinding,
  recentLoad,
  setAdvisorPreview,
  useAdvisorStore,
} from "@/store/advisorStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useSimulationStore } from "@/store/simulationStore";
import type { ScoreResult } from "@/types/scoring";
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

/* ---------- ADV-01/02: findings from the load, patterns, score; quick fixes ---------- */

type Graph = { nodes: Node[]; edges: Edge[] };

const capacityOf = (componentId: string) => capacityPerInstanceOf({ componentId, params: {} });
const find = (g: Graph, ctx: Partial<AdvisorContext>, id: string) =>
  computeFindings(g, { readRatio: 0.5, ...ctx }).find((f) => f.id === id);
const fixed = (g: Graph, ctx: Partial<AdvisorContext>, id: string) =>
  applyFix(g, id, { readRatio: 0.5, ...ctx })!;
const nodeOf = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;
const paramsOf = (g: Graph, id: string) =>
  (nodeOf(g, id).data as { params: Record<string, unknown> }).params;
const instances = (g: Graph, id: string) => instancesOf(nodeOf(g, id).data as never);
const ofType = (g: Graph, componentId: string) =>
  g.nodes.find((n) => (n.data as { componentId?: string }).componentId === componentId)!;
const ruleKind = (g: Graph, source: string, target: string) => {
  const e = g.edges.find((x) => x.source === source && x.target === target);
  return e ? edgeRuleOf(g, e).kind : undefined;
};

/** Client → App → (rest). */
function webApp(...rest: { node: Node; from?: string }[]): Graph {
  return {
    nodes: [node("c", "client"), node("app", "app-server"), ...rest.map((r) => r.node)],
    edges: [wire("c", "app"), ...rest.map((r) => wire(r.from ?? "app", r.node.id))],
  };
}

describe("load findings (ADV-01)", () => {
  const app = capacityOf("app-server");

  it("say nothing without a run", () => {
    const f = computeFindings(webApp(), { readRatio: 0.5 });
    expect(f.filter((x) => x.source === "metrics")).toEqual([]);
  });

  it("a hot stateless tier: warning, scaled out by its fix, gone at once", () => {
    const g = webApp();
    const load = { c: 0.9 * app, app: 0.9 * app };
    expect(find(g, { load }, "hot:app")).toMatchObject({
      severity: "warning",
      source: "metrics",
      targetIds: ["app"],
    });
    const after = fixed(g, { load }, "hot:app");
    expect(instances(after, "app")).toBe(suggestedInstances(0.9 * app, app));
    expect(find(after, { load }, "hot:app")).toBeUndefined();
  });

  it("past full capacity it's critical; a stateful tier gets no instance fix", () => {
    const g = webApp({ node: node("db", "sql-db", { instances: 2 }) });
    const load = { c: 1.5 * app, app: 1.5 * app, db: 1.2 * capacityOf("sql-db") * 2 };
    expect(find(g, { load }, "hot:app")).toMatchObject({ severity: "critical" });
    const db = find(g, { load }, "hot:db")!;
    expect(db.severity).toBe("critical");
    expect(db.fix).toBeUndefined();
  });

  it("DNS is hot only on the lookups its caches miss", () => {
    const g: Graph = {
      nodes: [node("dns", "dns", { lookupShare: 0.01 }), node("app", "app-server")],
      edges: [wire("dns", "app")],
    };
    const cap = capacityPerInstanceOf(nodeOf(g, "dns").data as never);
    expect(find(g, { load: { dns: 50 * cap, app: 1 } }, "hot:dns")).toBeUndefined();
    expect(find(g, { load: { dns: 90 * cap, app: 1 } }, "hot:dns")).toBeDefined();
  });

  it("over-provisioned (the scorer's check): info, scaled in by its fix", () => {
    const g = webApp();
    g.nodes[1] = node("app", "app-server", { instances: 10 });
    const load = { c: 0.5 * app, app: 0.5 * app };
    expect(find(g, { load }, "idle:app")).toMatchObject({ severity: "info" });
    const after = fixed(g, { load }, "idle:app");
    expect(instances(after, "app")).toBe(suggestedInstances(0.5 * app, app));
    expect(find(after, { load }, "idle:app")).toBeUndefined();
  });

  it("no rate limiter: one inserted where traffic leaves the edge tiers, at 2× the load", () => {
    const g: Graph = {
      nodes: [node("c", "client"), node("lb", "load-balancer"), node("app", "app-server")],
      edges: [wire("c", "lb"), wire("lb", "app")],
    };
    const load = { c: 1000, lb: 1000, app: 1000 };
    expect(find(g, { load }, "rate-limit")).toMatchObject({ severity: "info" });
    const after = fixed(g, { load }, "rate-limit");
    const rl = ofType(after, "rate-limiter");
    expect(paramsOf(after, rl.id).limitRps).toBe(2000);
    expect(ruleKind(after, "lb", "app")).toBeUndefined();
    expect(ruleKind(after, "lb", rl.id)).toBe("always");
    expect(ruleKind(after, rl.id, "app")).toBe("always");
    expect(find(after, { load }, "rate-limit")).toBeUndefined();
  });

  it("an API gateway on the path gets its throttling turned on instead", () => {
    const g = webApp({ node: node("gw", "api-gateway") });
    const after = fixed(g, { load: { c: 500, app: 500, gw: 400 } }, "rate-limit");
    expect(after.nodes).toHaveLength(3);
    expect(paramsOf(after, "gw")).toMatchObject({ rateLimitEnabled: true, limitRps: 800 });
  });
});

describe("pattern findings (ADV-01)", () => {
  it("reads straight to the database: a look-aside cache takes them, misses go on", () => {
    const g = webApp({ node: node("db", "sql-db", { instances: 2 }) });
    expect(find(g, { readRatio: 0.5 }, "read-cache:db")).toBeUndefined();
    expect(find(g, { readRatio: 0.9 }, "read-cache:db")).toMatchObject({
      severity: "warning",
      targetIds: ["db", "app"],
    });

    const after = fixed(g, { readRatio: 0.9 }, "read-cache:db");
    const cache = ofType(after, "cache");
    expect(ruleKind(after, "app", cache.id)).toBe("reads");
    expect(ruleKind(after, cache.id, "db")).toBe("on_miss");
    expect(ruleKind(after, "app", "db")).toBe("writes");
    expect(find(after, { readRatio: 0.9 }, "read-cache:db")).toBeUndefined();

    // The database now sees the writes and the cache's misses only.
    const dbLoad = (x: Graph) =>
      analyze(compileGraph(x.nodes, x.edges), 1000, { readRatio: 0.9 }).nodes.find(
        (n) => n.nodeId === "db",
      )!.offeredRps;
    expect(dbLoad(after)).toBeLessThan(dbLoad(g) * 0.5);
  });

  it("a cache the caller already reads (look-aside) counts", () => {
    const g = webApp(
      { node: node("db", "sql-db", { instances: 2 }) },
      { node: node("k", "cache") },
    );
    expect(find(g, { readRatio: 0.9 }, "read-cache:db")).toBeUndefined();
  });

  it("slow work on the request path goes behind a queue", () => {
    const g = webApp({ node: node("n", "notification-service", { instances: 4 }) });
    expect(find(g, {}, "async:e-app-n")).toMatchObject({
      severity: "warning",
      targetIds: ["app", "n"],
    });
    const after = fixed(g, {}, "async:e-app-n");
    const q = ofType(after, "message-queue");
    expect(ruleKind(after, "app", "n")).toBeUndefined();
    expect(ruleKind(after, "app", q.id)).toBe("always");
    expect(ruleKind(after, q.id, "n")).toBe("always");
    expect(find(after, {}, "async:e-app-n")).toBeUndefined();

    const p99 = (x: Graph) => analyze(compileGraph(x.nodes, x.edges), 100).latency.p99Ms;
    expect(p99(after)).toBeLessThan(p99(g));
  });
});

describe("score findings (ADV-01)", () => {
  it("each lost point's feedback is an info finding with the report's text", () => {
    const score: ScoreResult = {
      total: 30,
      verdict: "Decent",
      verdictColor: "",
      summary: "",
      categories: [
        { category: "Latency", score: 10, maxScore: 20, feedback: ["p99 too high."], passed: [] },
        { category: "Cost Efficiency", score: 20, maxScore: 20, feedback: [], passed: ["ok"] },
      ],
    };
    expect(computeFindings(webApp(), { readRatio: 0.5, score })).toEqual([
      expect.objectContaining({
        id: "score:Latency:0",
        severity: "info",
        source: "scoring",
        title: "Latency (10/20)",
        detail: "p99 too high.",
      }),
    ]);
  });
});

/** A design with one of everything a fix exists for. */
function messy(): { graph: Graph; ctx: AdvisorContext } {
  const graph = webApp(
    { node: node("db", "sql-db") },
    { node: node("n", "notification-service", { instances: 4 }) },
  );
  const app = capacityOf("app-server");
  return {
    graph,
    ctx: { readRatio: 0.9, load: { c: 0.95 * app, app: 0.95 * app, db: 100, n: 10 } },
  };
}

describe("quick fixes (ADV-02)", () => {
  it("preview is pure, and every fixed graph compiles cleanly", () => {
    const { graph, ctx } = messy();
    const before = JSON.stringify(graph);
    const fixes = computeFindings(graph, ctx).filter((f) => f.fix);
    expect(fixes.map((f) => f.id).sort()).toEqual(
      ["async:e-app-n", "hot:app", "idle:n", "rate-limit", "read-cache:db", "spof:db"].sort(),
    );
    for (const f of fixes) {
      const diff = f.fix!.preview(graph);
      expect(f.fix!.preview(graph), f.id).toEqual(diff);
      expect(JSON.stringify(graph), f.id).toBe(before);
      const after = applyDiff(graph, diff);
      expect(compileGraph(after.nodes, after.edges).warnings, f.id).toEqual([]);
      expect(new Set(after.nodes.map((n) => n.id)).size, f.id).toBe(after.nodes.length);
    }
  });

  it("apply all: every fix in sequence, each finding gone, nothing left to fix", () => {
    const { graph, ctx } = messy();
    const after = applyAllFixes(graph, ctx)!;
    expect(compileGraph(after.nodes, after.edges).warnings).toEqual([]);
    expect(computeFindings(after, ctx).filter((f) => f.fix)).toEqual([]);
    expect(applyAllFixes(after, ctx)).toBeNull();
  });

  it("reference solutions: nothing above info at their peak, and their fixes compile", () => {
    for (const p of PROBLEMS) {
      const { nodes, edges } = buildReferenceGraph(p);
      const peak = p.requirements.readsPerSec + p.requirements.writesPerSec;
      const steady = analyze(compileGraph(nodes, edges), peak, {
        readRatio: p.requirements.readsPerSec / peak,
        samples: 200,
      });
      const ctx: AdvisorContext = {
        readRatio: readRatioFor(nodes, p),
        load: Object.fromEntries(steady.nodes.map((n) => [n.nodeId, n.offeredRps])),
      };
      const graph = { nodes, edges };
      const loud = computeFindings(graph, ctx).filter((f) => f.severity !== "info");
      expect(
        loud.map((f) => f.id),
        p.id,
      ).toEqual([]);
      const after = applyAllFixes(graph, ctx);
      if (after) expect(compileGraph(after.nodes, after.edges).warnings, p.id).toEqual([]);
    }
  });
});

describe("advisor store", () => {
  function setCanvas({ nodes, edges }: Graph, readOnly = false) {
    useCanvasStore.setState({
      nodes,
      edges,
      history: [],
      future: [],
      tabs: [{ id: "t", label: "T", nodes: [], edges: [], readOnly }],
      activeTabId: "t",
    });
  }
  const findingIds = () => useAdvisorStore.getState().findings.map((f) => f.id);

  it("applying a fix is one undo step and clears its finding", () => {
    setCanvas(webApp({ node: node("db", "sql-db") }));
    expect(findingIds()).toContain("spof:db");
    setAdvisorPreview("spof:db");
    expect(useAdvisorStore.getState().preview?.changes).toEqual({ db: "×1 → ×2" });

    applyFinding("spof:db");
    expect(useAdvisorStore.getState().preview).toBeNull();
    expect(useCanvasStore.getState().history).toHaveLength(1);
    expect(findingIds()).not.toContain("spof:db");
    useCanvasStore.getState().undo();
    expect(findingIds()).toContain("spof:db");
  });

  it("apply all is one undo step too; both are no-ops on a read-only tab", () => {
    const g = webApp({ node: node("db", "sql-db") }, { node: node("n", "notification-service") });
    setCanvas(g, true);
    applyAllFindings();
    applyFinding("spof:db");
    expect(useCanvasStore.getState().nodes).toBe(g.nodes);
    expect(useCanvasStore.getState().history).toHaveLength(0);

    setCanvas(g);
    applyAllFindings();
    expect(useCanvasStore.getState().history).toHaveLength(1);
    expect(useAdvisorStore.getState().findings.filter((f) => f.fix)).toEqual([]);
  });

  it("the last score shows while the design is the one scored, refreshed by each score", () => {
    setCanvas(webApp());
    const scored = (feedback: string): ScoreResult => ({
      total: 10,
      verdict: "",
      verdictColor: "",
      summary: "",
      categories: [
        { category: "Latency", score: 10, maxScore: 20, feedback: [feedback], passed: [] },
      ],
    });
    const details = () =>
      useAdvisorStore
        .getState()
        .findings.filter((f) => f.source === "scoring")
        .map((f) => f.detail);
    useSimulationStore.getState().setScoreResult(scored("first"));
    expect(details()).toEqual(["first"]);
    useSimulationStore.getState().setScoreResult(scored("second"));
    expect(details()).toEqual(["second"]);
    useCanvasStore.getState().changeReplicas("app", 1);
    expect(details()).toEqual([]);
    useSimulationStore.getState().reset();
  });

  it("the preview ends when its finding goes away or the tab changes", () => {
    setCanvas(webApp({ node: node("db", "sql-db") }));
    setAdvisorPreview("spof:db");
    useCanvasStore.getState().changeReplicas("db", 1);
    expect(useAdvisorStore.getState().preview).toBeNull();
    useCanvasStore.getState().undo();
    setAdvisorPreview("spof:db");
    expect(useAdvisorStore.getState().preview).not.toBeNull();
    useCanvasStore.setState({ activeTabId: "other" });
    expect(useAdvisorStore.getState().preview).toBeNull();
  });
});

describe("recentLoad", () => {
  const snap = (t: number, rps: number): TickSnapshot => ({
    t,
    offeredRps: rps,
    nodes: { a: { rpsIn: rps } as NodeRuntimeMetrics },
    edges: {},
    global: {} as GlobalRuntimeMetrics,
  });

  it("averages the live run's last seconds; an Analyze snapshot stands alone", () => {
    expect(recentLoad([], null)).toBeUndefined();
    const run = [snap(0, 999), snap(1, 100), snap(4, 200), snap(7, 300)];
    expect(recentLoad(run, run[3])).toEqual({ a: 250 }); // t ∈ [2, 7]
    const simulated = snap(0, 50);
    expect(recentLoad([...run, simulated], simulated)).toEqual({ a: 50 });
    // A new run after a reset doesn't average with the old one.
    const again = [...run, snap(0.5, 10), snap(1, 20)];
    expect(recentLoad(again, again[5])).toEqual({ a: 15 });
  });
});
