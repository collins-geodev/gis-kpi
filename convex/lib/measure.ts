/**
 * Aggregates the raw inputs from a period's activities into a single
 * MeasurementInput for the deterministic scoring engine. Ratio-type modes sum
 * numerators/denominators (never average percentages); reduction/binary/rubric
 * take the most recent activity in the period. Pure + unit-tested.
 */
import type { MeasurementInput } from "./scoring";
import type { Direction, MeasurementMode } from "./types";

export interface ActivityInputLike {
  activityAt: number;
  quantity?: number;
  numerator?: number;
  denominator?: number;
  baseline?: number;
  currentValue?: number;
  withinThreshold?: number;
  eligible?: number;
  completed?: number;
  planned?: number;
  pass?: boolean;
  score?: number;
  maxScore?: number;
}

const sum = (xs: readonly (number | undefined)[]) =>
  xs.reduce<number>((acc, x) => acc + (x ?? 0), 0);

function latest<T extends ActivityInputLike>(activities: readonly T[]): T | undefined {
  return activities.reduce<T | undefined>(
    (best, a) => (best === undefined || a.activityAt > best.activityAt ? a : best),
    undefined,
  );
}

export function aggregateActivityInputs(
  mode: MeasurementMode,
  direction: Direction,
  target: number,
  activities: readonly ActivityInputLike[],
): MeasurementInput {
  switch (mode) {
    case "ratio":
      return {
        mode,
        direction,
        target,
        numerator: sum(activities.map((a) => a.numerator)),
        denominator: sum(activities.map((a) => a.denominator)),
      };
    case "count":
      return {
        mode,
        direction,
        target,
        actual: sum(activities.map((a) => a.quantity ?? a.numerator)),
      };
    case "durationSla":
      return {
        mode,
        direction,
        target,
        withinThreshold: sum(activities.map((a) => a.withinThreshold)),
        eligible: sum(activities.map((a) => a.eligible ?? a.denominator)),
      };
    case "milestone":
      return {
        mode,
        direction,
        target,
        completed: sum(activities.map((a) => a.completed)),
        planned: sum(activities.map((a) => a.planned)),
      };
    case "reduction": {
      const l = latest(activities);
      return {
        mode,
        direction,
        target,
        baseline: l?.baseline ?? 0,
        current: l?.currentValue ?? 0,
      };
    }
    case "binary": {
      const l = latest(activities);
      return { mode, target, pass: l?.pass ?? false };
    }
    case "rubric": {
      const l = latest(activities);
      return { mode, target, score: l?.score ?? 0, maxScore: l?.maxScore ?? 0 };
    }
    case "composite": {
      // Health-check completion ratio + a zero-downtime gate (downtime incidents
      // carried in `quantity`). The composite rule is admin-approved per KPI.
      const num = sum(activities.map((a) => a.numerator));
      const den = sum(activities.map((a) => a.denominator));
      const ratioAttainment = den === 0 ? 0 : num / den / (target || 1);
      const downtime = sum(activities.map((a) => a.quantity));
      return {
        mode,
        target,
        compositeParts: [
          { label: "health_checks", attainment: ratioAttainment, weight: 1 },
        ],
        gate: { passed: downtime === 0, failCap: 0.5 },
      };
    }
    default: {
      const _never: never = mode;
      throw new Error(`Unsupported measurement mode: ${String(_never)}`);
    }
  }
}
