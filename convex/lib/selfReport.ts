/**
 * Human-readable summaries of what an employee self-reported during Activity
 * Capture — the raw inputs BEFORE the scoring engine touches them. Used by
 * the review queue so an approver sees at a glance what was claimed. Pure.
 */
import { aggregateActivityInputs, type ActivityInputLike } from "./measure";
import type { Direction, MeasurementMode } from "./types";

const n = (x: number | undefined) =>
  x === undefined ? "—" : Number.isInteger(x) ? String(x) : x.toFixed(2);

/** One-line, mode-aware roll-up of a period's raw self-reported inputs. */
export function describeSelfReport(
  mode: MeasurementMode,
  direction: Direction,
  target: number,
  activities: readonly ActivityInputLike[],
): string {
  if (activities.length === 0) return "nothing reported";
  const input = aggregateActivityInputs(mode, direction, target, activities);
  switch (input.mode) {
    case "ratio":
      return `${n(input.numerator)} of ${n(input.denominator)} reported`;
    case "count":
      return direction === "lowerIsBetter"
        ? `${n(input.actual)} recorded (budget ${n(target)})`
        : `${n(input.actual)} recorded (target ${n(target)})`;
    case "durationSla":
      return `${n(input.withinThreshold)} of ${n(input.eligible)} within SLA`;
    case "milestone":
      return `${n(input.completed)} of ${n(input.planned)} milestones`;
    case "reduction":
      return `baseline ${n(input.baseline)} → now ${n(input.current)}`;
    case "binary":
      return input.pass ? "reported as achieved" : "reported as not achieved";
    case "rubric":
      return `self-scored ${n(input.score)} / ${n(input.maxScore)}`;
    case "composite": {
      // Raw parts, not the engine's blended attainment.
      const num = activities.reduce((s, a) => s + (a.numerator ?? 0), 0);
      const den = activities.reduce((s, a) => s + (a.denominator ?? 0), 0);
      const downtime = activities.reduce((s, a) => s + (a.quantity ?? 0), 0);
      return `${n(num)} of ${n(den)} checks · ${n(downtime)} downtime incident(s)`;
    }
  }
}

/** Compact raw values of ONE captured activity, mode-aware. */
export function describeActivityInputs(
  mode: MeasurementMode,
  a: ActivityInputLike,
): string {
  switch (mode) {
    case "ratio":
      return `${n(a.numerator)} / ${n(a.denominator)}`;
    case "count":
      return n(a.quantity ?? a.numerator);
    case "durationSla":
      return `${n(a.withinThreshold)} of ${n(a.eligible ?? a.denominator)} in SLA`;
    case "milestone":
      return `${n(a.completed)} / ${n(a.planned)}`;
    case "reduction":
      return `baseline ${n(a.baseline)} → ${n(a.currentValue)}`;
    case "binary":
      return a.pass ? "pass" : "not passed";
    case "rubric":
      return `${n(a.score)} / ${n(a.maxScore)}`;
    case "composite":
      return `${n(a.numerator)} / ${n(a.denominator)} checks · ${n(a.quantity ?? 0)} downtime`;
  }
}
