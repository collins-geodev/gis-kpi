/**
 * Submission compliance: who has (and hasn't) submitted KPI data for a period,
 * on time or late — plus the admin controls for the capture window (close /
 * reopen a tracking period). Lateness itself comes from the measurements'
 * `cadenceCompliant` flag; this module aggregates and gates.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { readableEmployeeIds, requireRole } from "./authz";
import { recordAudit } from "./audit";
import { cadencePeriodKey } from "./lib/periods";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";

/**
 * Per-employee submission posture for one reporting month. Each KPI is read at
 * its own cadence bucket (monthly KPIs at the month, quarterly at the
 * containing quarter, annual at the year).
 */
export const board = query({
  args: { periodKey: v.string() },
  handler: async (ctx, { periodKey }) => {
    await requireRole(ctx, ["manager", "kpi_admin", "system_admin", "auditor"]);
    const scope = await readableEmployeeIds(ctx);

    const period = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
      .first();

    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) return { period: null, rows: [] };

    const employees = (await ctx.db.query("employees").take(500)).filter(
      (e) => e.isActive && (scope === "all" || scope.includes(e._id)),
    );

    const rows = [];
    for (const emp of employees.sort((a, b) => a.displayOrder - b.displayOrder)) {
      const assignments = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", emp._id).eq("performanceYearId", year._id),
        )
        .collect();
      let onTime = 0;
      let late = 0;
      const missing: string[] = [];
      for (const a of assignments) {
        const bucket = cadencePeriodKey(a.frequency as Frequency, periodKey);
        const m = await ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", a._id).eq("periodKey", bucket),
          )
          .first();
        if (m?.hasData) {
          if (m.cadenceCompliant) onTime++;
          else late++;
        } else {
          missing.push(a.objective);
        }
      }
      rows.push({
        employeeId: emp._id,
        name: emp.displayName,
        jobRole: emp.jobRole,
        expected: assignments.length,
        onTime,
        late,
        missing,
      });
    }

    return {
      period: period
        ? {
            periodKey: period.periodKey,
            label: period.label,
            status: period.status,
            dueAt: period.dueAt,
          }
        : null,
      rows,
    };
  },
});

/** Close a period's capture window early (KPI/System Admin). */
export const closePeriod = mutation({
  args: { periodKey: v.string(), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["kpi_admin", "system_admin"]);
    const period = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
      .first();
    if (!period) throw new Error("Period not found");
    if (period.status === "locked") throw new Error("Period is locked.");
    await ctx.db.patch(period._id, { status: "closed" });
    await recordAudit(ctx, {
      entityType: "trackingPeriod",
      entityId: period._id,
      action: "close_period",
      actorUserId: user._id,
      reason,
      before: { status: period.status },
      after: { status: "closed" },
    });
    return null;
  },
});

/** Reopen a closed period for capture (KPI/System Admin, reason required). */
export const reopenPeriod = mutation({
  args: { periodKey: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["kpi_admin", "system_admin"]);
    if (!reason.trim()) throw new Error("A reason is required to reopen a period.");
    const period = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
      .first();
    if (!period) throw new Error("Period not found");
    // Past-due periods reopen into grace (capture allowed, flagged late).
    const next = period.dueAt < Date.now() ? "grace" : "open";
    await ctx.db.patch(period._id, { status: next });
    await recordAudit(ctx, {
      entityType: "trackingPeriod",
      entityId: period._id,
      action: "reopen_period",
      actorUserId: user._id,
      reason,
      before: { status: period.status },
      after: { status: next },
    });
    return null;
  },
});
