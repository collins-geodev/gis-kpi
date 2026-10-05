/**
 * Shared measurement recompute used by activity capture and evidence review.
 * Deterministic engine only — the AI model never computes an official number.
 */
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { aggregateActivityInputs } from "./lib/measure";
import { evidenceCadenceKey, evidenceSupportsPeriod } from "./lib/evidencePeriod";
import type { Frequency } from "./lib/types";
import { CALC_VERSION, computeAttainment, weightedContribution } from "./lib/scoring";
import { statusFromAttainment } from "./lib/thresholds";

const COUNTED_STATES = ["submitted", "verified", "approved"];

/**
 * Evidence state of ONE (assignment, period). Only live (not deleted) files
 * whose resolved period falls in this cadence bucket count — see
 * lib/evidencePeriod.ts for how untagged files are dated. Approved proof in
 * another period never completes this one; it is reported separately so the
 * reviewer can see why the tick is missing.
 */
export async function periodEvidence(
  ctx: Pick<QueryCtx, "db">,
  assignment: Doc<"kpiAssignments">,
  periodKey: string,
): Promise<{
  complete: boolean;
  approved: number;
  pending: number;
  /** In-period files uploaded after the period's submission deadline. */
  late: number;
  /** Other cadence periods that DO hold approved evidence (sorted). */
  approvedElsewhere: string[];
}> {
  const freq = assignment.frequency as Frequency;
  const files = (
    await ctx.db
      .query("evidenceFiles")
      .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignment._id))
      .take(500)
  ).filter((e) => e.retentionState !== "deleted");
  const inPeriod = files.filter((e) => evidenceSupportsPeriod(freq, e, periodKey));
  const approved = inPeriod.filter((e) => e.reviewStatus === "approved").length;
  const pending = inPeriod.filter((e) =>
    ["submitted", "verified"].includes(e.reviewStatus),
  ).length;

  const period = await ctx.db
    .query("trackingPeriods")
    .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
    .first();
  const late =
    period && period.cadenceGrace !== true
      ? inPeriod.filter((e) => e.uploadedAt > period.dueAt).length
      : 0;

  const elsewhere = new Set<string>();
  for (const e of files) {
    if (e.reviewStatus !== "approved") continue;
    if (evidenceSupportsPeriod(freq, e, periodKey)) continue;
    elsewhere.add(evidenceCadenceKey(freq, e));
  }

  return {
    complete: assignment.evidenceRequired ? approved > 0 : true,
    approved,
    pending,
    late,
    approvedElsewhere: [...elsewhere].sort(),
  };
}

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

  // Nothing counted → nothing to measure. Remove any provisional measurement
  // instead of scoring an empty input set (a zero-entry count would otherwise
  // read as 0% — or as perfect for lower-is-better budgets).
  if (counted.length === 0) {
    const existing = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", assignment._id).eq("periodKey", periodKey),
      )
      .first();
    if (existing?.isProvisional) await ctx.db.delete(existing._id);
    return;
  }

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

  // Period-aware: only approved evidence for THIS period completes the gate.
  const { complete: evidenceComplete } = await periodEvidence(ctx, assignment, periodKey);

  const period = await ctx.db
    .query("trackingPeriods")
    .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
    .first();
  // Admin-granted grace on a period (e.g. the go-live month) means every
  // submission in it counts as on time, no matter when it lands.
  const cadenceCompliant = period
    ? period.cadenceGrace === true || Date.now() <= period.dueAt
    : true;

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

  // An admin score override (documented, audited) supersedes the computed
  // attainment — the latest override for this (assignment, period) wins and
  // survives recomputes until it is explicitly removed.
  const overrides = await ctx.db
    .query("scoreOverrides")
    .withIndex("by_assignment_period", (q) =>
      q.eq("kpiAssignmentId", assignment._id).eq("periodKey", periodKey),
    )
    .take(50);
  const override = overrides.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (override) {
    doc.attainment = override.overrideValue;
    doc.cappedAttainment = override.overrideValue;
    doc.weightedContribution = weightedContribution(
      override.overrideValue,
      assignment.weight,
    );
    doc.status = statusFromAttainment(override.overrideValue);
    doc.hasData = true;
  }

  const existing = await ctx.db
    .query("kpiMeasurements")
    .withIndex("by_assignment_period", (q) =>
      q.eq("kpiAssignmentId", assignment._id).eq("periodKey", periodKey),
    )
    .first();
  if (existing) await ctx.db.patch(existing._id, doc);
  else await ctx.db.insert("kpiMeasurements", doc);
}
