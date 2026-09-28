import { describe, expect, it } from "vitest";
import { mulberry32, samplePoisson } from "@/engine/core/rng";
import {
  PATTERN_KINDS,
  defaultPattern,
  patternHorizonSec,
  peakRate,
  rateAt,
  rpsToSlider,
  sanitizePattern,
  sliderToRps,
} from "@/engine/traffic/patterns";
import { MAX_RPS, MIN_RPS, type TrafficPattern } from "@/engine/traffic/types";

describe("rateAt", () => {
  it("constant: the same rate at every time, including outside any interval", () => {
    const p: TrafficPattern = { kind: "constant", rps: 1234 };
    for (const t of [-5, 0, 1, 60, 1e6]) expect(rateAt(p, t)).toBe(1234);
  });

  it("ramp: from at the start, linear in the middle, holds `to` at the end and after", () => {
    const p: TrafficPattern = { kind: "ramp", fromRps: 100, toRps: 1100, durationSec: 10 };
    expect(rateAt(p, -1)).toBe(100);
    expect(rateAt(p, 0)).toBe(100);
    expect(rateAt(p, 5)).toBeCloseTo(600, 9);
    expect(rateAt(p, 10)).toBe(1100);
    expect(rateAt(p, 99)).toBe(1100);
    // ramps down too
    const down: TrafficPattern = { kind: "ramp", fromRps: 1000, toRps: 0, durationSec: 4 };
    expect(rateAt(down, 1)).toBeCloseTo(750, 9);
    expect(rateAt(down, 8)).toBe(0);
  });

  it("spike: base before, base × N during [start, start + duration), base after", () => {
    const p: TrafficPattern = {
      kind: "spike",
      baseRps: 200,
      multiplier: 5,
      startSec: 10,
      durationSec: 30,
    };
    expect(rateAt(p, 0)).toBe(200);
    expect(rateAt(p, 9.99)).toBe(200);
    expect(rateAt(p, 10)).toBe(1000);
    expect(rateAt(p, 25)).toBe(1000);
    expect(rateAt(p, 39.99)).toBe(1000);
    expect(rateAt(p, 40)).toBe(200);
    expect(rateAt(p, 500)).toBe(200);
  });

  it("diurnal: mean × (1 + a·sin(2πt/T)); peak at T/4, trough at 3T/4, amplitude clamped", () => {
    const p: TrafficPattern = { kind: "diurnal", meanRps: 1000, amplitude: 0.5, periodSec: 240 };
    expect(rateAt(p, 0)).toBeCloseTo(1000, 9);
    expect(rateAt(p, 60)).toBeCloseTo(1500, 9);
    expect(rateAt(p, 120)).toBeCloseTo(1000, 9);
    expect(rateAt(p, 180)).toBeCloseTo(500, 9);
    expect(rateAt(p, 240 + 60)).toBeCloseTo(1500, 9); // periodic
    // amplitude > 1 would go negative: clamped to 1 → never below 0
    const wild = { ...p, amplitude: 3 };
    expect(rateAt(wild, 180)).toBeCloseTo(0, 9);
    expect(rateAt(wild, 60)).toBeCloseTo(2000, 9);
  });

  it("steps: the last step at or before t; the first step's rate before it", () => {
    const p: TrafficPattern = {
      kind: "steps",
      steps: [
        { atSec: 5, rps: 100 },
        { atSec: 10, rps: 300 },
        { atSec: 20, rps: 50 },
      ],
    };
    expect(rateAt(p, 0)).toBe(100);
    expect(rateAt(p, 5)).toBe(100);
    expect(rateAt(p, 12)).toBe(300);
    expect(rateAt(p, 20)).toBe(50);
    expect(rateAt(p, 1e5)).toBe(50);
    expect(rateAt({ kind: "steps", steps: [] }, 3)).toBe(0);
  });

  it("never returns a negative number or NaN, whatever the input", () => {
    const bad = [
      { kind: "constant", rps: NaN },
      { kind: "constant", rps: -10 },
      { kind: "ramp", fromRps: -5, toRps: Infinity, durationSec: 0 },
      { kind: "spike", baseRps: NaN, multiplier: -2, startSec: NaN, durationSec: -1 },
      { kind: "diurnal", meanRps: 100, amplitude: NaN, periodSec: 0 },
      { kind: "steps", steps: [{ atSec: NaN, rps: -1 }] },
    ] as unknown as TrafficPattern[];
    for (const p of bad) {
      for (const t of [NaN, -1, 0, 1, 1e9]) {
        const r = rateAt(p, t);
        expect(Number.isFinite(r) && r >= 0).toBe(true);
        const s = rateAt(sanitizePattern(p), t);
        expect(Number.isFinite(s) && s >= 0).toBe(true);
      }
    }
  });
});

