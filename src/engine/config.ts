/**
 * How the engine resolves a run's config (seed, samples, horizon, read ratio,
 * fixed-point iterations) from `SimConfig` and the graph's entry params. Kept
 * apart from `analyze.ts` so light readers (`snapshot.ts`) can resolve the
 * read ratio without loading the steady-state engine.
 */
import { PARAM } from "@/domain/components/registry";
import type { SimGraph, SimNode } from "@/domain/graph/compile";
import { DEFAULT_HORIZON_SEC } from "./core/queueing";
import { DEFAULT_SEED } from "./core/rng";
import { DEFAULT_READ_RATIO, paramNumber } from "./core/routing";
import type { SimConfig } from "./types";

export const DEFAULT_SAMPLES = 2000;
export const DEFAULT_MAX_ITERATIONS = 200;
const MAX_SAMPLES = 20_000;

export interface ResolvedConfig {
  seed: number;
  samples: number;
  horizonSec: number;
  readRatio: number;
  maxIterations: number;
}

export function resolveConfig(
  graph: Pick<SimGraph, "entryIds">,
  byId: Map<string, SimNode>,
  config?: SimConfig,
): ResolvedConfig {
  const c = config ?? {};
  const entryRatio = graph.entryIds
    .map((id) => byId.get(id))
    .map((n) => (n ? paramNumber(n, PARAM.readRatio, NaN) : NaN))
    .find((v) => v >= 0 && v <= 1);
  const resolved: ResolvedConfig = {
    seed: Number.isFinite(c.seed) ? Math.trunc(c.seed!) : DEFAULT_SEED,
    samples:
      Number.isFinite(c.samples) && c.samples! >= 1
        ? Math.min(MAX_SAMPLES, Math.floor(c.samples!))
        : DEFAULT_SAMPLES,
    horizonSec:
      Number.isFinite(c.horizonSec) && c.horizonSec! > 0 ? c.horizonSec! : DEFAULT_HORIZON_SEC,
    readRatio:
      Number.isFinite(c.readRatio) && c.readRatio! >= 0 && c.readRatio! <= 1
        ? c.readRatio!
        : (entryRatio ?? DEFAULT_READ_RATIO),
    maxIterations:
      Number.isFinite(c.maxIterations) && c.maxIterations! >= 1
        ? Math.floor(c.maxIterations!)
        : DEFAULT_MAX_ITERATIONS,
  };
  return resolved;
}
