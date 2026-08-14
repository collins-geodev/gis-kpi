/**
 * Deterministic KPI scoring engine.
 *
 * This is official business logic — never an AI model — and is exhaustively
 * unit-tested (see scoring.test.ts). All attainment values are decimals where
 * 1.0 == 100%. Percentages are stored/consumed as decimals throughout.
 *
 * Pipeline: raw inputs -> attainment -> capped attainment -> weighted
 * contribution -> assigned-weight score (out of the true configured max, 80 for
 * the 2026 baseline) -> optional normalized score (only shown when the org
 * explicitly enables it, always labelled).
 */
import { clamp, round } from "./format";
import {
  DEFAULT_THRESHOLDS,
  statusFromAttainment,
  type ThresholdBand,
} from "./thresholds";
import type { Direction, MeasurementMode, StatusBand } from "./types";

export interface ScoringCaps {
  /** Official attainment cap (decimal). Default 1.0 (100%). */
  officialCap: number;
  /** Optional stretch cap for the stretch view (decimal). Default 1.2 (120%). */
  stretchCap: number;
}

export const DEFAULT_CAPS: ScoringCaps = { officialCap: 1, stretchCap: 1.2 };

/** Bumped whenever the scoring math changes; stored on measurements/snapshots. */
export const CALC_VERSION = "scoring-1.0.0";

export interface MeasurementInput {
  mode: MeasurementMode;
  /** Direction of improvement (stored on the definition, never inferred here). */
  direction?: Direction;
  /** Target (decimal for percentage KPIs, e.g. 0.2, 1; plain number otherwise). */
  target: number;
  // ratio
  numerator?: number;
  denominator?: number;
  // count / binary-as-number
  actual?: number;
  // reduction
  baseline?: number;
  current?: number;
  // durationSla
  withinThreshold?: number;
  eligible?: number;
  // milestone
  completed?: number;
  planned?: number;
  // binary
  pass?: boolean;
  // rubric
  score?: number;
  maxScore?: number;
  // composite
  compositeParts?: { label: string; attainment: number; weight: number }[];
  /** Optional gate (e.g. zero-downtime): when failed, composite is capped. */
  gate?: { passed: boolean; failCap?: number };
}

export interface AttainmentResult {
  mode: MeasurementMode;
  hasData: boolean;
  /** Measured value in the KPI's natural unit (ratio decimal, count, etc.). */
  rawActual: number | null;
  target: number;
  /** Attainment decimal before caps (1.0 = 100%). */
  attainment: number | null;
  /** Attainment clamped to [0, officialCap]. Drives the official score. */
  cappedAttainment: number | null;
  /** Attainment clamped to [0, stretchCap] for the stretch view. */
  stretchAttainment: number | null;
  status: StatusBand;
  note: string;
}

function req(value: number | undefined, name: string, mode: string): number {
  if (value === undefined || value === null || Number.isNaN(value)) {
    throw new Error(`Measurement mode '${mode}' requires numeric '${name}'`);
  }
  return value;
}

/** Attainment for higher/lower-is-better simple value-vs-target modes. */
function directionalAttainment(
  raw: number,
  target: number,
  direction: Direction,
): number | null {
  if (direction === "lowerIsBetter") {
    // Lower actual is better: full attainment at/below target; degrades above.
    if (raw <= 0) return Number.POSITIVE_INFINITY; // perfect (clamped later)
    if (target <= 0) return null;
    return target / raw;
  }
  if (target === 0) return null;
  return raw / target;
}

/**
 * Compute attainment from raw inputs. Denominator/baseline-zero produce a
 * "no data" result rather than throwing or dividing by zero.
 */
