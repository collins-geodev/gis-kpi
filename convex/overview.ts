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
    configuredWeightTotal: v.number(),
    fullWeightTotal: v.number(),
    seeded: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireUser(ctx);
    // Baseline tables are small (15 employees / 75 assignments); bounded reads.
    const employees = (await ctx.db.query("employees").take(2000)).length;
    const assignments = (await ctx.db.query("kpiAssignments").take(5000)).length;
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
    return {
      year: 2026,
      employees,
      assignments,
      kpiDefinitions,
      openIssues: open.length + proposed.length,
      blockers,
      configuredWeightTotal: CONFIGURED_WEIGHT_TOTAL,
      fullWeightTotal: FULL_WEIGHT_TOTAL,
      seeded: employees > 0,
    };
  },
});
