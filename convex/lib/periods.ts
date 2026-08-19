/**
 * Tracking-period helpers. All boundaries are computed in the performance
 * timezone (Africa/Lagos = UTC+1, no DST) and stored as epoch-ms.
 */
import { PERFORMANCE_TIMEZONE, type Frequency, type PeriodGrain } from "./types";

/** Lagos is a fixed UTC+1 offset (no daylight saving). */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** 1 June 2026, 00:00 Africa/Lagos — the agreed KPI capture go-live moment. */
export const CAPTURE_START_2026 = Date.UTC(2026, 5, 1) - LAGOS_OFFSET_MS;

export { PERFORMANCE_TIMEZONE };

/** Local-Lagos wall-clock time -> epoch ms. */
function lagos(y: number, monthIndex: number, day: number, hour = 0): number {
  return Date.UTC(y, monthIndex, day, hour) - LAGOS_OFFSET_MS;
}

export function monthKey(year: number, monthIndex0: number): string {
  return `${year}-M${String(monthIndex0 + 1).padStart(2, "0")}`;
}
export function quarterKey(year: number, quarter1: number): string {
  return `${year}-Q${quarter1}`;
}
export function yearKey(year: number): string {
  return `${year}`;
}
export function weekKey(year: number, week1: number): string {
  return `${year}-W${String(week1).padStart(2, "0")}`;
}
export function dayKey(year: number, monthIndex0: number, day: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface SeedPeriod {
  grain: PeriodGrain;
  periodKey: string;
  label: string;
  startAt: number;
  endAt: number;
  dueAt: number;
}

/** Generate month/quarter/year tracking periods for a performance year. */
export function generateYearPeriods(year: number): SeedPeriod[] {
  const periods: SeedPeriod[] = [];

  // Year.
  periods.push({
    grain: "year",
    periodKey: yearKey(year),
    label: `${year}`,
    startAt: lagos(year, 0, 1),
    endAt: lagos(year + 1, 0, 1) - 1,
    dueAt: lagos(year + 1, 0, 15),
  });

  // Quarters.
  for (let q = 0; q < 4; q++) {
    const startMonth = q * 3;
    periods.push({
      grain: "quarter",
      periodKey: quarterKey(year, q + 1),
      label: `Q${q + 1} ${year}`,
      startAt: lagos(year, startMonth, 1),
      endAt: lagos(year, startMonth + 3, 1) - 1,
      dueAt: lagos(year, startMonth + 3, 10),
    });
  }

  // Months.
  for (let m = 0; m < 12; m++) {
    periods.push({
      grain: "month",
      periodKey: monthKey(year, m),
      label: `${MONTHS[m]} ${year}`,
      startAt: lagos(year, m, 1),
      endAt: lagos(year, m + 1, 1) - 1,
      dueAt: lagos(year, m + 1, 5),
    });
  }

  return periods;
}

/** The natural reporting grain for a KPI cadence. */
export function grainForFrequency(freq: Frequency): PeriodGrain {
  switch (freq) {
    case "Daily":
      return "day";
    case "Weekly":
      return "week";
    case "Monthly":
      return "month";
    case "Quarterly":
      return "quarter";
    case "Annually":
      return "year";
  }
}

/**
 * The grain activities are CAPTURED and MEASURED at. Daily/weekly work rolls
 * up into months (ratio-style modes are scale-free, and day-level buckets are
 * impractical to review); quarterly and annual KPIs accumulate in their native
 * buckets so entries add up across the quarter/year against the full target.
 */
export function captureGrainForFrequency(freq: Frequency): PeriodGrain {
  switch (freq) {
    case "Daily":
    case "Weekly":
    case "Monthly":
      return "month";
    case "Quarterly":
      return "quarter";
    case "Annually":
      return "year";
  }
}

/**
 * Map a month/quarter/year periodKey to the key of the KPI-cadence bucket that
 * CONTAINS it (e.g. Quarterly + "2026-M08" → "2026-Q3"; Annually → "2026").
 * Keys that cannot be narrowed (e.g. month grain asked of a quarter key) are
 * returned unchanged.
 */
export function cadencePeriodKey(freq: Frequency, periodKey: string): string {
  const grain = captureGrainForFrequency(freq);
  const m = /^(\d{4})-M(\d{2})$/.exec(periodKey);
  const q = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  const y = /^(\d{4})$/.exec(periodKey);
  const year = Number((m ?? q ?? y)?.[1] ?? NaN);
  if (!Number.isFinite(year)) return periodKey;
  if (grain === "year") return yearKey(year);
  if (grain === "quarter") {
    if (q) return periodKey;
    if (m) return quarterKey(year, Math.floor((Number(m[2]) - 1) / 3) + 1);
    return periodKey;
  }
  return periodKey;
}

// --- Day/week grouping of activity timestamps (for incremental breakdowns) --

/** Lagos calendar-day key ("2026-08-18") for an epoch instant. */
export function lagosDayKeyOf(epochMs: number): string {
  const d = new Date(epochMs + LAGOS_OFFSET_MS);
  return dayKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start (Monday 00:00 Lagos) of the ISO week containing an epoch instant. */
export function lagosWeekStartOf(epochMs: number): number {
  const d = new Date(epochMs + LAGOS_OFFSET_MS);
  const dow = (d.getUTCDay() + 6) % 7; // 0 Mon .. 6 Sun
  return lagos(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}

/** ISO-8601 week key ("2026-W34", Monday-based, Lagos time) for an instant. */
export function lagosWeekKeyOf(epochMs: number): string {
  // ISO week number = week containing the Thursday of this week.
  const thursday = new Date(lagosWeekStartOf(epochMs) + LAGOS_OFFSET_MS);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week =
    Math.floor(
      (Date.UTC(isoYear, thursday.getUTCMonth(), thursday.getUTCDate()) - jan1) /
        (7 * 24 * 60 * 60 * 1000),
    ) + 1;
  return weekKey(isoYear, week);
}

/** Human label for a Lagos ISO week ("Mon 17 – Sun 23 Aug"). */
export function lagosWeekLabelOf(epochMs: number): string {
  const start = new Date(lagosWeekStartOf(epochMs) + LAGOS_OFFSET_MS);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
  return `Mon ${fmt(start)} – Sun ${fmt(end)}`;
}

/** Whether an epoch-ms timestamp is a Lagos business day (Mon–Fri). */
export function isLagosBusinessDay(epochMs: number): boolean {
  const local = new Date(epochMs + LAGOS_OFFSET_MS);
  const dow = local.getUTCDay(); // 0 Sun .. 6 Sat
  return dow >= 1 && dow <= 5;
}