export function computeAttainment(
  input: MeasurementInput,
  caps: ScoringCaps = DEFAULT_CAPS,
  thresholds: readonly ThresholdBand[] = DEFAULT_THRESHOLDS,
): AttainmentResult {
  const { mode, target } = input;
  const direction: Direction = input.direction ?? "higherIsBetter";
  let rawActual: number | null = null;
  let attainment: number | null = null;
  let note = "";

  switch (mode) {
    case "ratio": {
      const n = req(input.numerator, "numerator", mode);
      const d = req(input.denominator, "denominator", mode);
      if (d === 0) {
        note = "Denominator is zero — no data.";
        break;
      }
      rawActual = n / d;
      attainment = directionalAttainment(rawActual, target, direction);
      break;
    }
    case "count": {
      const a = req(input.actual, "actual", mode);
      rawActual = a;
      attainment = directionalAttainment(a, target, direction);
      break;
    }
    case "reduction": {
      const baseline = req(input.baseline, "baseline", mode);
      const current = req(input.current, "current", mode);
      if (baseline === 0) {
        note = "Baseline is zero — reduction undefined, no data.";
        break;
      }
      // Achieved reduction fraction vs the target reduction fraction.
      rawActual = (baseline - current) / baseline;
      attainment = target === 0 ? null : rawActual / target;
      break;
    }
    case "durationSla": {
      const within = req(input.withinThreshold, "withinThreshold", mode);
      const eligible = req(input.eligible, "eligible", mode);
      if (eligible === 0) {
        note = "No eligible items — no data.";
        break;
      }
      rawActual = within / eligible;
      attainment = target === 0 ? null : rawActual / target;
      break;
    }
    case "milestone": {
      const completed = req(input.completed, "completed", mode);
      const planned = req(input.planned, "planned", mode);
      if (planned === 0) {
        note = "No planned milestones — no data.";
        break;
      }
      rawActual = completed / planned;
      attainment = target === 0 ? null : rawActual / target;
      break;
    }
    case "binary": {
      if (input.pass === undefined) {
        throw new Error("Measurement mode 'binary' requires 'pass'");
      }
      rawActual = input.pass ? 1 : 0;
      attainment = target === 0 ? rawActual : rawActual / target;
      break;
    }
    case "rubric": {
      const score = req(input.score, "score", mode);
      const maxScore = req(input.maxScore, "maxScore", mode);
      if (maxScore === 0) {
        note = "Rubric max is zero — no data.";
        break;
      }
      rawActual = score / maxScore;
      attainment = target === 0 ? rawActual : rawActual / target;
      break;
    }
    case "composite": {
      const parts = input.compositeParts ?? [];
      const totalW = parts.reduce((s, p) => s + p.weight, 0);
      if (parts.length === 0 || totalW === 0) {
        note = "No composite sub-measures — no data.";
        break;
      }
      let att = parts.reduce((s, p) => s + p.attainment * p.weight, 0) / totalW;
      if (input.gate && !input.gate.passed) {
        const failCap = input.gate.failCap ?? 0.5;
        att = Math.min(att, failCap);
        note = `Composite gate failed — capped at ${failCap}.`;
      }
      rawActual = att;
      attainment = att;
      break;
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = mode;
      throw new Error(`Unsupported measurement mode: ${String(_never)}`);
    }
  }

  // Infinity (perfect lower-is-better, e.g. zero errors) still counts as data.
  const hasData = attainment !== null;

  const cappedAttainment =
    attainment === null ? null : round(clamp(attainment, 0, caps.officialCap), 6);
  const stretchAttainment =
    attainment === null ? null : round(clamp(attainment, 0, caps.stretchCap), 6);
  const status = statusFromAttainment(cappedAttainment, thresholds);

  return {
    mode,
    hasData,
    rawActual: rawActual === null ? null : round(rawActual, 6),
    target,
    attainment:
      attainment === null
        ? null
        : Number.isFinite(attainment)
          ? round(attainment, 6)
          : attainment, // keep Infinity to signal uncapped perfection
    cappedAttainment,
    stretchAttainment,
    status,
    note,
  };
}

