import { describe, expect, it } from "vitest";
import { parseEnvelope } from "@/domain/persistence/envelope";
import { analyze } from "@/engine/analyze";
import { FlowEngine } from "@/engine/engine";
import { TICK_SEC } from "@/engine/traffic/types";
import type { TickSnapshot } from "@/engine/types";
import { sloSummary } from "@/interview/report";
import { evaluateSlo } from "@/slo/budget";
import {
  budgetFraction,
  downtimePerMonth,
  faultErrorAllowance,
  formatAvailability,
  overridesFor,
  problemSlo,
  resolveSlo,
  sanitizeSloOverrides,
} from "@/slo/slo";
import { DEFAULT_AVAILABILITY, DEFAULT_WINDOW_SEC, type Slo } from "@/slo/types";
import type { ProblemRequirements } from "@/types/problem";
import { comp, wire, compileV3 } from "./engineFixtures";

const REQ: ProblemRequirements = {
  readsPerSec: 900,
  writesPerSec: 100,
  storageGB: 1,
  latencyMs: 100,
  users: "1M",
};

const SLO: Slo = {
  latency: { percentile: 99, thresholdMs: 100 },
  availability: 0.999,
  windowSec: 300,
};

/** A run at 1000 rps sampled every `step` s; `at(t)` gives the error rate and slow share. */
function run(
  seconds: number,
  at: (t: number) => { errorRate?: number; slow?: number },
  step = 0.5,
): TickSnapshot[] {
  const out: TickSnapshot[] = [];
  for (let t = step; t <= seconds + 1e-9; t += step) {
    const { errorRate = 0, slow = 0 } = at(t);
    const throughput = 1000 * (1 - errorRate);
    out.push({
      t,
      offeredRps: 1000,
      nodes: {},
      edges: {},
      global: {
        throughput,
        goodput: throughput * (1 - slow),
        errorRate,
        p50: 10,
        p95: 20,
        p99: 30,
        availability: 1,
      },
    });
  }
  return out;
}

describe("SLO declaration (SLO-01)", () => {
  it("takes the problem's latency target, percentile, scope and availability", () => {
    expect(problemSlo(REQ)).toEqual({
      latency: { percentile: 99, thresholdMs: 100 },
      availability: DEFAULT_AVAILABILITY,
      windowSec: DEFAULT_WINDOW_SEC,
    });
    expect(
      problemSlo({ ...REQ, latencyPercentile: 95, slaScope: "cache", availability: 0.9999 }),
    ).toEqual({
      latency: { percentile: 95, thresholdMs: 100, scope: "cache" },
      availability: 0.9999,
      windowSec: DEFAULT_WINDOW_SEC,
    });
  });

  it("sanitizes overrides field by field and applies them over the problem's", () => {
    expect(sanitizeSloOverrides(null)).toBeUndefined();
    expect(
      sanitizeSloOverrides({ availability: 1, percentile: 90, thresholdMs: -1 }),
    ).toBeUndefined();
    expect(
      sanitizeSloOverrides({ availability: 0.9999, percentile: 95, windowSec: 120, junk: 1 }),
    ).toEqual({ availability: 0.9999, percentile: 95, windowSec: 120 });

    const base = problemSlo({ ...REQ, slaScope: "cache" });
    const slo = resolveSlo(base, { thresholdMs: 50, availability: 0.99 });
    expect(slo.latency).toEqual({ percentile: 99, thresholdMs: 50, scope: "cache" });
    expect(slo.availability).toBe(0.99);
    expect(overridesFor(base, slo)).toEqual({ thresholdMs: 50, availability: 0.99 });
    expect(overridesFor(base, base)).toBeUndefined();
  });

  it("keeps an override through the design envelope and drops invalid fields", () => {
    const parsed = parseEnvelope({
      schemaVersion: 2,
      name: "x",
      problemId: "url-shortener",
      nodes: [],
      edges: [],
      strokes: [],
      slo: { availability: 0.9999, thresholdMs: "fast" },
    });
    expect(parsed.ok && parsed.design.slo).toEqual({ availability: 0.9999 });
  });

  it("formats availability without rounding a nine away", () => {
    expect(formatAvailability(0.999)).toBe("99.9%");
    expect(formatAvailability(0.9995)).toBe("99.95%");
    expect(formatAvailability(0.99999)).toBe("99.999%");
    expect(downtimePerMonth(0.999)).toBe("43 min/month");
    expect(downtimePerMonth(0.99999)).toBe("26 s/month");
  });
});

