"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Scale } from "lucide-react";
import { CURRENCIES, formatMoney, formatPrice, RATES_AS_OF, type Currency } from "@/cost/currency";
import {
  COST_AREAS,
  HOURS_PER_MONTH,
  MILLION_REQUESTS_PER_RPS_MONTH,
  type CostLine,
} from "@/cost/estimate";
import { rightSize, rightSizeDelta, TARGET_UTILIZATION } from "@/cost/rightSize";
import type { TickSnapshot } from "@/engine/types";
import { useCostEstimate } from "@/components/cost/useCostEstimate";
import { getProblemById } from "@/data/problems";
import { PRICE_TABLE } from "@/domain/components/pricing";
import { SURGE_FACTOR } from "@/scoring/budget";
import { rps as formatRps, pct } from "@/scoring/steady";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";

const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wider text-zinc-400";

/**
 * Cost (Spec 10): estimated $/month and $/1M requests at the latest simulated
 * load, broken down by area and by component (click a line for its
 * assumptions), the problem's budget, and right-size (CST-03).
 */
export function CostPanel() {
  const currency = useAppStore((s) => s.currency);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const problemId = useAppStore((s) => s.selectedProblemId);
  const problem = getProblemById(problemId);
  const { estimate, perMillion, snapshot } = useCostEstimate();
  const money = (usd: number, compact = false) => formatMoney(usd, currency, compact);

  if (estimate.lines.length === 0) {
    return (
      <section aria-label="Cost" className="space-y-3" data-testid="cost-panel">
        <CostHeader currency={currency} onCurrency={setCurrency} />
        <p className="text-[11px] text-zinc-400">Add components to the canvas to estimate cost.</p>
      </section>
    );
  }

  const budget = problem?.requirements.budgetMonthlyUsd;
  const peak = problem ? problem.requirements.readsPerSec + problem.requirements.writesPerSec : 0;

  return (
    <section aria-label="Cost" className="space-y-4" data-testid="cost-panel">
      <CostHeader currency={currency} onCurrency={setCurrency} />

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-800 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Per month</p>
          <p className="font-mono text-base text-zinc-100" data-testid="cost-monthly">
            {money(estimate.monthly)}
          </p>
        </div>
        <div className="rounded-md bg-zinc-800 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Per 1M requests</p>
          <p className="font-mono text-base text-zinc-100" data-testid="cost-per-million">
            {perMillion === null ? "—" : money(perMillion)}
          </p>
        </div>
      </div>

      {snapshot ? (
        <p className="text-[11px] leading-snug text-zinc-400">
          At {formatRps(snapshot.offeredRps)} rps, the latest simulated load
          {snapshot.t > 0 ? " (live, updated every second)" : ""}.
        </p>
      ) : (
        <p className="rounded-md border border-zinc-700 bg-zinc-800/50 px-2.5 py-2 text-[11px] leading-snug text-zinc-400">
          Only fixed costs so far (instances, monthly fees). Run <strong>Simulate</strong> or play
          live traffic to price the requests each component handles.
        </p>
      )}

      {budget !== undefined && budget > 0 && (
        <BudgetBar monthly={estimate.monthly} budget={budget} peak={peak} money={money} />
      )}

      <div className="space-y-1.5">
        <p className={SECTION_TITLE}>By area</p>
        {COST_AREAS.filter((a) => estimate.byArea[a.id] > 0).map((a) => {
          const share = estimate.monthly > 0 ? estimate.byArea[a.id] / estimate.monthly : 0;
          return (
            <div key={a.id} className="space-y-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-300">{a.label}</span>
                <span className="font-mono text-zinc-300">
                  {money(estimate.byArea[a.id])}{" "}
                  <span className="text-zinc-400">({pct(share)})</span>
                </span>
              </div>
              <div className="h-1 rounded-full bg-zinc-800" aria-hidden>
                <div
                  className="h-1 rounded-full bg-emerald-500/70"
                  style={{ width: `${Math.max(1, share * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <p className={SECTION_TITLE}>By component</p>
        <ul className="space-y-1" data-testid="cost-lines">
          {estimate.lines.map((line) => (
            <CostLineRow key={line.nodeId} line={line} currency={currency} />
          ))}
        </ul>
      </div>

      <RightSizeSection money={money} snapshot={snapshot} />

      <details className="text-[11px] text-zinc-400" data-testid="cost-sources">
        <summary className="cursor-pointer select-none hover:text-zinc-200">
          Price sources ({PRICE_TABLE.asOf})
        </summary>
        <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {PRICE_TABLE.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-cyan-400 underline-offset-2 hover:underline"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function CostHeader({
  currency,
  onCurrency,
}: {
  currency: Currency;
  onCurrency: (c: Currency) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className={SECTION_TITLE}>Cost</p>
        <div role="radiogroup" aria-label="Currency" className="flex rounded-md bg-zinc-800 p-0.5">
          {CURRENCIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={currency === c.id}
              onClick={() => onCurrency(c.id)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                currency === c.id
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {c.id}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-snug text-zinc-400">
        Estimates from approximate {PRICE_TABLE.region} list prices ({PRICE_TABLE.asOf}), for
        learning — not a quote.
        {currency !== "USD" &&
          ` Converted from USD at a fixed rate of ${CURRENCIES.find((c) => c.id === currency)?.perUsd} (${RATES_AS_OF}).`}
      </p>
    </div>
  );
}

function BudgetBar({
  monthly,
  budget,
  peak,
  money,
}: {
  monthly: number;
  budget: number;
  peak: number;
  money: (usd: number, compact?: boolean) => string;
}) {
  const ratio = monthly / budget;
  const over = ratio > 1;
  return (
    <div className="space-y-1" data-testid="cost-budget">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-300">Budget</span>
        <span className={`font-mono ${over ? "text-rose-300" : "text-zinc-300"}`}>
          {money(monthly, true)} / {money(budget, true)} ({pct(ratio)})
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800" aria-hidden>
        <div
          className={`h-1.5 rounded-full ${over ? "bg-rose-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-400">
        The score prices the design at the problem&apos;s peak ({formatRps(peak)} rps): within
        budget earns full marks, down to none at twice it.
      </p>
    </div>
  );
}

function CostLineRow({ line, currency }: { line: CostLine; currency: Currency }) {
  const [open, setOpen] = useState(false);
  const money = (usd: number) => formatMoney(usd, currency);
  const price = (usd: number) => formatPrice(usd, currency);
  const p = line.pricing;
  return (
    <li className="rounded-md bg-zinc-800/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
          {line.label}
          {line.instances > 1 && p.perInstanceHour > 0 && (
            <span className="text-zinc-400"> ×{line.instances}</span>
          )}
        </span>
        <span className="font-mono text-[11px] text-zinc-300">{money(line.monthly)}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-zinc-700/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-zinc-400">
          {p.perInstanceHour > 0 && (
            <p>
              {line.instances} × {price(p.perInstanceHour)}/h × {HOURS_PER_MONTH} h ={" "}
              {money(line.instanceMonthly)}
            </p>
          )}
          {p.baseMonthly > 0 && <p>fixed {money(p.baseMonthly)}/month</p>}
          {p.perMillionRequests > 0 && (
            <p>
              {formatRps(line.billedRps)} rps × {MILLION_REQUESTS_PER_RPS_MONTH} M/month ×{" "}
              {price(p.perMillionRequests)}/1M = {money(line.requestMonthly)}
            </p>
          )}
          <p className="font-sans text-[11px] text-zinc-400">{p.assumptions}</p>
        </div>
      )}
    </li>
  );
}

/** CST-03: suggested instances at the current load; stateless tiers apply in one undo step. */
function RightSizeSection({
  money,
  snapshot,
}: {
  money: (usd: number, compact?: boolean) => string;
  snapshot: TickSnapshot | null;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const setInstanceCounts = useCanvasStore((s) => s.setInstanceCounts);
  const readOnly = useIsActiveTabReadOnly();
  const suggestions = useMemo(
    () => (snapshot ? rightSize(nodes, (id) => snapshot.nodes[id]?.rpsIn ?? 0) : []),
    [nodes, snapshot],
  );
  const applicable = suggestions.filter((s) => s.applicable);
  const delta = rightSizeDelta(suggestions);

  const apply = () =>
    setInstanceCounts(Object.fromEntries(applicable.map((s) => [s.nodeId, s.to])));

  return (
    <div className="space-y-2" data-testid="right-size">
      <div className="flex items-center gap-1.5">
        <Scale className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
        <p className={SECTION_TITLE}>Right-size</p>
      </div>
      <p className="text-[11px] leading-snug text-zinc-400">
        Instances for ~{pct(TARGET_UTILIZATION)} utilization at the current load (so a{" "}
        {SURGE_FACTOR}× surge stays under saturation), at least 2 per tier.
      </p>
      {!snapshot ? (
        <p className="text-[11px] text-zinc-400">Simulate first: right-size needs the load.</p>
      ) : suggestions.length === 0 ? (
        <p className="text-[11px] text-emerald-300">Every tier is already sized for this load.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li
                key={s.nodeId}
                className="flex items-center justify-between gap-2 rounded-md bg-zinc-800/60 px-2 py-1.5 text-[11px]"
              >
                <span className="min-w-0 truncate text-zinc-200">
                  {s.label}
                  {!s.applicable && (
                    <span
                      className="ml-1 text-zinc-400"
                      title="Stateful tier: resizing moves data, so it's only a suggestion"
                    >
                      (suggestion)
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-zinc-300">
                  {s.from}→{s.to}{" "}
                  <span className="text-zinc-400">
                    {pct(s.utilizationBefore)}→{pct(s.utilizationAfter)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {applicable.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-[11px] ${delta <= 0 ? "text-emerald-300" : "text-amber-300"}`}
                data-testid="right-size-delta"
              >
                {delta <= 0 ? "Saves" : "Adds"} {money(Math.abs(delta))}/month
              </span>
              <button
                type="button"
                onClick={apply}
                disabled={readOnly}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                title={
                  readOnly
                    ? "Reference tabs are read-only"
                    : "Apply to the stateless tiers (⌘Z undoes it)"
                }
              >
                Apply right-size
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
