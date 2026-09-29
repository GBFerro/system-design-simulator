/** Simulated clock as mm:ss (minutes keep counting past 59). */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 950 → "950", 12 000 → "12k", 1 250 000 → "1.25M". */
export function formatRps(rps: number): string {
  const v = Number.isFinite(rps) ? Math.max(0, rps) : 0;
  const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));
  if (v >= 1e6) return `${trim(v / 1e6, 2)}M`;
  if (v >= 1e4) return `${trim(v / 1e3, 0)}k`;
  if (v >= 1e3) return `${trim(v / 1e3, 1)}k`;
  return trim(v, v < 10 ? 1 : 0);
}

export function formatMs(ms: number): string {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (v >= 60_000) return `${trimFixed(v / 60_000, 1)} min`;
  if (v >= 1000) return `${trimFixed(v / 1000, 1)} s`;
  return `${Math.round(v)} ms`;
}

function trimFixed(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

export function formatPercent(fraction: number): string {
  const v = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  if (v === 0) return "0%";
  if (v < 0.001) return "<0.1%";
  return `${trimFixed(v * 100, v < 0.1 ? 1 : 0)}%`;
}
