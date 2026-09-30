"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { INTERVIEW_DATA, type ProblemInterviewData } from "@/data/interviewData";
import type { Problem } from "@/types/problem";
import {
  effectivePeak,
  type EstimateField,
  type HttpMethod,
  type StoreKind,
} from "@/interview/checks";
import { useInterviewStore } from "@/store/interviewStore";
import { formatRps } from "@/components/traffic/format";

/**
 * Answer forms of the checkable phases 1–4 (Spec 09). Loaded on demand (it
 * reads the interview scripts). Answers live in `interviewStore` (persisted,
 * so a refresh keeps them); the final report grades them against the
 * reference. Free text is kept but never graded.
 */
export function PhaseForm({ phase, problem }: { phase: number; problem: Problem }) {
  const data = INTERVIEW_DATA.find((d) => d.problemId === problem.id);
  if (!data) return null;
  if (phase === 0) return <RequirementsForm data={data} />;
  if (phase === 1) return <EstimationForm problem={problem} data={data} />;
  if (phase === 2) return <ApiForm />;
  if (phase === 3) return <DataModelForm />;
  return null;
}

const input =
  "h-8 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400">{title}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------- phase 1 ---------- */

function RequirementsForm({ data }: { data: ProblemInterviewData }) {
  const checked = useInterviewStore((s) => s.answers.requirements);
  const notes = useInterviewStore((s) => s.answers.requirementNotes);
  const toggle = useInterviewStore((s) => s.toggleRequirement);
  const setNotes = useInterviewStore((s) => s.setRequirementNotes);
  const notesId = useId();
  return (
    <Section
      title="Your requirements"
      hint="Mark the requirements you'd commit to for this design. The report compares them with the critical and important ones of the reference."
    >
      <ul className="space-y-1" data-testid="requirements-form">
        {data.requirements.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md bg-zinc-800/70 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
              <input
                type="checkbox"
                checked={checked.includes(r.id)}
                onChange={() => toggle(r.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyan-500"
              />
              <span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {r.category === "functional" ? "Functional" : "Non-functional"} ·{" "}
                </span>
                {r.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label htmlFor={notesId} className="block text-[11px] text-zinc-400">
        Anything else you'd clarify (not graded)
      </label>
      <textarea
        id={notesId}
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
      />
    </Section>
  );
}

/* ---------- phase 2 ---------- */

/** "1.5M" → 1_500_000, "20k" → 20_000, "3,000" → 3000; undefined when not a number. */
export function parseQuantity(text: string): number | undefined {
  const m = /^\s*([\d.,]+)\s*([kmbt]?)\s*$/i.exec(text);
  if (!m) return undefined;
  const scale = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase() as "" | "k"];
  const v = Number(m[1].replace(/,/g, "")) * scale;
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

const ESTIMATE_FIELDS: { field: EstimateField; label: string; unit: string }[] = [
  { field: "dau", label: "Daily active users", unit: "users" },
  { field: "readsPerSec", label: "Peak reads", unit: "req/s" },
  { field: "writesPerSec", label: "Peak writes", unit: "req/s" },
  { field: "storageGB", label: "Storage", unit: "GB" },
];

function EstimateInput({
  field,
  label,
  unit,
}: {
  field: EstimateField;
  label: string;
  unit: string;
}) {
  const value = useInterviewStore((s) => s.answers.estimates[field]);
  const setEstimate = useInterviewStore((s) => s.setEstimate);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const shown = draft ?? (value !== undefined ? String(value) : "");
  const invalid = draft !== null && draft.trim() !== "" && parseQuantity(draft) === undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] text-zinc-400">
        {label} <span className="text-zinc-500">({unit})</span>
      </label>
      <input
        id={id}
        value={shown}
        inputMode="decimal"
        placeholder="e.g. 20k, 1.5M"
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setEstimate(field, parseQuantity(e.target.value));
        }}
        onBlur={() => setDraft(null)}
        className={`${input} font-mono ${invalid ? "border-rose-500" : ""}`}
      />
    </div>
  );
}

