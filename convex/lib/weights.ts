import { NON_CORE_WEIGHT_TOTAL } from "./catalogue";
import { FULL_WEIGHT_TOTAL } from "./types";

/**
 * The report's weight note, from the employees actually in scope: a
 * confirmation when every configured total is 100, otherwise who falls short
 * (their scores stay out of their configured maximum — never rebased).
 */
export function weightNote(employees: { name: string; configuredWeight: number }[]): {
  weightsComplete: boolean;
  lowestConfiguredWeight: number;
  weightWarning: string;
} {
  const short = employees.filter((e) => e.configuredWeight < FULL_WEIGHT_TOTAL);
  const lowestConfiguredWeight = Math.min(
    FULL_WEIGHT_TOTAL,
    ...employees.map((e) => e.configuredWeight),
  );
  if (short.length === 0) {
    const n = employees.length;
    return {
      weightsComplete: true,
      lowestConfiguredWeight,
      weightWarning: `${n === 1 ? "The employee's" : `All ${n} employees'`} configured weights total ${FULL_WEIGHT_TOTAL} / ${FULL_WEIGHT_TOTAL} (${FULL_WEIGHT_TOTAL - NON_CORE_WEIGHT_TOTAL} core + ${NON_CORE_WEIGHT_TOTAL} non-core).`,
    };
  }
  const listed = short
    .slice(0, 10)
    .map((e) => `${e.name} (${e.configuredWeight})`)
    .join(", ");
  const more = short.length > 10 ? ` and ${short.length - 10} more` : "";
  return {
    weightsComplete: false,
    lowestConfiguredWeight,
    weightWarning: `${short.length} of ${employees.length} employees' configured weights total below ${FULL_WEIGHT_TOTAL}: ${listed}${more}. Their scores are shown out of their configured maximum, never silently rebased to ${FULL_WEIGHT_TOTAL}.`,
  };
}
