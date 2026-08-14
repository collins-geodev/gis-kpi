/**
 * Frozen report dataset for the PDF/Excel/AI pipelines. Scope-checked and
 * bounded. All numbers come from the deterministic engine; the AI layer only
 * explains this payload.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getAuthContext,
  assertEmployeeReadScope,
  readableEmployeeIds,
  requireUser,
} from "./authz";
import { recordAudit } from "./audit";
import { scoreScorecard, type ScorecardItem } from "./lib/scoring";
import { ROLE_TEMPLATES } from "./lib/catalogue";
import { BASELINE_PERFORMANCE_YEAR, type JobRole } from "./lib/types";
import { vReportScope } from "./validators";

const WEIGHT_WARNING =
  "Configured weights total 80 / 100 per employee — the missing 20 points are surfaced, not invented.";

/** Record report-generation provenance (format, and AI model details if used). */
export const logGeneration = mutation({
  args: {
    scope: vReportScope,
    scopeRef: v.optional(v.string()),
    periodKey: v.string(),
    format: v.union(v.literal("pdf"), v.literal("xlsx")),
    aiProvider: v.optional(v.string()),
    aiModelId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    schemaVersion: v.optional(v.string()),
    usage: v.optional(v.any()),
    generationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await recordAudit(ctx, {
      entityType: "report",
      entityId: `${args.scope}:${args.scopeRef ?? "team"}:${args.periodKey}:${args.format}`,
      action: "generate_report",
      actorUserId: user._id,
      after: {
        format: args.format,
        ai: args.aiModelId
          ? {
              provider: args.aiProvider,
              modelId: args.aiModelId,
              promptVersion: args.promptVersion,
              schemaVersion: args.schemaVersion,
              usage: args.usage,
              generationMs: args.generationMs,
            }
          : null,
      },
    });
    return null;
  },
});

