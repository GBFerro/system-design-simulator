"use client";

import { useId } from "react";
import type { SequenceArrow, SequenceLayout } from "@/lib/sequenceLayout";
import { setFlowHighlight, useFlowHighlightStore } from "@/store/flowHighlightStore";

const LINE = "#a1a1aa"; // zinc-400
const ERROR = "#f87171"; // red-400
const ACTIVE = "#22d3ee"; // cyan-400, the canvas highlight's color
const COLORS = [LINE, ERROR, ACTIVE];

/** Short ms label: one decimal under 10 ms, whole ms above. */
function ms(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;
}

function truncate(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * The trace of one request as a UML-style sequence diagram (request-flow,
 * FLW-34..39): a lifeline per node, a solid arrow with a filled head per
 * call, a dashed arrow with an open head per response, a solid arrow with an
 * open head per async call (no response). Calls carry their number and,
 * with `timed`, their round trip. Hovering, focusing or tapping an arrow
 * highlights its edge on the canvas and the way it goes.
 */
export function SequenceDiagram({
  layout,
  labels,
  timed,
}: {
  layout: SequenceLayout;
  labels: Readonly<Record<string, string>>;
  timed: boolean;
}) {
  const uid = useId().replace(/[^\w-]/g, "");
  const active = useFlowHighlightStore((s) => s.highlight);
  const filled = `seq-filled-${uid}`;
  const open = `seq-open-${uid}`;
  const label = (id: string) => labels[id] ?? id;

  const describe = (a: SequenceArrow) => {
    const what =
      a.kind === "response"
        ? `Response ${a.n}: ${label(a.from)} → ${label(a.to)}${a.ok ? "" : " (failed)"}`
        : `${a.kind === "async" ? "Async call" : "Call"} ${a.n}: ${label(a.from)} → ${label(a.to)}`;
    return timed && a.kind === "call" && a.ms !== undefined ? `${what}, ${ms(a.ms)}` : what;
  };

  return (
    <svg
      width={layout.width}
      height={layout.height + 8}
      viewBox={`0 0 ${layout.width} ${layout.height + 8}`}
      className="block"
      role="group"
      aria-label="Sequence diagram of one request"
      data-testid="sequence-diagram"
    >
      <defs>
        {COLORS.map((c, i) => (
          <g key={c}>
            <marker
              id={`${filled}-${i}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
            <marker
              id={`${open}-${i}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10" fill="none" stroke={c} strokeWidth="1.5" />
            </marker>
          </g>
        ))}
      </defs>

      {layout.lifelines.map((l) => (
        <g key={l.nodeId} data-lifeline={l.label}>
          <text
            x={l.x}
            y={14}
            textAnchor="middle"
            className="fill-zinc-200 text-[10px] font-medium"
          >
            <title>{l.label}</title>
            {truncate(l.label)}
          </text>
          <line
            x1={l.x}
            x2={l.x}
            y1={22}
            y2={layout.height + 4}
            stroke="#52525b"
            strokeDasharray="2 3"
          />
        </g>
      ))}

      {layout.arrows.map((a, i) => {
        const dir = a.kind === "response" ? "res" : "req";
        const on = active?.edgeId === a.edgeId && active.dir === dir;
        const color = on ? ACTIVE : a.ok ? LINE : ERROR;
        const left = Math.min(a.x1, a.x2);
        const mid = (a.x1 + a.x2) / 2;
        const highlight = () => setFlowHighlight({ edgeId: a.edgeId, dir });
        const clear = () => setFlowHighlight(null);
        return (
          <g
            key={i}
            data-arrow={a.kind}
            data-n={a.n}
            data-from-label={label(a.from)}
            data-to-label={label(a.to)}
            data-at={a.at}
            data-active={on || undefined}
            role="button"
            tabIndex={0}
            aria-label={describe(a)}
            className="cursor-pointer outline-none"
            onPointerEnter={(e) => e.pointerType === "mouse" && highlight()}
            onPointerLeave={(e) => e.pointerType === "mouse" && clear()}
            onFocus={highlight}
            onBlur={clear}
            // Touch and pen: a tap highlights; tapping the same arrow again clears.
            onPointerDown={(e) => e.pointerType !== "mouse" && (on ? clear() : highlight())}
          >
            {/* wide transparent hit area */}
            <rect
              x={left}
              y={a.y - 8}
              width={Math.abs(a.x2 - a.x1)}
              height={16}
              fill="transparent"
            />
            <line
              x1={a.x1}
              x2={a.x2}
              y1={a.y}
              y2={a.y}
              stroke={color}
              strokeWidth={on ? 2 : 1.25}
              strokeDasharray={a.kind === "response" ? "4 3" : undefined}
              markerEnd={`url(#${a.kind === "call" ? filled : open}-${COLORS.indexOf(color)})`}
            />
            {a.kind !== "response" && (
              <g>
                <circle cx={a.x1} cy={a.y} r={7} fill="#27272a" stroke={color} />
                <text
                  x={a.x1}
                  y={a.y + 3}
                  textAnchor="middle"
                  className="fill-zinc-200 font-mono text-[9px]"
                >
                  {a.n}
                </text>
              </g>
            )}
            {a.kind === "async" && (
              <text x={mid} y={a.y - 4} textAnchor="middle" className="fill-zinc-400 text-[9px]">
                async
              </text>
            )}
            {a.kind === "call" && timed && a.ms !== undefined && (
              <text
                x={mid}
                y={a.y - 4}
                textAnchor="middle"
                className="fill-zinc-300 font-mono text-[9px]"
                data-ms={a.ms}
              >
                {ms(a.ms)}
              </text>
            )}
            {a.kind === "response" && !a.ok && (
              <text x={mid} y={a.y - 4} textAnchor="middle" className="fill-red-400 text-[9px]">
                error
              </text>
            )}
            {a.attempt > 0 && a.kind === "call" && (
              <text x={left + 10} y={a.y + 11} className="fill-zinc-400 text-[9px]">
                retry {a.attempt}
              </text>
            )}
          </g>
        );
      })}

      {layout.marks.map((m) => (
        <text
          key={`${m.n}-${m.nodeId}`}
          x={m.x + 6}
          y={m.y + 12}
          className={`text-[9px] font-semibold ${m.hit ? "fill-emerald-400" : "fill-amber-400"}`}
          data-mark={m.hit ? "hit" : "miss"}
        >
          {m.hit ? "hit" : m.viaFailure ? "miss (cache failed)" : "miss"}
        </text>
      ))}
    </svg>
  );
}
