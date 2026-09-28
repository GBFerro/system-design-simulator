/**
 * Particle budget and edge styling for the flow overlay (Spec 07, OBS-04).
 * Pure functions — the canvas layer lives in `components/canvas/FlowParticles`.
 */
import type { RuntimeEdgeStatus } from "@/engine/types";

/** Hard cap on particles drawn per frame, all edges together. */
export const MAX_PARTICLES = 2000;

/** Particles per 100 flow-px of edge, per decade of RPS (density ∝ log10(1 + rps)). */
export const PARTICLES_PER_100PX_PER_DECADE = 1.5;

/** Max particles on one edge, before the global cap. */
export const MAX_PARTICLES_PER_EDGE = 60;

/** Particle density on an edge: particles per 100 flow-px, ∝ log10(1 + rps). */
export function particleDensity(rps: number): number {
  if (!Number.isFinite(rps) || rps <= 0) return 0;
  return PARTICLES_PER_100PX_PER_DECADE * Math.log10(1 + rps);
}

/**
 * Particles per edge for this frame. Each edge with load gets
 * `density(rps) × length / 100` (at least 1, at most MAX_PARTICLES_PER_EDGE);
 * if the total exceeds `cap`, every edge is scaled down by the same factor
 * (largest-remainder rounding, keeping ≥ 1 per loaded edge while the cap
 * allows it), so the sum is exactly `cap` — never above it.
 */
export function particleBudget(
  edges: readonly { rps: number; length: number }[],
  cap = MAX_PARTICLES,
): number[] {
  const want = edges.map(({ rps, length }) => {
    const density = particleDensity(rps);
    if (density === 0 || !(length > 0)) return 0;
    return Math.min(MAX_PARTICLES_PER_EDGE, Math.max(1, Math.round((density * length) / 100)));
  });
  const total = want.reduce((s, n) => s + n, 0);
  if (total <= cap) return want;

  // Scale every edge by the same factor; floor, then hand the leftover to the
  // largest remainders (so the total lands exactly on the cap).
  const scale = cap / total;
  const exact = want.map((n) => n * scale);
  const out = exact.map((x, i) => (want[i] > 0 ? Math.max(1, Math.floor(x)) : 0));
  let sum = out.reduce((s, n) => s + n, 0);
  if (sum < cap) {
    const order = exact
      .map((x, i) => ({ i, frac: want[i] > 0 ? x - Math.floor(x) : -1 }))
      .filter((r) => r.frac >= 0)
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && sum < cap; k++) {
      out[order[k].i]++;
      sum++;
    }
  }
  // The ≥ 1 floor can overshoot when there are more loaded edges than `cap`:
  // trim from the end until the cap holds.
  for (let i = out.length - 1; i >= 0 && sum > cap; i--) {
    const cut = Math.min(out[i], sum - cap);
    out[i] -= cut;
    sum -= cut;
  }
  return out;
}

/** Particle speed along an edge in flow-px per second; grows gently with load. */
export function particleSpeed(rps: number): number {
  return 70 + 18 * Math.log10(1 + Math.max(0, rps));
}

/** Edge stroke width (flow px) ∝ log of the load; the idle width with no load. */
export function edgeStrokeWidth(rps: number | undefined): number {
  if (rps === undefined || !Number.isFinite(rps) || rps <= 0) return 1.5;
  return Math.min(6, 1.5 + 0.6 * Math.log10(1 + rps));
}

/** Stroke / particle color per edge status (ok = cyan, slow = amber, error = rose). */
export const EDGE_STATUS_COLOR: Record<RuntimeEdgeStatus, string> = {
  ok: "#22d3ee",
  slow: "#f59e0b",
  error: "#f43f5e",
};