/** Weighted contribution = capped attainment × weight points (0 when no data). */
export function weightedContribution(
  cappedAttainment: number | null,
  weight: number,
): number {
  if (cappedAttainment === null) return 0;
  return round(cappedAttainment * weight, 4);
}

export interface ScorecardItem {
  weight: number;
  cappedAttainment: number | null;
  /** Whether the required evidence for this KPI is present & approved. */
  evidenceComplete?: boolean;
  /** Whether cadence submissions for the period were on time. */
  cadenceCompliant?: boolean;
}

export interface ScorecardResult {
  /** True configured weight maximum (80 for the 2026 baseline). */
  configuredWeight: number;
  /** Sum of weights for KPIs that have data. */
  dataWeight: number;
  /** Sum of weighted contributions (out of configuredWeight). */
  assignedWeightScore: number;
  /** assignedWeightScore / configuredWeight × 100 (label as “/ 80 configured”). */
  assignedWeightPct: number;
  /**
   * Normalized to 100 = assignedWeightScore / configuredWeight × 100.
   * Only surface when normalization is explicitly enabled; always labelled.
   */
  normalizedScore: number;
  /** Score among measured KPIs only = assignedWeightScore / dataWeight × 100. */
  scoreOnMeasured: number | null;
  evidenceCompletionPct: number;
  cadenceCompliancePct: number;
  itemsWithData: number;
  itemCount: number;
}

/**
 * Aggregate KPI items into a scorecard. Retains the true configured maximum
 * (never rebases 80 to 100 silently).
 */
export function scoreScorecard(items: readonly ScorecardItem[]): ScorecardResult {
  const configuredWeight = items.reduce((s, it) => s + it.weight, 0);
  let dataWeight = 0;
  let assignedWeightScore = 0;
  let itemsWithData = 0;
  let evidenceComplete = 0;
  let cadenceComplete = 0;

  for (const it of items) {
    if (it.cappedAttainment !== null) {
      dataWeight += it.weight;
      assignedWeightScore += weightedContribution(it.cappedAttainment, it.weight);
      itemsWithData += 1;
    }
    if (it.evidenceComplete) evidenceComplete += 1;
    if (it.cadenceCompliant) cadenceComplete += 1;
  }

  assignedWeightScore = round(assignedWeightScore, 4);
  const assignedWeightPct =
    configuredWeight === 0 ? 0 : round((assignedWeightScore / configuredWeight) * 100, 2);

  return {
    configuredWeight,
    dataWeight,
    assignedWeightScore,
    assignedWeightPct,
    normalizedScore: assignedWeightPct, // = score / configured × 100
    scoreOnMeasured:
      dataWeight === 0 ? null : round((assignedWeightScore / dataWeight) * 100, 2),
    evidenceCompletionPct:
      items.length === 0 ? 0 : round((evidenceComplete / items.length) * 100, 2),
    cadenceCompliancePct:
      items.length === 0 ? 0 : round((cadenceComplete / items.length) * 100, 2),
    itemsWithData,
    itemCount: items.length,
  };
}

// --- Period aggregation ----------------------------------------------------

export interface RatioObservation {
  numerator: number;
  denominator: number;
}

/** Aggregate ratio/SLA/milestone observations by summing num & den (never averaging %). */
export function aggregateRatios(
  observations: readonly RatioObservation[],
): RatioObservation {
  return observations.reduce(
    (acc, o) => ({
      numerator: acc.numerator + o.numerator,
      denominator: acc.denominator + o.denominator,
    }),
    { numerator: 0, denominator: 0 },
  );
}

/** Aggregate count observations by summing actuals against a scaled target. */
export function aggregateCounts(
  actuals: readonly number[],
  perPeriodTarget: number,
): { actual: number; target: number } {
  return {
    actual: actuals.reduce((s, a) => s + a, 0),
    target: perPeriodTarget * actuals.length,
  };
}
