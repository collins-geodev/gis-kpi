/**
 * Shared measurement recompute used by activity capture and evidence review.
 * Deterministic engine only — the AI model never computes an official number.
 */
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { aggregateActivityInputs } from "./lib/measure";
import { CALC_VERSION, computeAttainment, weightedContribution } from "./lib/scoring";

const COUNTED_STATES = ["submitted", "verified", "approved"];

/** Recompute the provisional measurement for one (assignment, period). */
export async function recomputeMeasurement(
  ctx: MutationCtx,
  assignment: Doc<"kpiAssignments">,
  periodKey: string,
): Promise<void> {
  const activities = await ctx.db
    .query("activities")
    .withIndex("by_assignment_period", (q) =>
      q.eq("kpiAssignmentId", assignment._id).eq("periodKey", periodKey),
    )
    .take(1000);
  const counted = activities.filter((a) => COUNTED_STATES.includes(a.status));

  const input = aggregateActivityInputs(
    assignment.measurementMode,
    assignment.direction,
    assignment.target,
    counted.map((a) => ({
      activityAt: a.activityAt,
      quantity: a.quantity,
      numerator: a.numerator,
      denominator: a.denominator,
      baseline: a.baseline,
      currentValue: a.currentValue,
      withinThreshold: a.withinThreshold,
      eligible: a.eligible,
      completed: a.completed,
      planned: a.planned,
      pass: a.pass ?? undefined,
      score: a.score,
      maxScore: a.maxScore,
    })),
  );
  const result = computeAttainment(input, {
    officialCap: assignment.scoreCap,
    stretchCap: assignment.stretchCap,
  });
  const weighted = weightedContribution(result.cappedAttainment, assignment.weight);

  // Convex cannot store Infinity/NaN; perfect lower-is-better collapses to the cap.
  const storedAttainment =
    result.attainment === null
      ? null
      : Number.isFinite(result.attainment)
        ? result.attainment
        : (result.cappedAttainment ?? assignment.scoreCap);

  const evidence = await ctx.db
    .query("evidenceFiles")
    .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignment._id))
    .take(500);
  const hasApprovedEvidence = evidence.some((e) => e.reviewStatus === "approved");
  const evidenceComplete = assignment.evidenceRequired ? hasApprovedEvidence : true;

  const period = await ctx.db
    .query("trackingPeriods")
    .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
    .first();
  const cadenceCompliant = period ? Date.now() <= period.dueAt : true;

  const doc = {
    kpiAssignmentId: assignment._id,
    employeeId: assignment.employeeId,
    trackingPeriodId: period?._id,
    periodKey,
    measurementMode: assignment.measurementMode,
    inputs: input,
    rawActual: result.rawActual,
    target: assignment.target,
    attainment: storedAttainment,
    cappedAttainment: result.cappedAttainment,
    weightedContribution: weighted,
    status: result.status,
    hasData: result.hasData,
    evidenceComplete,
    cadenceCompliant,
    isProvisional: true,
    computedAt: Date.now(),
    calcVersion: CALC_VERSION,
  };

  const existing = await ctx.db
    .query("kpiMeasurements")
    .withIndex("by_assignment_period", (q) =>
      q.eq("kpiAssignmentId", assignment._id).eq("periodKey", periodKey),
    )
    .first();
  if (existing) await ctx.db.patch(existing._id, doc);
  else await ctx.db.insert("kpiMeasurements", doc);
}
