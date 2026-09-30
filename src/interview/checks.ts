/**
 * Checkable interview phases (Spec 09): what the candidate answered in
 * phases 1–4 against the problem's reference, and the process score (time
 * per phase, estimation accuracy, requirements coverage, drill reaction).
 * Pure: the store holds the answers, the report renders these results.
 * Free text is kept for the report but never graded.
 */
import type { DataModelEntity, ProblemInterviewData, ReferenceAPI } from "@/data/interviewData";
import type { Problem } from "@/types/problem";

/** An estimate counts when it's within this factor of the reference (either way). */
export const ESTIMATE_TOLERANCE = 2;

/* ---------- phase 1: requirements ---------- */

export interface RequirementsCheck {
  /** Checked critical + important requirements over all of them, 0–1. */
  coverage: number;
  covered: number;
  total: number;
  /** Critical/important requirements not checked. */
  missed: { id: string; text: string; importance: "critical" | "important" }[];
}

export function checkRequirements(
  checkedIds: readonly string[],
  data: Pick<ProblemInterviewData, "requirements">,
): RequirementsCheck {
  const checked = new Set(checkedIds);
  const key = data.requirements.filter((r) => r.importance !== "nice-to-have");
  const missed = key
    .filter((r) => !checked.has(r.id))
    .map((r) => ({
      id: r.id,
      text: r.text,
      importance: r.importance as "critical" | "important",
    }));
  const covered = key.length - missed.length;
  return {
    coverage: key.length > 0 ? covered / key.length : 1,
    covered,
    total: key.length,
    missed,
  };
}

/* ---------- phase 2: estimation ---------- */

export interface Estimates {
  dau?: number;
  readsPerSec?: number;
  writesPerSec?: number;
  storageGB?: number;
}

export type EstimateField = keyof Estimates;

export interface EstimateCheck {
  field: EstimateField;
  label: string;
  yours?: number;
  reference: number;
  /** yours / reference (undefined when not answered). */
  ratio?: number;
  ok: boolean;
}

/**
 * Daily active users from the brief, when it states them as DAU ("100M DAU",
 * "200M+ active users, ~5M DAU"). MAU, registered users or queries per day
 * are a different quantity: undefined (not graded).
 */