export const dataset = query({
  args: {
    scope: vReportScope,
    scopeRef: v.optional(v.string()),
    periodKey: v.string(),
  },
  handler: async (ctx, { scope, scopeRef, periodKey }) => {
    await getAuthContext(ctx);

    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) throw new Error("Performance year not seeded");

    // Resolve the readable employee set for the requested scope.
    let employees: Doc<"employees">[];
    let scopeLabel = "GIS Unit — Team";
    if (scope === "individual" && scopeRef) {
      await assertEmployeeReadScope(ctx, scopeRef as Id<"employees">);
      const e = await ctx.db.get(scopeRef as Id<"employees">);
      employees = e ? [e] : [];
      scopeLabel = e ? `${e.displayName} (${e.employeeId})` : "Individual";
    } else {
      const readable = await readableEmployeeIds(ctx);
      const all = await ctx.db.query("employees").take(2000);
      employees = readable === "all" ? all : all.filter((e) => readable.includes(e._id));
      if (scope === "role" && scopeRef) {
        employees = employees.filter((e) => e.jobRole === scopeRef);
        scopeLabel = `Role — ${scopeRef}`;
      } else if (scope === "location" && scopeRef) {
        employees = employees.filter((e) => e.canonicalLocation === scopeRef);
        scopeLabel = `Location — ${scopeRef}`;
      }
    }
    employees.sort((a, b) => a.displayOrder - b.displayOrder);
    const readableIds = new Set(employees.map((e) => e._id));

    const period = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
      .first();

    // Per-employee scorecards + per-KPI rows.
    const assignmentObjective = new Map<string, string>();
    const employeeRows = [];
    const kpiRows = [];
    let scoringBlocked = 0;
    for (const e of employees) {
      const assignments = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", e._id).eq("performanceYearId", year._id),
        )
        .collect();
      assignments.sort((a, b) => a.displayOrder - b.displayOrder);
      const items: ScorecardItem[] = [];
      for (const a of assignments) {
        assignmentObjective.set(a._id, a.objective);
        if (a.scoringBlocked) scoringBlocked++;
        const m = await ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", a._id).eq("periodKey", periodKey),
          )
          .first();
        items.push({
          weight: a.weight,
          cappedAttainment: m?.cappedAttainment ?? null,
          evidenceComplete: m?.evidenceComplete ?? false,
          cadenceCompliant: m?.cadenceCompliant ?? false,
        });
        kpiRows.push({
          employeeId: e.employeeId,
          employeeName: e.displayName,
          objective: a.objective,
          metric: a.metric,
          weight: a.weight,
          target: a.target,
          targetType: a.targetType,
          frequency: a.frequency,
          measurementMode: a.measurementMode,
          cappedAttainment: m?.cappedAttainment ?? null,
          weightedContribution: m?.weightedContribution ?? 0,
          status: m?.status ?? "no_data",
          scoringBlocked: a.scoringBlocked,
          sourceRowNumber: a.sourceRowNumber,
        });
      }
      const sc = scoreScorecard(items);
      employeeRows.push({
        employeeId: e.employeeId,
        name: e.displayName,
        jobRole: e.jobRole,
        location: e.canonicalLocation,
        configuredWeight: sc.configuredWeight,
        assignedWeightScore: sc.assignedWeightScore,
        normalizedScore: sc.normalizedScore,
        itemsWithData: sc.itemsWithData,
        kpiCount: assignments.length,
      });
    }

    // Activity + evidence registers (bounded, scope-filtered).
    const activityDocs = (await ctx.db.query("activities").take(1000))
      .filter((a) => readableIds.has(a.employeeId))
      .slice(0, 400);
    const empName = new Map(employees.map((e) => [e._id, e.displayName]));
    const activities = activityDocs.map((a) => ({
      employeeName: empName.get(a.employeeId) ?? "",
      objective: assignmentObjective.get(a.kpiAssignmentId) ?? "",
      periodKey: a.periodKey,
      title: a.title,
      activityAt: a.activityAt,
      status: a.status,
    }));

    const evidenceDocs = (await ctx.db.query("evidenceFiles").take(1000))
      .filter((e) => readableIds.has(e.employeeId))
      .slice(0, 400);
    const evidence = evidenceDocs.map((e) => ({
      employeeName: empName.get(e.employeeId) ?? "",
      objective: e.kpiAssignmentId
        ? (assignmentObjective.get(e.kpiAssignmentId) ?? "")
        : "",
      title: e.title,
      category: e.category,
      reviewStatus: e.reviewStatus,
      confidentiality: e.confidentiality,
      uploadedAt: e.uploadedAt,
    }));

    // Data quality (scoped to these employees + global config issues).
    const dqDocs = await ctx.db.query("dataQualityIssues").take(5000);
    const dqRows = [];
    let dqOpen = 0;
    let dqBlockers = 0;
    const RESOLVED = ["approved", "rejected", "resolved"];
    for (const i of dqDocs) {
      if (i.employeeId && !readableIds.has(i.employeeId)) continue;
      if (!RESOLVED.includes(i.status)) dqOpen++;
      if (i.blocksScoring && !RESOLVED.includes(i.status)) dqBlockers++;
      dqRows.push({
        category: i.category,
        severity: i.severity,
        status: i.status,
        sourceRowNumber: i.sourceRowNumber ?? null,
        employeeName: i.employeeId ? (empName.get(i.employeeId) ?? null) : null,
        field: i.field ?? null,
        sourceValue: i.sourceValue === undefined ? null : String(i.sourceValue),
        proposedValue: i.proposedValue === undefined ? null : String(i.proposedValue),
        reason: i.reason,
        blocksScoring: i.blocksScoring,
      });
    }

    // Definitions & methodology.
    const definitions = [];
    for (const role of Object.keys(ROLE_TEMPLATES) as JobRole[]) {
      for (const t of ROLE_TEMPLATES[role]) {
        definitions.push({
          role,
          title: t.title,
          canonicalObjective: t.canonicalObjective,
          canonicalMetric: t.canonicalMetric,
          measurementMode: t.measurementMode,
          direction: t.direction,
          targetType: t.targetType,
          defaultTarget: t.target,
          frequency: t.frequency,
          defaultWeight: t.weight,
          scoringNotes: t.scoringNotes,
        });
      }
    }

    return {
      meta: {
        title: "GIS Team KPI Performance Report",
        scope,
        scopeRef: scopeRef ?? "team",
        scopeLabel,
        periodKey,
        periodLabel: period?.label ?? periodKey,
        year: BASELINE_PERFORMANCE_YEAR,
        timezone: year.timezone,
        configuredWeightTotal: 80,
        fullWeightTotal: 100,
        normalizationEnabled: year.normalizationEnabled,
        reportVersion: 1,
      },
      executiveSummary: {
        employees: employees.length,
        assignments: kpiRows.length,
        scoringBlocked,
        dqOpen,
        dqBlockers,
        weightWarning: WEIGHT_WARNING,
      },
      employees: employeeRows,
      kpis: kpiRows,
      activities,
      evidence,
      dataQualityIssues: dqRows,
      definitions,
    };
  },
});