describe("error budget and burn rate (SLO-02)", () => {
  it("1% errors against 99.9% burns at 10×", () => {
    const ev = evaluateSlo(
      run(60, () => ({ errorRate: 0.01 })),
      SLO,
    );
    expect(ev.burn.availability).toBeCloseTo(10, 6);
    expect(ev.burnRate).toBeCloseTo(10, 6);
    expect(ev.binding).toBe("availability");
  });

  it("5% of successes over the threshold against a p99 target burns at 5×", () => {
    const ev = evaluateSlo(
      run(60, () => ({ slow: 0.05 })),
      SLO,
    );
    expect(ev.burn.latency).toBeCloseTo(5, 6);
    expect(ev.burn.availability).toBe(0);
    expect(ev.binding).toBe("latency");
  });

  it("is met below the SLO over the whole window", () => {
    const ev = evaluateSlo(
      run(300, () => ({ errorRate: 0.0005 })),
      SLO,
    );
    expect(ev.verdict).toBe("met");
    expect(ev.consumed.availability).toBeCloseTo(0.5, 6);
    expect(ev.breach).toBeUndefined();
  });

  it("is violated above it, at the moment the budget runs out", () => {
    // 0.2% errors = 2× burn: a 300 s budget is gone after 150 s.
    const ev = evaluateSlo(
      run(300, () => ({ errorRate: 0.002 })),
      SLO,
    );
    expect(ev.verdict).toBe("violated");
    expect(ev.breach?.sli).toBe("availability");
    expect(Math.abs(ev.breach!.t - 150)).toBeLessThanOrEqual(0.5);
  });

  it("stops burning after the fault heals, and recovers as it leaves the window", () => {
    // 10% errors between 60 s and 64 s: 4 s × 1000 rps × 10% = 400 bad requests
    // against a 0.1% × (300 s × 1000 rps) = 300-request budget → 4/3 of it.
    const faulty = (t: number) => ({ errorRate: t > 60 && t <= 64 ? 0.1 : 0 });
    const healed = evaluateSlo(run(120, faulty), SLO);
    const later = evaluateSlo(run(200, faulty), SLO);
    expect(healed.consumed.availability).toBeCloseTo(4 / 3, 6);
    expect(healed.verdict).toBe("violated");
    expect(later.consumed.availability).toBeCloseTo(healed.consumed.availability, 6);
    expect(healed.burnRate).toBe(0); // the fault is older than the 30 s burn window
    // 400 bad over the 30 s window's 30 000 requests: 1.33% → 13.3×
    expect(healed.worstBurn).toBeCloseTo(40 / 3, 6);
    const rolled = evaluateSlo(run(400, faulty), SLO);
    expect(rolled.consumed.availability).toBe(0);
    expect(rolled.verdict).toBe("violated"); // the run did break it
  });

  it("charges a short run against the whole window", () => {
    // 30 s at 10× = a tenth of the budget.
    const ev = evaluateSlo(
      run(30, () => ({ errorRate: 0.01 })),
      SLO,
    );
    expect(ev.consumed.availability).toBeCloseTo(1, 6);
    const short = evaluateSlo(
      run(15, () => ({ errorRate: 0.01 })),
      SLO,
    );
    expect(short.consumed.availability).toBeCloseTo(0.5, 6);
  });

  it("has no data for an empty history or a single analyze snapshot", () => {
    expect(evaluateSlo([], SLO).hasData).toBe(false);
    const one = run(0.5, () => ({}))[0];
    expect(evaluateSlo([{ ...one, t: 0 }], SLO).hasData).toBe(false);
  });

  it("summarizes the run for the interview report", () => {
    const ev = evaluateSlo(
      run(300, () => ({ errorRate: 0.002 })),
      SLO,
    );
    const summary = sloSummary(ev, SLO)!;
    expect(summary.verdict).toBe("violated");
    expect(summary.breachSli).toBe("availability");
    expect(summary.target).toBe("p99 ≤ 100 ms · 99.9% availability · 5-minute window");
    expect(sloSummary(evaluateSlo([], SLO), SLO)).toBeUndefined();
  });
});

