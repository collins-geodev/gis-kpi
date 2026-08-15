/**
 * Documented score overrides — for cases the deterministic engine cannot judge
 * fairly (e.g. a fixed-quota KPI in a month where demand fell short). Admin
 * only, a reason is mandatory, the original value is preserved, everything is
 * audit-logged, and the employee is notified. The override survives recomputes
 * until removed.
 */
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertEmployeeReadScope, requireRole } from "./authz";
import { recordAudit } from "./audit";
import { recomputeMeasurement } from "./measurementsModel";
import { resolveDisplayName } from "./emails";
import { formatPercent } from "./lib/format";

/** Overrides for one KPI assignment (panel listing; admin/scope-checked). */
export const listForAssignment = query({
  args: { kpiAssignmentId: v.id("kpiAssignments") },
  handler: async (ctx, { kpiAssignmentId }) => {
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);
    const rows = await ctx.db
      .query("scoreOverrides")
      .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", kpiAssignmentId))
      .take(100);
    const out = [];
    for (const o of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const actor = await ctx.db.get(o.overriddenByUserId);
      out.push({
        id: o._id,
        periodKey: o.periodKey,
        originalValue: o.originalValue,
        overrideValue: o.overrideValue,
        reason: o.reason,
        by: actor ? await resolveDisplayName(ctx, actor) : "—",
        createdAt: o.createdAt,
      });
    }
    return out;
  },
});

/** Apply (or replace) an override for one (KPI, period). */
export const apply = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    /** Attainment as a decimal, e.g. 1 = 100%. */
    overrideValue: v.number(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, ["kpi_admin", "system_admin"]);
    const assignment = await ctx.db.get(args.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required for a score override.");
    if (args.overrideValue < 0 || args.overrideValue > assignment.stretchCap) {
      throw new Error(
        `Override must be between 0% and the stretch cap (${formatPercent(assignment.stretchCap)}).`,
      );
    }

    const measurement = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", args.kpiAssignmentId).eq("periodKey", args.periodKey),
      )
      .first();
    if (measurement && !measurement.isProvisional) {
      throw new Error(
        "This period is already approved and frozen — reopen it before overriding.",
      );
    }

    const overrideId = await ctx.db.insert("scoreOverrides", {
      kpiMeasurementId: measurement?._id,
      employeeId: assignment.employeeId,
      kpiAssignmentId: args.kpiAssignmentId,
      periodKey: args.periodKey,
      originalValue: measurement?.cappedAttainment ?? null,
      overrideValue: args.overrideValue,
      reason: reason.slice(0, 1000),
      overriddenByUserId: user._id,
      createdAt: Date.now(),
    });
    await recomputeMeasurement(ctx, assignment, args.periodKey);

    await recordAudit(ctx, {
      entityType: "scoreOverride",
      entityId: overrideId,
      action: "apply_override",
      actorUserId: user._id,
      reason,
      before: { cappedAttainment: measurement?.cappedAttainment ?? null },
      after: { overrideValue: args.overrideValue, periodKey: args.periodKey },
    });

    // Tell the employee — overrides must never be silent.
    const employee = await ctx.db.get(assignment.employeeId);
    const adminName = await resolveDisplayName(ctx, user);
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", assignment.employeeId))
      .take(10);
    const notices = [];
    for (const target of linked) {
      if (!target.email || target.isActive === false || target._id === user._id) {
        continue;
      }
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Score adjustment on your KPI — ${args.periodKey}`,
        intro: `*${adminName}* applied a documented score adjustment to one of your KPIs for ${args.periodKey}. The reason is recorded below and in the audit log.`,
        panelTitle: "Score adjustment",
        rows: [
          { label: "KPI objective", value: assignment.objective },
          { label: "Period", value: args.periodKey },
          {
            label: "Computed value",
            value:
              measurement?.cappedAttainment != null
                ? formatPercent(measurement.cappedAttainment)
                : "no data",
          },
          {
            label: "Adjusted to",
            value: formatPercent(args.overrideValue),
            strong: true,
          },
          { label: "Reason", value: reason.slice(0, 500) },
        ],
        ctaLabel: "Open the KPI",
        ctaPath: `/kpi/${args.kpiAssignmentId}`,
        inAppTitle: `Score adjusted — ${args.periodKey} (${employee?.displayName ?? ""})`,
        inAppBody: reason.slice(0, 180),
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "scoreOverride",
        entityId: overrideId,
        auditAction: "score_override",
        notices,
      });
    }
    return null;
  },
});

/** Remove an override and restore the engine-computed value. */
export const remove = mutation({
  args: { overrideId: v.id("scoreOverrides") },
  returns: v.null(),
  handler: async (ctx, { overrideId }) => {
    const { user } = await requireRole(ctx, ["kpi_admin", "system_admin"]);
    const override = await ctx.db.get(overrideId);
    if (!override) throw new Error("Override not found");
    const assignment = await ctx.db.get(override.kpiAssignmentId);
    await ctx.db.delete(overrideId);
    if (assignment) await recomputeMeasurement(ctx, assignment, override.periodKey);
    await recordAudit(ctx, {
      entityType: "scoreOverride",
      entityId: overrideId,
      action: "remove_override",
      actorUserId: user._id,
      before: {
        overrideValue: override.overrideValue,
        periodKey: override.periodKey,
        reason: override.reason,
      },
    });
    return null;
  },
});
