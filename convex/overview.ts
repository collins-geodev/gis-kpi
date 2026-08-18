/**
 * Executive-overview aggregates. Full analytics (trends, drivers, backlog) build
 * on scoreSnapshots; this baseline summary powers the landing dashboard and the
 * prominent 80/100 configured-weight warning immediately after seeding.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./authz";
import { CONFIGURED_WEIGHT_TOTAL, FULL_WEIGHT_TOTAL } from "./lib/types";

export const baselineSummary = query({
  args: {},
  returns: v.object({
    year: v.number(),
    employees: v.number(),
    assignments: v.number(),
    kpiDefinitions: v.number(),
    openIssues: v.number(),
    blockers: v.number(),
    awaitingReview: v.number(),
    returnedForChanges: v.number(),
    weightsComplete: v.boolean(),
    configuredWeightTotal: v.number(),
    fullWeightTotal: v.number(),
    seeded: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireUser(ctx);
    // Baseline tables are small (15 employees / 75 assignments); bounded reads.
    const employees = (await ctx.db.query("employees").take(2000)).length;
    const assignmentRows = await ctx.db.query("kpiAssignments").take(5000);
    const assignments = assignmentRows.length;
    // True once every employee's configured weights total 100 (core 80 +
    // non-core 20) — flips the overview's 80/100 warning to a confirmation.
    const weightByEmp: Record<string, number> = {};
    for (const a of assignmentRows) {
      weightByEmp[a.employeeId] = (weightByEmp[a.employeeId] ?? 0) + a.weight;
    }
    const totals = Object.values(weightByEmp);
    const weightsComplete =
      totals.length > 0 && totals.every((t) => t === FULL_WEIGHT_TOTAL);
    const kpiDefinitions = (await ctx.db.query("kpiDefinitions").take(1000)).length;
    const open = await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(5000);
    const proposed = await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_status", (q) => q.eq("status", "proposed"))
      .take(5000);
    const blockers = open.filter((i) => i.blocksScoring).length;
    // Submission workflow posture: what reviewers owe vs what employees owe.
    const activities = await ctx.db.query("activities").take(5000);
    const awaitingReview = activities.filter((a) =>
      ["submitted", "verified"].includes(a.status),
    ).length;
    const returnedForChanges = activities.filter(
      (a) => a.status === "needs_changes",
    ).length;
    return {
      year: 2026,
      employees,
      assignments,
      kpiDefinitions,
      openIssues: open.length + proposed.length,
      blockers,
      awaitingReview,
      returnedForChanges,
      weightsComplete,
      configuredWeightTotal: CONFIGURED_WEIGHT_TOTAL,
      fullWeightTotal: FULL_WEIGHT_TOTAL,
      seeded: employees > 0,
    };
  },
});