describe("sanitizePattern / defaults", () => {
  it("coerces garbage into a valid pattern", () => {
    expect(sanitizePattern(null)).toEqual({ kind: "constant", rps: 10_000 });
    expect(sanitizePattern({ kind: "bogus" }).kind).toBe("constant");
    const d = sanitizePattern({ kind: "diurnal", meanRps: 5, amplitude: 7, periodSec: -3 });
    expect(d).toEqual({ kind: "diurnal", meanRps: 5, amplitude: 1, periodSec: 1 });
    const s = sanitizePattern({
      kind: "steps",
      steps: [
        { atSec: 20, rps: 1 },
        { atSec: 5, rps: 2 },
      ],
    });
    expect(s).toEqual({
      kind: "steps",
      steps: [
        { atSec: 5, rps: 2 },
        { atSec: 20, rps: 1 },
      ],
    });
  });

  it("every kind has sane defaults that survive sanitizing", () => {
    for (const kind of PATTERN_KINDS) {
      const p = defaultPattern(kind, 2000);
      expect(p.kind).toBe(kind);
      expect(sanitizePattern(p)).toEqual(p);
      expect(peakRate(p)).toBeGreaterThan(0);
      expect(patternHorizonSec(p)).toBeGreaterThan(0);
    }
    expect(peakRate(defaultPattern("spike", 2000))).toBe(10_000);
  });
});

describe("log-scale RPS slider", () => {
  it("maps [0, 1] onto [10, 1M] logarithmically and round-trips", () => {
    expect(sliderToRps(0, MIN_RPS, MAX_RPS)).toBe(10);
    expect(sliderToRps(1, MIN_RPS, MAX_RPS)).toBe(1_000_000);
    expect(sliderToRps(0.4, MIN_RPS, MAX_RPS)).toBe(1000); // 10^(1 + 5·0.4)
    for (const r of [10, 250, 1000, 42_000, 1_000_000]) {
      expect(sliderToRps(rpsToSlider(r, MIN_RPS, MAX_RPS), MIN_RPS, MAX_RPS)).toBeCloseTo(r, -1);
    }
  });
});

describe("Poisson arrivals", () => {
  it("sample mean converges to the requested mean (exact and normal-approximation regimes)", () => {
    for (const mean of [0.05, 0.5, 5, 29, 31, 500, 50_000]) {
      const rng = mulberry32(7);
      const n = 20_000;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        const k = samplePoisson(rng, mean);
        expect(Number.isInteger(k) && k >= 0).toBe(true);
        sum += k;
        sumSq += k * k;
      }
      const m = sum / n;
      const variance = sumSq / n - m * m;
      // 5 standard errors of the mean
      expect(Math.abs(m - mean)).toBeLessThan(5 * Math.sqrt(mean / n) + 1e-9);
      // Poisson: variance = mean
      expect(variance / mean).toBeGreaterThan(0.9);
      expect(variance / mean).toBeLessThan(1.1);
    }
  });

  it("zero, negative or non-finite means give no arrivals", () => {
    const rng = mulberry32(1);
    for (const mean of [0, -3, NaN, Infinity]) expect(samplePoisson(rng, mean)).toBe(0);
  });
});
