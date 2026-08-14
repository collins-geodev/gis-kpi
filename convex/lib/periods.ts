/**
 * Tracking-period helpers. All boundaries are computed in the performance
 * timezone (Africa/Lagos = UTC+1, no DST) and stored as epoch-ms.
 */
import { PERFORMANCE_TIMEZONE, type Frequency, type PeriodGrain } from "./types";

/** Lagos is a fixed UTC+1 offset (no daylight saving). */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;

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

/** Whether an epoch-ms timestamp is a Lagos business day (Mon–Fri). */
export function isLagosBusinessDay(epochMs: number): boolean {
  const local = new Date(epochMs + LAGOS_OFFSET_MS);
  const dow = local.getUTCDay(); // 0 Sun .. 6 Sat
  return dow >= 1 && dow <= 5;
}
