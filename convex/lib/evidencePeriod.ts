/**
 * Which KPI period an evidence item supports.
 *
 * Evidence completeness is decided PER PERIOD: approved proof for July never
 * completes August. An item's period is resolved in this order:
 *
 *  1. its explicit `periodKey` tag (set by the capture form / upload picker);
 *  2. otherwise the Lagos month of its `activityAt` work-date;
 *  3. otherwise (legacy, untagged uploads) the Lagos month it was uploaded —
 *     the same convention the Evidence Centre uses to group untagged files.
 *
 * The resolved key is then mapped into the KPI's cadence bucket, so a file
 * tagged "2026-M08" supports a quarterly KPI's "2026-Q3" measurement.
 */
import { LAGOS_OFFSET_MS, cadencePeriodKey, monthKey } from "./periods";
import type { Frequency } from "./types";

export interface EvidencePeriodFields {
  periodKey?: string | null;
  activityAt?: number | null;
  uploadedAt: number;
}

export type EvidencePeriodSource = "tagged" | "activity_date" | "upload_date";

/** Lagos month key ("2026-M09") for an epoch instant. */
export function lagosMonthKeyOf(epochMs: number): string {
  const d = new Date(epochMs + LAGOS_OFFSET_MS);
  return monthKey(d.getUTCFullYear(), d.getUTCMonth());
}

/** The capture period an evidence item supports, and where that came from. */
export function evidencePeriodOf(e: EvidencePeriodFields): {
  periodKey: string;
  source: EvidencePeriodSource;
} {
  if (e.periodKey) return { periodKey: e.periodKey, source: "tagged" };
  if (typeof e.activityAt === "number") {
    return { periodKey: lagosMonthKeyOf(e.activityAt), source: "activity_date" };
  }
  return { periodKey: lagosMonthKeyOf(e.uploadedAt), source: "upload_date" };
}

/** The KPI-cadence bucket an evidence item counts toward. */
export function evidenceCadenceKey(freq: Frequency, e: EvidencePeriodFields): string {
  return cadencePeriodKey(freq, evidencePeriodOf(e).periodKey);
}

/** Whether an evidence item supports the given (cadence) period of a KPI. */
export function evidenceSupportsPeriod(
  freq: Frequency,
  e: EvidencePeriodFields,
  periodKey: string,
): boolean {
  return evidenceCadenceKey(freq, e) === cadencePeriodKey(freq, periodKey);
}
