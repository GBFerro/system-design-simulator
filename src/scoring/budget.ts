/**
 * Every scoring category is worth this many points (5 categories → 100).
 * Each rule in `rules/` exports a `BUDGET` whose values sum to this;
 * `tests/unit/scoring.test.ts` checks the sum and that the max is reachable.
 */
export const CATEGORY_MAX_SCORE = 20;