export function parseDau(users: string): number | undefined {
  const m = /([\d.]+)\s*([KMB])\+?\s*DAU/i.exec(users);
  if (!m) return undefined;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"];
  const v = Number(m[1]) * scale;
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

const within = (yours: number | undefined, reference: number) =>
  yours !== undefined &&
  yours > 0 &&
  yours <= reference * ESTIMATE_TOLERANCE &&
  yours >= reference / ESTIMATE_TOLERANCE;

export function checkEstimates(
  est: Estimates,
  problem: Pick<Problem, "requirements">,
): EstimateCheck[] {
  const r = problem.requirements;
  const rows: { field: EstimateField; label: string; reference: number | undefined }[] = [
    { field: "dau", label: "Daily active users", reference: parseDau(r.users) },
    { field: "readsPerSec", label: "Reads/sec (peak)", reference: r.readsPerSec },
    { field: "writesPerSec", label: "Writes/sec (peak)", reference: r.writesPerSec },
    { field: "storageGB", label: "Storage (GB)", reference: r.storageGB },
  ];
  return rows
    .filter((row) => row.reference !== undefined && row.reference > 0)
    .map(({ field, label, reference }) => {
      const yours = est[field];
      const ref = reference!;
      return {
        field,
        label,
        reference: ref,
        ...(yours !== undefined ? { yours, ratio: yours / ref } : {}),
        ok: within(yours, ref),
      };
    });
}

/**
 * Load for phase 5, the drill and the measured score: the candidate's
 * estimated peak (reads + writes), clamped to ±ESTIMATE_TOLERANCE× the
 * reference so a too-low estimate can't make the phase easy. Without an
 * estimate, the reference peak.
 */
export function effectivePeak(est: Estimates, problem: Pick<Problem, "requirements">): number {
  const ref = problem.requirements.readsPerSec + problem.requirements.writesPerSec;
  const yours = (est.readsPerSec ?? 0) + (est.writesPerSec ?? 0);
  if (!(yours > 0)) return ref;
  return Math.min(ref * ESTIMATE_TOLERANCE, Math.max(ref / ESTIMATE_TOLERANCE, yours));
}

/* ---------- phase 3: API design ---------- */

export type HttpMethod = ReferenceAPI["method"];

export interface ApiDraft {
  method: HttpMethod;
  path: string;
}

export interface ApiCheck {
  matched: ReferenceAPI[];
  /** Right path, different verb. */
  wrongVerb: { reference: ReferenceAPI; yours: HttpMethod }[];
  missed: ReferenceAPI[];
  /** Matched over reference endpoints, 0–1. */
  coverage: number;
}

/**
 * Comparable path: lowercase, no query string or trailing slash, no /api or
 * /vN prefix, and every parameter segment ({id}, :id, <id>) as "*".
 */
export function normalizePath(path: string): string {
  const segments = path
    .trim()
    .toLowerCase()
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((s) => (/^(\{.*\}|:.+|<.*>)$/.test(s) ? "*" : s));
  while (segments[0] === "api" || /^v\d+$/.test(segments[0] ?? "")) segments.shift();
  return "/" + segments.join("/");
}

export function checkApis(
  drafts: readonly ApiDraft[],
  reference: readonly ReferenceAPI[],
): ApiCheck {
  const mine = drafts
    .filter((d) => d.path.trim() !== "")
    .map((d) => ({ method: d.method, path: normalizePath(d.path) }));
  const matched: ReferenceAPI[] = [];
  const wrongVerb: ApiCheck["wrongVerb"] = [];
  const missed: ReferenceAPI[] = [];
  // Exact matches first; then each leftover endpoint of the candidate explains
  // at most one reference endpoint on the same path as a wrong verb.
  const used = new Set<number>();
  const refs = reference.map((ref) => ({ ref, path: normalizePath(ref.path) }));
  const exact = refs.map(({ ref, path }) => {
    const i = mine.findIndex((m) => m.path === path && m.method === ref.method);
    if (i >= 0) used.add(i);
    return i >= 0;
  });
  refs.forEach(({ ref, path }, r) => {
    if (exact[r]) return void matched.push(ref);
    const i = mine.findIndex((m, j) => !used.has(j) && m.path === path);
    if (i < 0) return void missed.push(ref);
    used.add(i);
    wrongVerb.push({ reference: ref, yours: mine[i].method });
  });
  return {
    matched,
    wrongVerb,
    missed,
    coverage: reference.length > 0 ? matched.length / reference.length : 1,
  };
}

/* ---------- phase 4: data model ---------- */

export type StoreKind = DataModelEntity["type"];

export interface EntityDraft {
  name: string;
  store: StoreKind;
  partitionKey: string;
}

export interface EntityCheck {
  reference: DataModelEntity;
  /** The candidate's entity with the same name, if any. */
  yours?: EntityDraft;
  storeOk: boolean;
  /** The reference partitions it and the candidate named a key (not graded otherwise). */
  partitionOk: boolean;
}

/** "Short URLs" ~ "short_url" ~ "ShortUrl". */
export function normalizeEntity(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(ies)$/, "y")
    .replace(/s$/, "");
}

export function checkDataModel(
  drafts: readonly EntityDraft[],
  reference: readonly DataModelEntity[],
): { entities: EntityCheck[]; score: number } {
  const byName = new Map(
    drafts.filter((d) => d.name.trim() !== "").map((d) => [normalizeEntity(d.name), d]),
  );
  const entities = reference.map((ref) => {
    const yours = byName.get(normalizeEntity(ref.name));
    return {
      reference: ref,
      ...(yours ? { yours } : {}),
      storeOk: yours?.store === ref.type,
      partitionOk: !ref.partitionKey || (yours?.partitionKey.trim() ?? "") !== "",
    };
  });
  // Per entity: named (1/3), right store (1/3), partition key where needed (1/3).
  const points = entities.reduce(
    (s, e) => s + (e.yours ? 1 : 0) + (e.storeOk ? 1 : 0) + (e.yours && e.partitionOk ? 1 : 0),
    0,
  );
  return { entities, score: entities.length > 0 ? points / (3 * entities.length) : 1 };
}

