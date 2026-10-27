"use client";

import { useId } from "react";
import type { Edge, Node } from "@xyflow/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { PARAM, technologyOf, technologySpec } from "@/domain/components/params";
import { resolvedParams } from "@/domain/components/registry";
import { classOf, type Technology } from "@/domain/components/technologies";
import type { Params } from "@/domain/components/types";
import { requestEdges } from "@/domain/graph/returns";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { INPUT } from "./styles";

/**
 * The technology of a central type's node (component-technologies): which
 * real product it is, its instance class, and where the numbers come from.
 * Writes go through the store actions (one undo step, no-op on a read-only
 * tab); the generated `ParamsForm` renders every other param.
 */

/** Keys this picker renders, left out of the generated form. */
export const PICKER_KEYS = [PARAM.technology, PARAM.instanceClass] as const;

/**
 * The technology of the SQL Database feeding this read replica (a request
 * edge into it) when it differs from the replica's own (TEC-45). Both must be
 * real products: a `generic` primary has custom numbers, not a product.
 */
function differingPrimary(
  nodeId: string,
  replica: Technology,
  nodes: readonly Node[],
  edges: readonly Edge[],
): Technology | undefined {
  for (const edge of requestEdges(edges)) {
    if (edge.target !== nodeId) continue;
    const source = nodes.find((n) => n.id === edge.source);
    const data = source?.data as ComponentNodeData | undefined;
    if (data?.componentId !== "sql-db") continue;
    const primary = technologyOf("sql-db", resolvedParams(data));
    if (primary && primary.id !== replica.id) return primary;
  }
  return undefined;
}

interface TechnologyPickerProps {
  nodeId: string;
  componentId: string;
  params: Params;
  disabled: boolean;
}

export function TechnologyPicker({ nodeId, componentId, params, disabled }: TechnologyPickerProps) {
  const id = useId();
  const setNodeTechnology = useCanvasStore((s) => s.setNodeTechnology);
  const setNodeInstanceClass = useCanvasStore((s) => s.setNodeInstanceClass);
  const resetNodeToBenchmark = useCanvasStore((s) => s.resetNodeToBenchmark);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  const tech = technologyOf(componentId, params);
  const cls = tech ? classOf(tech, String(params[PARAM.instanceClass])) : undefined;
  const sized = cls ?? tech?.managed;
  const source = tech?.sources[0];
  const modified =
    sized !== undefined &&
    (params[PARAM.capacityPerInstance] !== sized.capacityPerInstance ||
      params[PARAM.serviceTimeMs] !== sized.serviceTimeMs);
  const primary =
    tech && componentId === "read-replica"
      ? differingPrimary(nodeId, tech, nodes, edges)
      : undefined;

  return (
    <div
      className="space-y-2"
      data-testid="technology-picker"
      data-technology={tech?.id ?? "generic"}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
        <label htmlFor={`${id}-tech`} className="text-xs text-zinc-400">
          Technology
        </label>
        <select
          id={`${id}-tech`}
          disabled={disabled}
          value={String(params[PARAM.technology])}
          onChange={(e) => setNodeTechnology(nodeId, e.target.value)}
          className={INPUT}
        >
          {(technologySpec(componentId).options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {tech?.classes && cls && (
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
          <label htmlFor={`${id}-class`} className="text-xs text-zinc-400">
            Instance class
          </label>
          <select
            id={`${id}-class`}
            disabled={disabled}
            value={cls.id}
            onChange={(e) => setNodeInstanceClass(nodeId, e.target.value)}
            className={`${INPUT} font-mono`}
          >
            {tech.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
        </div>
      )}

      {tech && (
        <div className="space-y-1 rounded-md bg-zinc-800/60 px-2.5 py-2 text-[11px] leading-snug">
          <p className="text-zinc-300" data-testid="technology-description">
            {tech.description}
          </p>
          <p className="text-zinc-400" data-testid="technology-consistency">
            {tech.consistency}
          </p>
          {source && sized && (
            <p
              className="text-zinc-400"
              data-testid="technology-source"
              data-evidence={sized.evidence}
            >
              Based on:{" "}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-cyan-400 underline-offset-2 hover:underline"
              >
                {source.title}
              </a>
              , {source.year} ({sized.evidence})
            </p>
          )}
        </div>
      )}

      {primary && (
        <p
          role="status"
          data-testid="replica-technology-warning"
          className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          Replica technology differs from its primary ({primary.label})
        </p>
      )}

      {tech && modified && (
        <div
          data-testid="technology-modified"
          className="flex items-center justify-between gap-2 text-[11px] text-zinc-400"
        >
          <span>
            Modified from {tech.label}
            {cls ? ` ${cls.id}` : ""}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => resetNodeToBenchmark(nodeId)}
            className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 transition-colors hover:border-cyan-600 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
            Reset to benchmark
          </button>
        </div>
      )}
    </div>
  );
}