describe("faults against the window budget (SLO-03)", () => {
  it("a fault may spend the window's budget over its own duration", () => {
    expect(budgetFraction(SLO, "availability")).toBeCloseTo(0.001, 12);
    expect(budgetFraction(SLO, "latency")).toBeCloseTo(0.01, 12);
    expect(faultErrorAllowance(SLO, 60)).toBeCloseTo(0.005, 12);
    expect(faultErrorAllowance(SLO, 30)).toBeCloseTo(0.01, 12);
    expect(faultErrorAllowance(SLO, 600)).toBeCloseTo(0.001, 12);
    expect(faultErrorAllowance(SLO, 0)).toBeCloseTo(0.001, 12);
  });
});

describe("goodput in the engine", () => {
  const nodes = [
    comp("lb", "load-balancer"),
    comp("app", "app-server", { instances: 4 }),
    comp("db", "sql-db", { instances: 2 }),
  ];
  const graph = compileV3(nodes, [wire("lb", "app"), wire("app", "db")]);

  it("analyze(): every success is good without an SLO, none under an impossible one", () => {
    const loose = analyze(graph, 500, { samples: 500 });
    expect(loose.goodputRps).toBe(loose.throughputRps);
    const tight = analyze(graph, 500, { samples: 500, latencySlo: { thresholdMs: 0.001 } });
    expect(tight.goodputRps).toBe(0);
    const p50 = analyze(graph, 500, {
      samples: 2000,
      latencySlo: { thresholdMs: loose.latency.p50Ms },
    });
    expect(p50.goodputRps / p50.throughputRps).toBeCloseTo(0.5, 1);
    // The threshold never changes anything else.
    expect({ ...tight, goodputRps: 0 }).toEqual({ ...loose, goodputRps: 0 });
  });

  it("tick: goodput follows the SLO live and leaves the rest bit-identical", () => {
    const run = (slo: { thresholdMs: number } | null) => {
      const engine = new FlowEngine({ tickSamples: 200 });
      engine.load(graph, { seed: 3 });
      engine.setTraffic({ kind: "constant", rps: 500 });
      engine.setLatencySlo(slo);
      return engine.step(Math.round(2 / TICK_SEC))!;
    };
    const none = run(null);
    const tight = run({ thresholdMs: 0.001 });
    expect(none.global.goodput).toBe(none.global.throughput);
    expect(tight.global.goodput).toBe(0);
    expect({ ...tight.global, goodput: 0 }).toEqual({ ...none.global, goodput: 0 });
    expect(tight.nodes).toEqual(none.nodes);
  });

  it("a scoped SLO measures that component's hop, not the whole request", () => {
    const e2e = analyze(graph, 500, { samples: 500, latencySlo: { thresholdMs: 5 } });
    const scoped = analyze(graph, 500, {
      samples: 500,
      latencySlo: { thresholdMs: 1000, scope: "sql-db" },
    });
    expect(scoped.goodputRps).toBeCloseTo(scoped.throughputRps, 6);
    expect(e2e.goodputRps).toBeLessThan(e2e.throughputRps);
  });
});
