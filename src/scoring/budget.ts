/**
 * Every scoring category is worth this many points (5 categories → 100).
 * Each rule in `rules/` exports a `BUDGET` whose values sum to this;
 * `tests/unit/scoring.test.ts` checks the sum and that the max is reachable.
 */
export const CATEGORY_MAX_SCORE = 20;

/* ---------- measured rubric (Spec 09) ---------- */

/** Error rate the design must stay under to "hold" a load or a fault (the drill SLO too). */
export const SLO_ERROR_RATE = 0.01;
/** Utilization every tier must stay under at the peak (headroom). */
export const PEAK_UTILIZATION = 0.8;
/** Removing one instance keeps utilization under this → over-provisioned. */
export const OVERPROVISIONED_UTILIZATION = 0.15;
