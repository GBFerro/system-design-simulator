"use client";

import { CircleCheck, CircleX, ExternalLink, TriangleAlert, X } from "lucide-react";
import { ModalShell } from "@/components/dialogs/ModalShell";
import { formatClock } from "@/components/traffic/format";
import { getProblemById } from "@/data/problems";
import type { InterviewReport } from "@/interview/report";
import { loadReferenceIntoTab } from "@/lib/loadReference";
import { useReportStore } from "@/store/reportStore";

/**
 * Final interview report (Spec 09): every point lost with its reason, the
 * process score, time per phase, the phase answers against the reference,
 * the failure drill and the attempt history for this problem.
 */
export function ReportDialog() {
  const open = useReportStore((s) => s.open);
  const report = useReportStore((s) => s.report);
  const history = useReportStore((s) => s.history);
  const close = useReportStore((s) => s.close);
  if (!report) return null;
  const problem = getProblemById(report.problemId);

  return (
    <ModalShell
      open={open}
      onClose={close}
      panelClassName="max-w-2xl p-5"
      ariaLabel="Interview report"
    >
      <div className="space-y-5" data-testid="interview-report">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Interview report · {report.problemTitle}
            </h2>
            <p className="text-[11px] text-zinc-400">
              {new Date(report.finishedAt).toLocaleString("en-US")} ·{" "}
              {formatClock(report.durationSec)} in the interview
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <Big
            label="Design score"
            value={report.score.total}
            note={report.score.verdict}
            testId="report-design"
          />
          <Big
            label="Process score"
            value={report.process.total}
            note="How you ran the interview"
            testId="report-process"
          />
        </div>
        {!report.measured && (
          <p className="flex gap-1.5 text-[11px] text-amber-300">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> The design
            couldn&apos;t be simulated, so its measured checks scored 0.
          </p>
        )}

        <Block title="Design, dimension by dimension">
          <ul className="space-y-2">
            {report.score.categories.map((c) => (
              <li
                key={c.category}
                className="rounded-md bg-zinc-800/60 px-2.5 py-2"
                data-report-category={c.category}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-zinc-200">{c.category}</span>
                  <span className="font-mono text-xs text-zinc-300">
                    {c.score}/{c.maxScore}
                  </span>
                </div>
                {c.feedback.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {c.feedback.map((f) => (
                      <li key={f} className="text-[11px] leading-snug text-zinc-400">
                        − {f}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Process">
          <ul className="space-y-1">
            {report.process.items.map((i) => (
              <li key={i.label} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-zinc-300">
                  {i.label} <span className="text-zinc-400">— {i.detail}</span>
                </span>
                <span className="shrink-0 font-mono text-zinc-300">
                  {i.score === undefined ? "n/a" : `${Math.round(i.score * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Time per phase">
          <ul className="space-y-1">
            {report.phases.map((p) => {
              const over = p.seconds > p.targetSeconds;
              return (
                <li key={p.name} className="flex items-center gap-2 text-[11px]">
                  <span className="w-32 shrink-0 text-zinc-300">{p.name}</span>
                  <span className="relative h-2 flex-1 rounded-full bg-zinc-800">
                    <span
                      className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{
                        width: `${Math.min(100, (p.seconds / Math.max(1, 2 * p.targetSeconds)) * 100)}%`,
                      }}
                    />
                    <span
                      className="absolute inset-y-[-2px] left-1/2 w-px bg-zinc-500"
                      aria-hidden
                    />
                  </span>
                  <span
                    className={`w-24 shrink-0 text-right font-mono ${over ? "text-amber-300" : "text-zinc-300"}`}
                  >
                    {formatClock(p.seconds)} / {formatClock(p.targetSeconds)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>

        <Block title="Your answers vs the reference">
          <div className="space-y-3 text-[11px]">
            <Sub
              title={`Requirements: ${report.requirements.covered} of ${report.requirements.total} critical/important`}
            >
              {report.requirements.missed.map((m) => (
                <Line key={m.id} ok={false}>
                  {m.text} <span className="text-zinc-500">({m.importance})</span>
                </Line>
              ))}
            </Sub>
            <Sub title="Estimates (within 2× counts)">
              {report.estimates.map((e) => (
                <Line key={e.field} ok={e.ok}>
                  {e.label}: yours {e.yours !== undefined ? fmt(e.yours) : "—"} · reference{" "}
                  {fmt(e.reference)}
                </Line>
              ))}
            </Sub>
            <Sub
              title={`API: ${report.apis.matched.length} of ${report.apis.matched.length + report.apis.wrongVerb.length + report.apis.missed.length} reference endpoints`}
            >
              {report.apis.wrongVerb.map((a) => (
                <Line key={a} ok={false}>
                  Wrong verb: {a}
                </Line>
              ))}
              {report.apis.missed.map((a) => (
                <Line key={a} ok={false}>
                  Missing: {a}
                </Line>
              ))}
            </Sub>
            <Sub title="Data model">
              {report.dataModel.entities.map((e) => (
                <Line key={e.name} ok={e.found && e.storeOk && e.partitionOk}>
                  {e.name}: {e.found ? "named" : "missing"} · store {e.store}
                  {e.found && !e.storeOk ? ` (yours: ${e.yourStore})` : ""}
                  {e.partitionKey
                    ? ` · partition key ${e.partitionKey}${e.found && !e.partitionOk ? " (you left it empty)" : ""}`
                    : ""}
                </Line>
              ))}
            </Sub>
          </div>
        </Block>

        {report.drill && (
          <Block title="Failure drill">
            <ul className="space-y-1 text-[11px]">
              {report.drill.map((d, i) => (
                <Line key={i} ok={d.mitigated}>
                  {d.label} · {d.mitigated ? "SLO held" : "SLO broken at the end"} · reacted{" "}
                  {d.reactionSec !== undefined ? `after ${Math.round(d.reactionSec)} s` : "never"} ·
                  error budget {Math.round(d.budgetUsed * 100)}%
                </Line>
              ))}
            </ul>
          </Block>
        )}

        <Block title="Your attempts at this problem">
          <table className="w-full text-left text-[11px]" data-testid="report-history">
            <thead className="text-zinc-400">
              <tr>
                <th className="py-1 font-normal">When</th>
                <th className="py-1 text-right font-normal">Design</th>
                <th className="py-1 text-right font-normal">Process</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: InterviewReport) => (
                <tr key={h.id} className={h.id === report.id ? "text-cyan-300" : "text-zinc-300"}>
                  <td className="py-0.5">{new Date(h.finishedAt).toLocaleString("en-US")}</td>
                  <td className="py-0.5 text-right font-mono">{h.score.total}</td>
                  <td className="py-0.5 text-right font-mono">{h.process.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <div className="flex justify-end gap-2">
          {problem && problem.referenceSolution.nodes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                loadReferenceIntoTab(problem);
                close();
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Compare with the reference
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-md bg-cyan-600 px-3 text-xs font-medium text-white hover:bg-cyan-500"
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

const fmt = (v: number) =>
  v >= 1e9
    ? `${+(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `${+(v / 1e6).toFixed(2)}M`
      : v >= 1e3
        ? `${+(v / 1e3).toFixed(1)}k`
        : `${+v.toFixed(1)}`;

function Big({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: number;
  note: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg bg-zinc-800/70 px-3 py-2.5" data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-zinc-50">
        {value}
        <span className="ml-1 text-xs font-normal text-zinc-500">/100</span>
      </p>
      <p className="text-[10px] text-zinc-400">{note}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 font-medium text-zinc-200">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-zinc-300">
      {ok ? (
        <CircleCheck className="mt-px h-3 w-3 shrink-0 text-emerald-400" aria-label="OK" />
      ) : (
        <CircleX className="mt-px h-3 w-3 shrink-0 text-rose-400" aria-label="Missed" />
      )}
      <span>{children}</span>
    </li>
  );
}
