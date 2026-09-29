/**
 * FaultSpec → modifiers (Spec 08). Pure: the same spec, start time and graph
 * always give the same result. Invalid specs (unknown type, missing or
 * ineligible target) come back as an error message, never an exception.
 */
import type { SimGraph, SimNode } from "@/domain/graph/compile";
import { edgeTargets, getFaultType, nodeTargets, type IntensitySpec } from "./catalog";
import type { CompiledModifier, FaultSpec } from "./types";

export interface FaultContext {
  graph: SimGraph;
  /** Share of reads (the engine's resolved read ratio). */
  readRatio: number;
}

export type CompiledFault =
  | {
      ok: true;
      /** The spec with intensity clamped and duration validated. */
      spec: FaultSpec;
      modifiers: CompiledModifier[];
      /** When the fault heals by itself; undefined = only by hand. */
      endT?: number;
      label: string;
      notes: string[];
    }
  | { ok: false; error: string };

function clampIntensity(v: unknown, range: IntensitySpec | undefined): number | undefined {
  if (!range) return undefined;
  const n = typeof v === "number" && Number.isFinite(v) ? v : range.default;
  return Math.min(range.max, Math.max(range.min, n));
}

/** "App → DB" for an edge, the node label for a node, "All traffic" for global. */
export function targetLabel(spec: FaultSpec, graph: SimGraph): string {
  const { kind, id } = spec.target;
  if (kind === "global") return "All traffic";
  const label = (nodeId: string) => graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
  if (kind === "edge") {
    const e = graph.edges.find((x) => x.id === id);
    return e ? `${label(e.source)} → ${label(e.target)}` : (id ?? "?");
  }
  return id ? label(id) : "?";
}

export function compileFault(spec: FaultSpec, startT: number, ctx: FaultContext): CompiledFault {
  const type = getFaultType(spec?.type);
  if (!type) return { ok: false, error: `Unknown fault type "${String(spec?.type)}".` };
  const target = spec.target ?? { kind: "global" };
  if (!type.targets.includes(target.kind)) {
    return {
      ok: false,
      error: `${type.label} can't target ${target.kind === "global" ? "all traffic" : `a ${target.kind}`}.`,
    };
  }

  const { graph } = ctx;
  if (target.kind === "node") {
    const ok = nodeTargets(type, graph).some((n) => n.id === target.id);
    if (!ok) {
      const exists = graph.nodes.some((n) => n.id === target.id);
      return {
        ok: false,
        error: exists
          ? `${type.label}: ${type.targetHint ?? "this node is not a valid target."}`
          : `${type.label}: the target node is not in the simulation.`,
      };
    }
  } else if (target.kind === "edge") {
    if (!edgeTargets(type, graph).some((e) => e.id === target.id)) {
      return { ok: false, error: `${type.label}: the target connection is not in the simulation.` };
    }
  }

  const duration =
    typeof spec.durationSec === "number" &&
    Number.isFinite(spec.durationSec) &&
    spec.durationSec > 0
      ? spec.durationSec
      : undefined;
  const clean: FaultSpec = {
    type: type.type,
    target: target.kind === "global" ? { kind: "global" } : { kind: target.kind, id: target.id },
    ...(type.intensity ? { intensity: clampIntensity(spec.intensity, type.intensity) } : {}),
    ...(duration !== undefined ? { durationSec: duration } : {}),
    ...(spec.autoHeal === false ? { autoHeal: false } : {}),
  };

  const byId = new Map<string, SimNode>(graph.nodes.map((n) => [n.id, n]));
  const built = type.build(clean, target.kind === "global" ? undefined : target.id, {
    graph,
    byId,
    readRatio: ctx.readRatio,
  });
  if (typeof built === "string") return { ok: false, error: built };

  const faultEnd =
    duration !== undefined && clean.autoHeal !== false ? startT + duration : undefined;
  const modifiers: CompiledModifier[] = built.modifiers.map((m) => {
    const from = startT + Math.max(0, m.from ?? 0);
    const own = m.until !== undefined ? startT + m.until : undefined;
    const endT =
      own === undefined ? faultEnd : faultEnd === undefined ? own : Math.min(own, faultEnd);
    const out: CompiledModifier = {
      kind: m.kind,
      targetIds: [...m.targetIds],
      value: m.value,
      startT: from,
    };
    if (m.onEdges) out.onEdges = true;
    if (endT !== undefined) out.endT = endT;
    if (m.recover) out.recover = { ...m.recover };
    return out;
  });

  // A fault whose every modifier ends by itself (cache warm-up, detection
  // window only) is over when the last one ends.
  const selfEnd =
    modifiers.length > 0 && modifiers.every((m) => m.endT !== undefined)
      ? Math.max(...modifiers.map((m) => m.endT!))
      : undefined;
  const endT = faultEnd ?? (clean.autoHeal === false ? undefined : selfEnd);

  return {
    ok: true,
    spec: clean,
    modifiers,
    ...(endT !== undefined ? { endT } : {}),
    label: `${type.label} · ${targetLabel(clean, graph)}`,
    notes: built.notes,
  };
}
