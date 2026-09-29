import { describe, expect, it } from "vitest";
import {
  erlangB,
  erlangC,
  parallelAvailability,
  probWaitExceeds,
  retryAmplification,
  seriesAvailability,
  station,
  waitPercentileMs,
} from "@/engine/core/queueing";
import { mulberry32 } from "@/engine/core/rng";

/** Textbook Erlang C straight from the definition (fine for small c). */
function erlangCDirect(c: number, a: number): number {
  let factorial = 1;
  let sum = 0;
  for (let k = 0; k < c; k++) {
    if (k > 0) factorial *= k;
    sum += a ** k / factorial;
  }
  factorial *= c;
  const top = (a ** c / factorial) * (1 / (1 - a / c));
  return top / (sum + top);
}

describe("Erlang C", () => {
  // Exact values, computed with rational arithmetic (Python `fractions`) from
  // C(c,a) = (aᶜ/c!)·1/(1−ρ) / (Σₖ₌₀^{c−1} aᵏ/k! + (aᶜ/c!)·1/(1−ρ)).
  const REFERENCE: Array<[c: number, a: number, exact: number]> = [
    [1, 0.5, 1 / 2], // M/M/1: C = ρ
    [2, 1, 1 / 3],
    [2, 1.5, 9 / 14],
    [5, 3, 81 / 343],
    [5, 4, 128 / 231],
    [10, 5, 390625 / 10819031],
    [10, 8, 4194304 / 10250507],
  ];

  it.each(REFERENCE)("c=%i, a=%f matches the exact value", (c, a, exact) => {
    expect(erlangC(c, a)).toBeCloseTo(exact, 12);
    expect(erlangC(c, a)).toBeCloseTo(erlangCDirect(c, a), 12);
  });

  it("is stable for large c where aᶜ/c! overflows", () => {
    const c = 1500;
    const a = 1400;
    expect(a ** c).toBe(Infinity); // the naive formula would be NaN
    const value = erlangC(c, a);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("is 1 when ρ ≥ 1 and 0 without load", () => {
    expect(erlangC(4, 4)).toBe(1);
    expect(erlangC(4, 10)).toBe(1);
    expect(erlangC(4, 0)).toBe(0);
  });

  it("Erlang B recursion matches M/M/c/c blocking (c=2, a=1 → 1/5)", () => {
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 12);
  });
});

describe("M/M/1 and M/M/c stations", () => {
  it("M/M/1 at ρ = 0.5: mean wait = S·ρ/(1−ρ) = S", () => {
    // capacity 100 rps × 10 ms → exactly one slot
    const st = station({
      lambda: 50,
      instances: 1,
      capacityPerInstance: 100,
      serviceTimeMs: 10,
      maxQueue: Infinity,
      horizonSec: 10,
    });
    expect(st.servers).toBe(1);
    expect(st.utilization).toBeCloseTo(0.5, 12);
    expect(st.meanWaitMs).toBeCloseTo(10 * (0.5 / (1 - 0.5)), 9);
  });

  it("M/M/1 at ρ = 0.8: mean wait = S·ρ/(1−ρ) = 4S", () => {
    const st = station({
      lambda: 80,
      instances: 1,
      capacityPerInstance: 100,
      serviceTimeMs: 10,
      maxQueue: Infinity,
      horizonSec: 10,
    });
    expect(st.meanWaitMs).toBeCloseTo(40, 9);
  });

  it("maps capacityPerInstance to c·μ exactly (c from Little's law)", () => {
    const st = station({
      lambda: 12_000,
      instances: 4,
      capacityPerInstance: 5000,
      serviceTimeMs: 20,
      maxQueue: Infinity,
      horizonSec: 10,
    });
    expect(st.servers).toBe(100); // 5000 rps × 20 ms
    expect(st.capacityRps).toBe(20_000);
    expect(st.utilization).toBeCloseTo(0.6, 12);
  });

  it("W_q(p) is the p-quantile of the wait: P(W_q > W_q(p)) = 1 − p", () => {
    const st = station({
      lambda: 450,
      instances: 1,
      capacityPerInstance: 500,
      serviceTimeMs: 10,
      maxQueue: Infinity,
      horizonSec: 10,
    });
    for (const p of [0.5, 0.95, 0.99]) {
      const w = waitPercentileMs(st, p);
      if (w > 0) expect(probWaitExceeds(st, w)).toBeCloseTo(1 - p, 9);
      else expect(st.waitProbability).toBeLessThanOrEqual(1 - p);
    }
  });

  it("overload: served = capacity, excess dropped, wait = backlog / capacity", () => {
    const st = station({
      lambda: 300,
      instances: 1,
      capacityPerInstance: 100,
      serviceTimeMs: 10,
      maxQueue: 500,
      horizonSec: 10,
    });
    expect(st.regime).toBe("overloaded");
    expect(st.servedRps).toBe(100);
    expect(st.unservedRps).toBe(200);
    expect(st.queueDepth).toBe(500); // min(maxQueue, 200 × 10)
    expect(st.meanWaitMs).toBeCloseTo((500 / 100) * 1000, 9);
  });

  it("never returns non-finite numbers for garbage input", () => {
    const st = station({
      lambda: NaN,
      instances: -3,
      capacityPerInstance: Infinity,
      serviceTimeMs: -1,
      maxQueue: NaN,
      horizonSec: 0,
    });
    for (const v of Object.values(st))
      if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
    expect(st.servedRps).toBe(0);
  });
});

describe("retries and availability", () => {
  it("retry amplification equals λ(1 − f^{R+1})/(1 − f)", () => {
    for (const f of [0, 0.1, 0.5, 0.9, 0.999]) {
      for (const r of [0, 1, 2, 3, 5]) {
        const expected = r === 0 ? 1 : (1 - f ** (r + 1)) / (1 - f);
        expect(retryAmplification(f, r)).toBeCloseTo(expected, 12);
      }
    }
    // Every attempt fails: the full R+1 attempts go out (retry storm).
    expect(retryAmplification(1, 3)).toBe(4);
  });

  it("composes availability: series multiplies, parallel uses the complement", () => {
    expect(seriesAvailability([0.99, 0.99])).toBeCloseTo(0.9801, 12);
    expect(parallelAvailability([0.99, 0.99])).toBeCloseTo(0.9999, 12);
    expect(parallelAvailability([])).toBe(0);
    expect(seriesAvailability([])).toBe(1);
  });
});

describe("mulberry32", () => {
  it("is deterministic per seed and uniform in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
