/**
 * Employee directory + individual scorecard reads. All access is scope-checked
 * server-side (see authz.ts). The scorecard is computed by the deterministic
 * engine (convex/lib/scoring.ts) — never the AI model. With a fresh baseline
 * (no measurements yet) every KPI correctly reads "No Data".
 */
import { query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertEmployeeReadScope, getAuthContext, readableEmployeeIds } from "./authz";
import { scoreScorecard, type ScorecardItem } from "./lib/scoring";
import { BASELINE_PERFORMANCE_YEAR } from "./lib/types";

function employeeDTO(e: Doc<"employees">) {
  return {
    id: e._id,
    employeeId: e.employeeId,
    fullName: e.fullName,
    displayName: e.displayName,
    honorific: e.honorific ?? null,
    jobRole: e.jobRole,
    sourceLocation: e.sourceLocation,
    canonicalLocation: e.canonicalLocation,
    isActive: e.isActive,
    displayOrder: e.displayOrder,
  };
}

async function baselineYearId(ctx: {
  db: { query: any };
}): Promise<Id<"performanceYears"> | null> {
  const year = await ctx.db
    .query("performanceYears")
    .withIndex("by_year", (q: any) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
    .first();
  return year?._id ?? null;
}

/** Directory of employees the caller may see, with a scorecard headline each. */
export const listScoped = query({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx); // must be authenticated with a role
    const scope = await readableEmployeeIds(ctx);

    let employees: Doc<"employees">[];
    if (scope === "all") {
      employees = await ctx.db.query("employees").take(1000);
    } else {
      employees = [];
      for (const id of scope) {
        const e = await ctx.db.get(id);
        if (e) employees.push(e);
      }
    }
    employees.sort((a, b) => a.displayOrder - b.displayOrder);

    const yearId = await baselineYearId(ctx);
    const rows = [];
    for (const e of employees) {
      const assignments = yearId
        ? await ctx.db
            .query("kpiAssignments")
            .withIndex("by_employee_year", (q) =>
              q.eq("employeeId", e._id).eq("performanceYearId", yearId),
            )
            .collect()
        : [];
      const items: ScorecardItem[] = assignments.map((a) => ({
        weight: a.weight,
        cappedAttainment: null, // no measurements in the baseline yet
      }));
      const scorecard = scoreScorecard(items);
      rows.push({
        ...employeeDTO(e),
        kpiCount: assignments.length,
        configuredWeight: scorecard.configuredWeight,
        assignedWeightScore: scorecard.assignedWeightScore,
        itemsWithData: scorecard.itemsWithData,
      });
    }
    return rows;
  },
});

/** Full individual performance detail: profile + 5 KPIs + live scorecard. */
export const getDetail = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, { employeeId }) => {
    await assertEmployeeReadScope(ctx, employeeId);
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new ConvexError("Employee not found");

    const yearId = await baselineYearId(ctx);
    const assignments = yearId
      ? (
          await ctx.db
            .query("kpiAssignments")
            .withIndex("by_employee_year", (q) =>
              q.eq("employeeId", employeeId).eq("performanceYearId", yearId),
            )
            .collect()
        ).sort((a, b) => a.displayOrder - b.displayOrder)
      : [];

    const kpiRows = [];
    const scorecardItems: ScorecardItem[] = [];
    for (const a of assignments) {
      const measurements = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", a._id))
        .take(50);
      const latest = measurements.sort((m1, m2) => m2.computedAt - m1.computedAt)[0];
      scorecardItems.push({
        weight: a.weight,
        cappedAttainment: latest?.cappedAttainment ?? null,
        evidenceComplete: latest?.evidenceComplete ?? false,
        cadenceCompliant: latest?.cadenceCompliant ?? false,
      });
      kpiRows.push({
        assignmentId: a._id,
        canonicalKey: a.canonicalKey,
        objective: a.objective,
        metric: a.metric,
        weight: a.weight,
        target: a.target,
        targetType: a.targetType,
        frequency: a.frequency,
        measurementMode: a.measurementMode,
        direction: a.direction,
        scoringBlocked: a.scoringBlocked,
        sourceRowNumber: a.sourceRowNumber,
        rawActual: latest?.rawActual ?? null,
        attainment: latest?.attainment ?? null,
        cappedAttainment: latest?.cappedAttainment ?? null,
        weightedContribution: latest?.weightedContribution ?? 0,
        status: latest?.status ?? ("no_data" as const),
      });
    }
    const scorecard = scoreScorecard(scorecardItems);

    // Official score history — frozen, approved snapshots for this employee.
    const snapshots = await ctx.db
      .query("scoreSnapshots")
      .withIndex("by_scope_period", (q) =>
        q.eq("scope", "individual").eq("scopeRef", employeeId),
      )
      .take(100);
    const history = [];
    for (const s of snapshots.sort((a, b) => b.createdAt - a.createdAt)) {
      let approvedBy: string | null = null;
      if (s.createdByUserId) {
        const u = await ctx.db.get(s.createdByUserId);
        approvedBy = u?.name ?? u?.email ?? null;
      }
      history.push({
        id: s._id,
        periodKey: s.periodKey,
        assignedWeightScore: s.assignedWeightScore,
        configuredWeight: s.configuredWeight,
        normalizedScore: s.normalizedScore,
        evidenceCompletionPct: s.evidenceCompletionPct,
        approvalState: s.approvalState,
        approvedBy,
        createdAt: s.createdAt,
      });
    }

    return {
      employee: employeeDTO(employee),
      kpis: kpiRows,
      scorecard,
      history,
      year: BASELINE_PERFORMANCE_YEAR,
    };
  },
});
