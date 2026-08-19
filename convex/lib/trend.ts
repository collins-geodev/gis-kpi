/**
 * Score-trend derivation from frozen score snapshots. Pure + unit-tested —
 * shared by the team Analytics query and the Individual page (client-side).
 *
 * Rules:
 *  - Only the LATEST snapshot per (employee, period) counts (re-approvals
 *    supersede; history is never averaged twice).
 *  - A trend line uses ONE grain: months when any monthly snapshot exists,
 *    otherwise quarters (mixing grains on one axis would be misleading).
 *  - Team points average the employees approved for that period and carry the
 *    sample size, so a 1-person month is never read like a 15-person month.
 */

export interface TrendSnapshot {
  /** Employee id (or any stable per-person key); "" for single-person use. */
  scopeRef: string;
  periodKey: string;
  normalizedScore: number; // 0–100
  evidenceCompletionPct: number; // 0–100
  createdAt: number;
}

export interface TrendPoint {
  periodKey: string;
  label: string;
  /** Average normalized score (0–100) across employees approved this period. */
  score: number;
  /** Average evidence completeness (0–100). */
  evidence: number;
  /** Distinct employees contributing to this point. */
  employees: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function periodLabel(periodKey: string): string {
  const m = /^(\d{4})-M(\d{2})$/.exec(periodKey);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const q = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  if (q) return `Q${q[2]} ${q[1]}`;
  return periodKey;
}

const isMonth = (k: string) => /^\d{4}-M\d{2}$/.test(k);
const isQuarter = (k: string) => /^\d{4}-Q[1-4]$/.test(k);

/** Derive an ordered trend from raw snapshot rows. */
export function buildScoreTrend(rows: readonly TrendSnapshot[]): TrendPoint[] {
  // Latest snapshot per (employee, period).
  const latest = new Map<string, TrendSnapshot>();
  for (const r of rows) {
    const key = `${r.scopeRef}::${r.periodKey}`;
    const prev = latest.get(key);
    if (!prev || r.createdAt > prev.createdAt) latest.set(key, r);
  }
  const deduped = Array.from(latest.values());

  // Single grain: prefer months, fall back to quarters.
  const grainFilter = deduped.some((r) => isMonth(r.periodKey)) ? isMonth : isQuarter;
  const inGrain = deduped.filter((r) => grainFilter(r.periodKey));

  // Group by period and average.
  const byPeriod = new Map<string, TrendSnapshot[]>();
  for (const r of inGrain) {
    const list = byPeriod.get(r.periodKey) ?? [];
    list.push(r);
    byPeriod.set(r.periodKey, list);
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return Array.from(byPeriod.entries())
    .map(([periodKey, list]) => ({
      periodKey,
      label: periodLabel(periodKey),
      score: Math.round(avg(list.map((r) => r.normalizedScore)) * 10) / 10,
      evidence: Math.round(avg(list.map((r) => r.evidenceCompletionPct)) * 10) / 10,
      employees: new Set(list.map((r) => r.scopeRef)).size,
    }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}