/* ---------- process score ---------- */

export interface ProcessInput {
  /** Seconds spent per phase, in phase order. */
  phaseSeconds: readonly number[];
  /** Target minutes per phase. */
  targetMinutes: readonly number[];
  estimates: EstimateCheck[];
  requirements: RequirementsCheck;
  /** Seconds from each drill fault to the candidate's first edit (undefined = never acted). */
  drillReactions?: (number | undefined)[];
}

export interface ProcessItem {
  label: string;
  /** 0–1; undefined = not applicable (not counted). */
  score?: number;
  detail: string;
}

/** Reacting within this many simulated seconds is full marks; at DRILL_SLOW_REACTION, none. */
const DRILL_FAST_REACTION = 30;
const DRILL_SLOW_REACTION = 120;

/**
 * Separate from the 100-point design score: how the interview was run.
 * Each item is 0–1; the total is their mean × 100 (applicable items only).
 */
export function processScore(input: ProcessInput): { items: ProcessItem[]; total: number } {
  const items: ProcessItem[] = [];

  // Time: per phase, full within target, linear to 0 at twice the target.
  const perPhase = input.targetMinutes.map((m, i) => {
    const target = m * 60;
    const spent = input.phaseSeconds[i] ?? 0;
    return target > 0 ? Math.max(0, Math.min(1, 2 - spent / target)) : 1;
  });
  const over = input.targetMinutes.filter((m, i) => (input.phaseSeconds[i] ?? 0) > m * 60).length;
  items.push({
    label: "Time management",
    score: perPhase.reduce((a, b) => a + b, 0) / Math.max(1, perPhase.length),
    detail:
      over === 0
        ? "Every phase finished within its target time."
        : `${over} phase${over > 1 ? "s" : ""} ran over the target time.`,
  });

  const est = input.estimates;
  const answered = est.filter((e) => e.yours !== undefined);
  items.push({
    label: "Estimation accuracy",
    score: est.length > 0 ? est.filter((e) => e.ok).length / est.length : undefined,
    detail:
      answered.length === 0
        ? "No estimates entered."
        : `${est.filter((e) => e.ok).length} of ${est.length} estimates within ${ESTIMATE_TOLERANCE}× of the reference.`,
  });

  items.push({
    label: "Requirements coverage",
    score: input.requirements.coverage,
    detail: `${input.requirements.covered} of ${input.requirements.total} critical/important requirements clarified.`,
  });

  const reactions = input.drillReactions;
  if (reactions && reactions.length > 0) {
    const per = reactions.map((r) =>
      r === undefined
        ? 0
        : Math.max(
            0,
            Math.min(1, (DRILL_SLOW_REACTION - r) / (DRILL_SLOW_REACTION - DRILL_FAST_REACTION)),
          ),
    );
    const acted = reactions.filter((r) => r !== undefined) as number[];
    items.push({
      label: "Drill reaction time",
      score: per.reduce((a, b) => a + b, 0) / per.length,
      detail:
        acted.length === 0
          ? "No change to the design during the drill's faults."
          : `Acted in ${acted.length} of ${reactions.length} faults, after ${Math.round(acted.reduce((a, b) => a + b, 0) / acted.length)} s on average.`,
    });
  } else {
    items.push({ label: "Drill reaction time", detail: "The failure drill wasn't run." });
  }

  const scored = items.filter((i) => i.score !== undefined) as (ProcessItem & { score: number })[];
  const total =
    scored.length > 0 ? (scored.reduce((a, i) => a + i.score, 0) / scored.length) * 100 : 0;
  return { items, total: Math.round(total) };
}
