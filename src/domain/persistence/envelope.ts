import type { Stroke } from "@/store/penStore";
import { sanitizeSloOverrides } from "@/slo/slo";
import type { SloOverrides } from "@/slo/types";
import { migrateGraph, type MigrateOptions } from "./migrate";
import { SCHEMA_VERSION } from "./version";
import {
  serializeEdges,
  serializeNodes,
  type SerializedEdge,
  type SerializedNode,
} from "./serialize";

/**
 * Export/import envelope (Spec 05, PER-02). One format for every JSON the
 * app writes — the top-bar "Export as JSON", the Load dialog's per-design
 * export and (Phase 6) the share link:
 *
 *   { schemaVersion: 3, name, problemId, nodes, edges, strokes, chaosScript?, slo? }
 *
 * Nodes carry `params`; edges carry `data` (label/protocol/async/rule, the
 * rule as the link plus its list of calls); `slo` is the design's SLO
 * override (Spec 11), sanitized on import. Import accepts schemaVersion 1, 2
 * and 3 (missing = 1) and migrates.
 */

/** Placeholder until Spec 08 defines it; preserved verbatim on import/export. */
export type ChaosScript = Record<string, unknown> | unknown[];
export type { SloOverrides };

export interface DesignEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  problemId: string | null;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  strokes: Stroke[];
  chaosScript?: ChaosScript;
  slo?: SloOverrides;
}

export type EnvelopeInput = Omit<DesignEnvelope, "schemaVersion">;

export function buildEnvelope(input: EnvelopeInput): DesignEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: input.name,
    problemId: input.problemId,
    nodes: input.nodes,
    edges: input.edges,
    strokes: input.strokes,
    ...(input.chaosScript !== undefined ? { chaosScript: input.chaosScript } : {}),
    ...(input.slo !== undefined ? { slo: input.slo } : {}),
  };
}

export function stringifyEnvelope(input: EnvelopeInput): string {
  return JSON.stringify(buildEnvelope(input), null, 2);
}

export type ParseEnvelopeResult =
  | {
      ok: true;
      design: DesignEnvelope;
      /** schemaVersion the file declared (1 when missing). */
      fromVersion: number;
      warnings: string[];
    }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Strokes are best-effort: anything malformed is dropped instead of rejecting the file. */
export function sanitizeStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is Stroke =>
      isRecord(s) &&
      typeof s.id === "string" &&
      typeof s.color === "string" &&
      isFiniteNumber(s.width) &&
      Array.isArray(s.points) &&
      s.points.every(
        (p) => Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
      ),
  );
}

/** Structural checks that make a file unusable (vs. recoverable ones the migration fixes). */
function structuralError(parsed: Record<string, unknown>): string | null {
  if (!Array.isArray(parsed.nodes)) return 'Missing or invalid "nodes" array';
  if (!Array.isArray(parsed.edges)) return 'Missing or invalid "edges" array';

  const ids = new Set<string>();
  for (let i = 0; i < parsed.nodes.length; i++) {
    const raw: unknown = parsed.nodes[i];
    if (!isRecord(raw)) return `Node ${i} is not an object`;
    if (typeof raw.id !== "string" || raw.id.length === 0) return `Node ${i} has no string id`;
    if (ids.has(raw.id)) return `Duplicate node id "${raw.id}"`;
    ids.add(raw.id);
    const pos = raw.position;
    if (!isRecord(pos) || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) {
      return `Node "${raw.id}" has an invalid position`;
    }
    if (!isRecord(raw.data)) return `Node "${raw.id}" has no data object`;
  }
  for (let i = 0; i < parsed.edges.length; i++) {
    const raw: unknown = parsed.edges[i];
    if (!isRecord(raw)) return `Edge ${i} is not an object`;
    if (typeof raw.source !== "string" || typeof raw.target !== "string") {
      return `Edge ${i} has no source or target`;
    }
  }
  return null;
}

/**
 * Validate + migrate a parsed JSON design. Accepts the v2 envelope, the v1
 * top-bar envelope and the v1 Load-dialog export (a full SavedDesign).
 * Edges to missing nodes and unknown component types are recoverable
 * (dropped / kept as "custom") and reported in `warnings`.
 */
export function parseEnvelope(
  parsed: unknown,
  options: Pick<MigrateOptions, "isKnownComponent"> = {},
): ParseEnvelopeResult {
  if (!isRecord(parsed)) return { ok: false, error: "File is not a design object" };

  const declared = parsed.schemaVersion;
  const fromVersion =
    isFiniteNumber(declared) && Number.isInteger(declared) && declared >= 1 ? declared : 1;
  if (fromVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Design was saved by a newer version (schema ${fromVersion}); this app reads up to ${SCHEMA_VERSION}`,
    };
  }

  const error = structuralError(parsed);
  if (error) return { ok: false, error };

  // v1 and v2 need the migration; for v3 the same (idempotent) pass
  // validates params and rules and drops dangling edges.
  const warnings: string[] = [];
  const graph = migrateGraph(parsed.nodes, parsed.edges, {
    ...options,
    onWarning: (m) => warnings.push(m),
  });

  const chaosScript =
    typeof parsed.chaosScript === "object" && parsed.chaosScript !== null
      ? (parsed.chaosScript as ChaosScript)
      : undefined;
  const slo = sanitizeSloOverrides(parsed.slo);

  return {
    ok: true,
    fromVersion,
    warnings,
    design: buildEnvelope({
      name: typeof parsed.name === "string" ? parsed.name : "Untitled design",
      problemId: typeof parsed.problemId === "string" ? parsed.problemId : null,
      nodes: serializeNodes(graph.nodes),
      edges: serializeEdges(graph.edges),
      strokes: sanitizeStrokes(parsed.strokes),
      chaosScript,
      slo,
    }),
  };
}

/** `JSON.parse` + `parseEnvelope`. Never throws. */
export function parseEnvelopeJson(
  json: string,
  options?: Pick<MigrateOptions, "isKnownComponent">,
): ParseEnvelopeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Failed to parse JSON" };
  }
  return parseEnvelope(parsed, options);
}
