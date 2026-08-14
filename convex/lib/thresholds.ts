/**
 * Status thresholds mapping a capped attainment (decimal, 1 = 100%) to a status
 * band. These defaults are admin-editable (persisted per performance year); the
 * engine always reads an ordered, descending list.
 */
import type { StatusBand } from "./types";

export interface ThresholdBand {
  band: StatusBand;
  /** Inclusive lower bound on capped attainment (decimal). */
  minAttainment: number;
}

/** Default bands — must be sorted by minAttainment descending. */
export const DEFAULT_THRESHOLDS: readonly ThresholdBand[] = [
  { band: "on_target", minAttainment: 1.0 },
  { band: "watch", minAttainment: 0.9 },
  { band: "at_risk", minAttainment: 0.75 },
  { band: "critical", minAttainment: 0 },
];

/** Resolve a status band from a (capped) attainment value. */
export function statusFromAttainment(
  attainment: number | null | undefined,
  thresholds: readonly ThresholdBand[] = DEFAULT_THRESHOLDS,
): StatusBand {
  if (attainment === null || attainment === undefined || Number.isNaN(attainment)) {
    return "no_data";
  }
  for (const t of thresholds) {
    if (attainment >= t.minAttainment) return t.band;
  }
  return "critical";
}

/** Validate a threshold table is well-formed (descending, covers 0). */
export function assertValidThresholds(thresholds: readonly ThresholdBand[]): void {
  if (thresholds.length === 0) throw new Error("thresholds must be non-empty");
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i]!.minAttainment > thresholds[i - 1]!.minAttainment) {
      throw new Error("thresholds must be sorted by minAttainment descending");
    }
  }
  if (thresholds[thresholds.length - 1]!.minAttainment > 0) {
    throw new Error("thresholds must include a band with minAttainment <= 0");
  }
}