function EstimationForm({ problem, data }: { problem: Problem; data: ProblemInterviewData }) {
  const estimates = useInterviewStore((s) => s.answers.estimates);
  const peak = effectivePeak(estimates, problem);
  const h = data.estimationHints;
  return (
    <Section
      title="Your estimates"
      hint="Back-of-envelope from the brief. Numbers accept k/M/B. Your peak (reads + writes) is the load phase 5 and the failure drill use, kept within 2× of the reference."
    >
      <dl className="space-y-1 rounded-md bg-zinc-800/60 px-2.5 py-2 text-[11px]">
        {[
          ["Users", problem.requirements.users],
          ["Daily users", h.dailyActiveUsers],
          ["Read:write", h.readWriteRatio],
          ["Per item", h.storagePerItem],
          ["Peak vs average", h.peakMultiplier],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-24 shrink-0 text-zinc-400">{k}</dt>
            <dd className="text-zinc-200">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-2" data-testid="estimation-form">
        {ESTIMATE_FIELDS.map((f) => (
          <EstimateInput key={f.field} {...f} />
        ))}
      </div>
      <p className="text-[11px] text-zinc-400">
        Load for your design: <span className="font-mono text-cyan-300">{formatRps(peak)} rps</span>
      </p>
    </Section>
  );
}

/* ---------- phase 3 ---------- */

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function ApiForm() {
  const apis = useInterviewStore((s) => s.answers.apis);
  const { addApi, updateApi, removeApi } = useInterviewStore.getState();
  return (
    <Section
      title="Your endpoints"
      hint="List the core endpoints (method + path). Path parameters can be {id} or :id; /api and /v1 prefixes are ignored."
    >
      <ul className="space-y-1.5" data-testid="api-form">
        {apis.map((a, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select
              aria-label={`Method of endpoint ${i + 1}`}
              value={a.method}
              onChange={(e) => updateApi(i, { method: e.target.value as HttpMethod })}
              className={`${input} w-20 shrink-0 font-mono`}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              aria-label={`Path of endpoint ${i + 1}`}
              value={a.path}
              placeholder="/urls/{code}"
              onChange={(e) => updateApi(i, { path: e.target.value })}
              className={`${input} font-mono`}
            />
            <RemoveButton label={`Remove endpoint ${i + 1}`} onClick={() => removeApi(i)} />
          </li>
        ))}
      </ul>
      <AddButton label="Add endpoint" onClick={addApi} />
    </Section>
  );
}

/* ---------- phase 4 ---------- */

const STORES: { value: StoreKind; label: string }[] = [
  { value: "sql", label: "SQL" },
  { value: "nosql", label: "NoSQL" },
  { value: "cache", label: "Cache" },
  { value: "search", label: "Search" },
];

function DataModelForm() {
  const entities = useInterviewStore((s) => s.answers.entities);
  const { addEntity, updateEntity, removeEntity } = useInterviewStore.getState();
  return (
    <Section
      title="Your entities"
      hint="Core entities, the store each lives in, and its partition key when it's sharded."
    >
      <ul className="space-y-2" data-testid="datamodel-form">
        {entities.map((e, i) => (
          <li key={i} className="space-y-1 rounded-md bg-zinc-800/50 p-1.5">
            <div className="flex items-center gap-1.5">
              <input
                aria-label={`Entity ${i + 1} name`}
                value={e.name}
                placeholder="Entity (e.g. Url)"
                onChange={(ev) => updateEntity(i, { name: ev.target.value })}
                className={input}
              />
              <select
                aria-label={`Entity ${i + 1} store`}
                value={e.store}
                onChange={(ev) => updateEntity(i, { store: ev.target.value as StoreKind })}
                className={`${input} w-24 shrink-0`}
              >
                {STORES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <RemoveButton label={`Remove entity ${i + 1}`} onClick={() => removeEntity(i)} />
            </div>
            <input
              aria-label={`Entity ${i + 1} partition key`}
              value={e.partitionKey}
              placeholder="Partition key (if sharded)"
              onChange={(ev) => updateEntity(i, { partitionKey: ev.target.value })}
              className={`${input} font-mono`}
            />
          </li>
        ))}
      </ul>
      <AddButton label="Add entity" onClick={addEntity} />
    </Section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1 rounded-md border border-dashed border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-rose-400"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
