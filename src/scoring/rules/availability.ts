import type { Node, Edge } from "@xyflow/react";
import type { ComponentNodeData } from "@/store/canvasStore";
import type { CategoryScore, Measurements, ScoringGraph } from "@/types/scoring";
import { CATEGORY_MAX_SCORE, SLO_ERROR_RATE } from "../budget";
import { findSpofs, syncPath } from "../paths";
import { NO_TRAFFIC_FEEDBACK, noTraffic, pct } from "../steady";

/**
 * Measured (Spec 09): no single point of failure on the request path, the
 * system keeps its SLO under the problem's drill faults, and it degrades
 * gracefully. Max points per check; sums to CATEGORY_MAX_SCORE (checked in
 * tests/unit/scoring.test.ts).
 */
export const BUDGET = {
  noSpof: 6,
  underFaults: 10,
  gracefulDegradation: 4,
} as const;

/** Partial credit for a check that is only half met (always below its BUDGET). */
export const PARTIAL = {
  gracefulDegradation: 2,
} as const satisfies Partial<Record<keyof typeof BUDGET, number>>;

const DATABASES = new Set(["sql-db", "nosql-db"]);

export function scoreAvailability(
  nodes: Node<ComponentNodeData>[],
  edges: Edge[],
  graph: ScoringGraph,
  m?: Measurements,
): CategoryScore {
  const feedback: string[] = [];
  const passed: string[] = [];
  let score = 0;
  const connected = nodes.filter((n) => graph.reachable.has(n.id));
  const connectedIds = new Set(connected.map((n) => n.data.componentId));

  const path = syncPath(nodes, edges, graph);
  if (connected.length === 0 || path.entries.length === 0 || noTraffic(m)) {
    feedback.push(NO_TRAFFIC_FEEDBACK);
    return { category: "Availability", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
  }

  // No SPOF on the request path (same check as the Advisor).
  const spofs = findSpofs(nodes, path, graph);
  if (spofs.length === 0) {
    score += BUDGET.noSpof;
    passed.push(
      "No single point of failure on the request path: every stateful tier has a standby or a replica.",
    );
  } else {
    feedback.push(
      `Single points of failure on the request path: ${spofs.map((n) => n.data.label).join(", ")}. One instance and no replica means one crash takes every request that needs it down — add instances (a standby to fail over to) or a replica.`,
    );
  }

  // The drill's faults: the interview drill's results, else the same faults in steady state.
  if (m?.drill && m.drill.total > 0) {
    const pts = Math.round((BUDGET.underFaults * m.drill.held) / m.drill.total);
    score += pts;
    (m.drill.held === m.drill.total ? passed : feedback).push(
      `Failure drill: the SLO held in ${m.drill.held} of ${m.drill.total} faults${
        m.drill.held === m.drill.total
          ? "."
          : " — see the drill results for when it broke and recovered."
      }`,
    );
  } else if (m && m.underFaults.length > 0) {
    const held = m.underFaults.filter((f) => f.errorRate <= SLO_ERROR_RATE);
    score += Math.round((BUDGET.underFaults * held.length) / m.underFaults.length);
    if (held.length === m.underFaults.length) {
      passed.push(
        `Keeps errors under ${pct(SLO_ERROR_RATE)} under each of the problem's failure scenarios (${m.underFaults.map((f) => f.label).join("; ")}).`,
      );
    } else {
      feedback.push(
        `Under the problem's failure scenarios it breaks the ${pct(SLO_ERROR_RATE)} error budget in ${m.underFaults.length - held.length} of ${m.underFaults.length}: ${m.underFaults
          .filter((f) => f.errorRate > SLO_ERROR_RATE)
          .map((f) => `${f.label} → ${pct(f.errorRate)} errors`)
          .join(
            "; ",
          )}. Redundancy with headroom (so survivors absorb the load), timeouts, retries and fallbacks keep it up.`,
      );
    }
  } else {
    feedback.push(
      m
        ? "None of the problem's failure scenarios applies to this design yet."
        : "Availability under failures is measured by simulating the problem's failure scenarios; the simulation didn't run.",
    );
  }

  // Graceful degradation: fail fast, or keep serving something.
  if (connectedIds.has("circuit-breaker")) {
    score += BUDGET.gracefulDegradation;
    passed.push(
      "A circuit breaker fails fast around a sick dependency instead of letting callers pile up waiting on it.",
    );
  } else if (
    (connectedIds.has("cache") && [...DATABASES].some((id) => connectedIds.has(id))) ||
    connectedIds.has("message-queue")
  ) {
    score += PARTIAL.gracefulDegradation;
    feedback.push(
      "A cache (stale reads) or a queue (deferred writes) lets part of the system keep working through a failure, but nothing fails fast around a slow dependency: add a circuit breaker on the calls you can degrade.",
    );
  } else {
    feedback.push(
      "Nothing degrades gracefully: when a dependency fails or slows down, every request that needs it fails or waits. Add a circuit breaker with a fallback, a cache in front of the database, or a queue for work that can wait.",
    );
  }

  return { category: "Availability", score, maxScore: CATEGORY_MAX_SCORE, feedback, passed };
}
