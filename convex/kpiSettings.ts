/**
 * KPI Settings admin module: performance-year policy (normalization + caps) and
 * per-assignment editing of the canonical layer (weights, targets, target type,
 * cadence, formulas). The verbatim source layer is never touched; every edit is
 * audit-logged with before/after.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireRole } from "./authz";
import { recordAudit } from "./audit";
import {
  vDirection,
  vFrequency,
  vKpiStatus,
  vMeasurementMode,
  vTargetType,
} from "./validators";
import { BASELINE_PERFORMANCE_YEAR } from "./lib/types";

const KPI_ADMIN_ROLES = ["system_admin", "kpi_admin"] as const;

async function baselineYear(ctx: {
  db: { query: any };
}): Promise<Doc<"performanceYears"> | null> {
  return await ctx.db
    .query("performanceYears")
    .withIndex("by_year", (q: any) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
    .first();
}

export const yearSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, [...KPI_ADMIN_ROLES]);
    const year = await baselineYear(ctx);
    if (!year) return null;

    const employees = await ctx.db.query("employees").take(2000);
    const rows = [];
    for (const e of employees) {
      const assignments = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", e._id).eq("performanceYearId", year._id),
        )
        .collect();
      rows.push({
        id: e._id,
        employeeId: e.employeeId,
        displayName: e.displayName,
        jobRole: e.jobRole,
        kpiCount: assignments.length,
        weightTotal: assignments.reduce((s, a) => s + a.weight, 0),
      });
    }
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return {
      year: year.year,
      timezone: year.timezone,
      normalizationEnabled: year.normalizationEnabled,
      officialAttainmentCap: year.officialAttainmentCap,
      stretchAttainmentCap: year.stretchAttainmentCap,
      employees: rows,
    };
  },
});

export const updateYearSettings = mutation({
  args: {
    normalizationEnabled: v.optional(v.boolean()),
    officialAttainmentCap: v.optional(v.number()),
    stretchAttainmentCap: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, [...KPI_ADMIN_ROLES]);
    const year = await baselineYear(ctx);
    if (!year) throw new Error("Performance year not seeded");

    const patch: Partial<Doc<"performanceYears">> = {};
    if (args.normalizationEnabled !== undefined) {
      patch.normalizationEnabled = args.normalizationEnabled;
    }
    if (args.officialAttainmentCap !== undefined) {
      if (args.officialAttainmentCap <= 0 || args.officialAttainmentCap > 3) {
        throw new Error("Official cap must be a decimal between 0 and 3.");
      }
      patch.officialAttainmentCap = args.officialAttainmentCap;
    }
    if (args.stretchAttainmentCap !== undefined) {
      if (args.stretchAttainmentCap <= 0 || args.stretchAttainmentCap > 3) {
        throw new Error("Stretch cap must be a decimal between 0 and 3.");
      }
      patch.stretchAttainmentCap = args.stretchAttainmentCap;
    }
    await ctx.db.patch(year._id, patch);
    await recordAudit(ctx, {
      entityType: "performanceYear",
      entityId: year._id,
      action: "update_year_settings",
      actorUserId: user._id,
      before: {
        normalizationEnabled: year.normalizationEnabled,
        officialAttainmentCap: year.officialAttainmentCap,
        stretchAttainmentCap: year.stretchAttainmentCap,
      },
      after: patch,
    });
    return null;
  },
});

export const assignmentsForEmployee = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, { employeeId }) => {
    await requireRole(ctx, [...KPI_ADMIN_ROLES]);
    const year = await baselineYear(ctx);
    if (!year) return [];
    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", employeeId).eq("performanceYearId", year._id),
      )
      .collect();
    return assignments
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({
        id: a._id,
        canonicalKey: a.canonicalKey,
        objective: a.objective,
        metric: a.metric,
        weight: a.weight,
        target: a.target,
        targetType: a.targetType,
        frequency: a.frequency,
        direction: a.direction,
        measurementMode: a.measurementMode,
        scoreCap: a.scoreCap,
        stretchCap: a.stretchCap,
        evidenceRequired: a.evidenceRequired,
        status: a.status,
        scoringBlocked: a.scoringBlocked,
        sourceRowNumber: a.sourceRowNumber,
        sourceWeight: a.sourceWeight,
        sourceTarget: a.sourceTarget,
        sourceTargetType: a.sourceTargetType,
        sourceFrequency: a.sourceFrequency,
      }));
  },
});

export const updateAssignment = mutation({
  args: {
    assignmentId: v.id("kpiAssignments"),
    weight: v.optional(v.number()),
    target: v.optional(v.number()),
    targetType: v.optional(vTargetType),
    frequency: v.optional(vFrequency),
    direction: v.optional(vDirection),
    measurementMode: v.optional(vMeasurementMode),
    scoreCap: v.optional(v.number()),
    stretchCap: v.optional(v.number()),
    evidenceRequired: v.optional(v.boolean()),
    objective: v.optional(v.string()),
    metric: v.optional(v.string()),
    status: v.optional(vKpiStatus),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, [...KPI_ADMIN_ROLES]);
    const a = await ctx.db.get(args.assignmentId);
    if (!a) throw new Error("KPI assignment not found");

    const patch: Partial<Doc<"kpiAssignments">> = {};
    if (args.weight !== undefined) {
      if (args.weight < 0 || args.weight > 100) throw new Error("Weight must be 0–100.");
      patch.weight = args.weight;
    }
    if (args.target !== undefined) {
      if (args.target < 0) throw new Error("Target must be ≥ 0.");
      patch.target = args.target;
    }
    if (args.targetType !== undefined) patch.targetType = args.targetType;
    if (args.frequency !== undefined) patch.frequency = args.frequency;
    if (args.direction !== undefined) patch.direction = args.direction;
    if (args.measurementMode !== undefined) patch.measurementMode = args.measurementMode;
    if (args.scoreCap !== undefined) {
      if (args.scoreCap <= 0 || args.scoreCap > 3) throw new Error("Cap must be 0–3.");
      patch.scoreCap = args.scoreCap;
    }
    if (args.stretchCap !== undefined) {
      if (args.stretchCap <= 0 || args.stretchCap > 3)
        throw new Error("Cap must be 0–3.");
      patch.stretchCap = args.stretchCap;
    }
    if (args.evidenceRequired !== undefined)
      patch.evidenceRequired = args.evidenceRequired;
    if (args.objective !== undefined) patch.objective = args.objective.slice(0, 1000);
    if (args.metric !== undefined) patch.metric = args.metric.slice(0, 1000);
    if (args.status !== undefined) patch.status = args.status;

    await ctx.db.patch(args.assignmentId, patch);
    await recordAudit(ctx, {
      entityType: "kpiAssignment",
      entityId: args.assignmentId,
      action: "update_kpi",
      actorUserId: user._id,
      reason: args.reason,
      before: {
        weight: a.weight,
        target: a.target,
        targetType: a.targetType,
        frequency: a.frequency,
        direction: a.direction,
        measurementMode: a.measurementMode,
        scoreCap: a.scoreCap,
        stretchCap: a.stretchCap,
        evidenceRequired: a.evidenceRequired,
        objective: a.objective,
        metric: a.metric,
        status: a.status,
      },
      after: patch,
    });
    return null;
  },
});
