/**
 * Seeded PRNG (Spec 04, determinism). `mulberry32` is a tiny 32-bit
 * generator: the same seed always yields the same sequence, on every JS
 * engine, so the same graph + seed gives a bit-identical result.
 */
export type Rng = () => number;

export const DEFAULT_SEED = 42;

/** Returns uniform floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = (Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_SEED) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential variate with the given mean (inverse-CDF). */
export function sampleExponential(rng: Rng, mean: number): number {
  if (!(mean > 0)) return 0;
  // 1 - u is in (0, 1], so the log is finite
  return -mean * Math.log(1 - rng());
}
