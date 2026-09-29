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

/** Below this mean, Poisson variates are drawn exactly (inversion); above, by a normal approximation. */
export const POISSON_EXACT_MAX_MEAN = 30;

/** Standard normal variate (Box–Muller, one of the pair). */
export function sampleStandardNormal(rng: Rng): number {
  const u1 = 1 - rng(); // (0, 1]
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Poisson variate with the given mean (a count ≥ 0).
 *
 * - mean ≤ 30: exact, by inversion of the CDF (O(mean) steps, one uniform).
 * - mean > 30: normal approximation N(mean, mean), rounded and clamped at 0.
 *   Its error is O(1/√mean) and shrinks as the load grows; at 30 the skew is
 *   already ≈ 0.18. It keeps the cost O(1) at 1M rps (mean 50 000 per tick).
 */
export function samplePoisson(rng: Rng, mean: number): number {
  if (!(mean > 0) || !Number.isFinite(mean)) return 0;
  if (mean <= POISSON_EXACT_MAX_MEAN) {
    const u = rng();
    let k = 0;
    let p = Math.exp(-mean);
    let cdf = p;
    while (u > cdf && k < 1000) {
      k++;
      p *= mean / k;
      cdf += p;
    }
    return k;
  }
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * sampleStandardNormal(rng)));
}
