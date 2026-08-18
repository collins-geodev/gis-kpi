/**
 * KPI assignment detail — the source-vs-canonical view with formula, cadence,
 * measurements, evidence lineage and the data-quality issues attached to the row.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { assertEmployeeReadScope } from "./authz";

export const getAssignment = query({
  args: { assignmentId: v.id("kpiAssignments") },
  handler: async (ctx, { assignmentId }) => {
    const assignment = await ctx.db.get(assignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);

    const employee = await ctx.db.get(assignment.employeeId);
    const definition = assignment.kpiDefinitionId
      ? await ctx.db.get(assignment.kpiDefinitionId)
      : null;

    // Row-scoped and employee-scoped data-quality issues.
    const rowIssues = await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_row", (q) => q.eq("sourceRowNumber", assignment.sourceRowNumber))
      .collect();
    const empIssues = await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_employee", (q) => q.eq("employeeId", assignment.employeeId))
      .take(50);
    const issueMap = new Map<string, (typeof rowIssues)[number]>();
    for (const i of [...rowIssues, ...empIssues]) issueMap.set(i._id, i);

    const measurements = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", assignmentId))
      .take(200);

    // Counted entries with raw inputs — powers the day/week breakdown for
    // daily/weekly KPIs (grouped and scored client-side by the same engine).
    const MEASURED_STATES = ["submitted", "verified", "approved"];
    const activities = (
      await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", assignmentId))
        .take(500)
    ).filter((a) => MEASURED_STATES.includes(a.status));

    return {
      assignment: {
        id: assignment._id,
        canonicalKey: assignment.canonicalKey,
        objective: assignment.objective,
        metric: assignment.metric,
        weight: assignment.weight,
        target: assignment.target,
        targetType: assignment.targetType,
        frequency: assignment.frequency,
        measurementMode: assignment.measurementMode,
        direction: assignment.direction,
        scoreCap: assignment.scoreCap,
        stretchCap: assignment.stretchCap,
        evidenceRequired: assignment.evidenceRequired,
        scoringBlocked: assignment.scoringBlocked,
        status: assignment.status,
        // Verbatim source layer for audit.
        sourceRowNumber: assignment.sourceRowNumber,
        sourceObjective: assignment.sourceObjective,
        sourceMetric: assignment.sourceMetric,
        sourceWeight: assignment.sourceWeight,
        sourceTarget: assignment.sourceTarget,
        sourceTargetType: assignment.sourceTargetType,
        sourceFrequency: assignment.sourceFrequency,
      },
      employee: employee
        ? {
            id: employee._id,
            employeeId: employee.employeeId,
            displayName: employee.displayName,
            jobRole: employee.jobRole,
            canonicalLocation: employee.canonicalLocation,
          }
        : null,
      definition: definition
        ? {
            title: definition.title,
            scoringNotes: definition.scoringNotes,
            needsRubric: definition.needsRubric,
            needsClarification: definition.needsClarification,
          }
        : null,
      issues: Array.from(issueMap.values()).map((i) => ({
        id: i._id,
        category: i.category,
        severity: i.severity,
        status: i.status,
        field: i.field ?? null,
        sourceValue: i.sourceValue ?? null,
        proposedValue: i.proposedValue ?? null,
        reason: i.reason,
        blocksScoring: i.blocksScoring,
      })),
      activities: activities
        .sort((a, b) => b.activityAt - a.activityAt)
        .map((a) => ({
          id: a._id,
          periodKey: a.periodKey,
          activityAt: a.activityAt,
          status: a.status,
          quantity: a.quantity ?? null,
          numerator: a.numerator ?? null,
          denominator: a.denominator ?? null,
          baseline: a.baseline ?? null,
          currentValue: a.currentValue ?? null,
          withinThreshold: a.withinThreshold ?? null,
          eligible: a.eligible ?? null,
          completed: a.completed ?? null,
          planned: a.planned ?? null,
          pass: a.pass ?? null,
          score: a.score ?? null,
          maxScore: a.maxScore ?? null,
        })),
      measurements: measurements
        .sort((a, b) => b.computedAt - a.computedAt)
        .map((m) => ({
          id: m._id,
          periodKey: m.periodKey,
          rawActual: m.rawActual,
          target: m.target,
          attainment: m.attainment,
          cappedAttainment: m.cappedAttainment,
          weightedContribution: m.weightedContribution,
          status: m.status,
          isProvisional: m.isProvisional,
          computedAt: m.computedAt,
        })),
    };
  },
});
