/**
 * Activity capture + deterministic measurement recompute.
 *
 * Creating an activity records the raw inputs that support a KPI result, then
 * recomputes the provisional measurement for that (assignment, period) using the
 * scoring engine — the AI model is never involved. Evidence completeness gates
 * whether a measurement can later become an approved official score.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { AuthError, getAuthContext, requireUser } from "./authz";
import { recordAudit } from "./audit";
import { recomputeMeasurement } from "./measurementsModel";
import { BASELINE_PERFORMANCE_YEAR } from "./lib/types";

export const create = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    activityAt: v.number(),
    title: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    numerator: v.optional(v.number()),
    denominator: v.optional(v.number()),
    baseline: v.optional(v.number()),
    currentValue: v.optional(v.number()),
    withinThreshold: v.optional(v.number()),
    eligible: v.optional(v.number()),
    completed: v.optional(v.number()),
    planned: v.optional(v.number()),
    pass: v.optional(v.boolean()),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
    projectRef: v.optional(v.string()),
    ticketRef: v.optional(v.string()),
    assetRef: v.optional(v.string()),
  },
  returns: v.id("activities"),
  handler: async (ctx, args) => {
    const { user, roles } = await getAuthContext(ctx);
    const assignment = await ctx.db.get(args.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");

    const isOwner = user.employeeId && user.employeeId === assignment.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    if (!isOwner && !isAdmin) {
      throw new AuthError("You can only log activities for your own KPIs");
    }

    const activityId = await ctx.db.insert("activities", {
      employeeId: assignment.employeeId,
      kpiAssignmentId: args.kpiAssignmentId,
      periodKey: args.periodKey,
      activityAt: args.activityAt,
      title: args.title.slice(0, 300),
      description: args.description.slice(0, 4000),
      quantity: args.quantity,
      numerator: args.numerator,
      denominator: args.denominator,
      baseline: args.baseline,
      currentValue: args.currentValue,
      withinThreshold: args.withinThreshold,
      eligible: args.eligible,
      completed: args.completed,
      planned: args.planned,
      pass: args.pass,
      score: args.score,
      maxScore: args.maxScore,
      durationHours: undefined,
      projectRef: args.projectRef,
      ticketRef: args.ticketRef,
      assetRef: args.assetRef,
      status: "submitted",
      createdByUserId: user._id,
      updatedByUserId: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await recomputeMeasurement(ctx, assignment, args.periodKey);

    await recordAudit(ctx, {
      entityType: "activity",
      entityId: activityId,
      action: "create_activity",
      actorUserId: user._id,
      after: { kpiAssignmentId: args.kpiAssignmentId, periodKey: args.periodKey },
    });
    return activityId;
  },
});

/** Tracking periods available for logging (2026 month/quarter/year). */
export const periods = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("trackingPeriods").take(500);
    return rows
      .sort((a, b) => a.startAt - b.startAt)
      .map((p) => ({
        periodKey: p.periodKey,
        label: p.label,
        grain: p.grain,
        startAt: p.startAt,
      }));
  },
});

/** The current user's own KPI assignments (for the capture form). */
export const myAssignments = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.employeeId) return [];
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) return [];
    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", user.employeeId!).eq("performanceYearId", year._id),
      )
      .collect();
    return assignments
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({
        id: a._id,
        objective: a.objective,
        metric: a.metric,
        canonicalKey: a.canonicalKey,
        measurementMode: a.measurementMode,
        direction: a.direction,
        targetType: a.targetType,
        target: a.target,
        frequency: a.frequency,
        weight: a.weight,
        evidenceRequired: a.evidenceRequired,
        scoringBlocked: a.scoringBlocked,
      }));
  },
});

/** Recent activities for the current user's employee. */
export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const user = await requireUser(ctx);
    if (!user.employeeId) return [];
    const rows = await ctx.db
      .query("activities")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", user.employeeId!))
      .take(Math.min(limit ?? 25, 100));
    return rows
      .sort((a, b) => b.activityAt - a.activityAt)
      .map((a) => ({
        id: a._id,
        title: a.title,
        periodKey: a.periodKey,
        activityAt: a.activityAt,
        status: a.status,
        kpiAssignmentId: a.kpiAssignmentId,
      }));
  },
});
