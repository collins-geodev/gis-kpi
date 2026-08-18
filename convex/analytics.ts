/**
 * Analytics aggregates for the whole GIS Team (scope-aware). Charts answer
 * management questions; each has a table alternative in the UI. Works off the
 * seeded configuration even before measurements exist.
 */
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertEmployeeReadScope, getAuthContext } from "./authz";
import { scoreScorecard, type ScorecardItem } from "./lib/scoring";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";
import { LAGOS_OFFSET_MS, cadencePeriodKey, monthKey } from "./lib/periods";

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx); // any authenticated user with a role

    const employees = await ctx.db.query("employees").take(2000);
    const assignments = await ctx.db.query("kpiAssignments").take(5000);
    const issues = await ctx.db.query("dataQualityIssues").take(5000);
    const measurements = await ctx.db.query("kpiMeasurements").take(5000);

    const countBy = <T>(items: T[], key: (t: T) => string) => {
      const m: Record<string, number> = {};
      for (const it of items) {
        const k = key(it);
        m[k] = (m[k] ?? 0) + 1;
      }
      return m;
    };

    const toRows = (rec: Record<string, number>) =>
      Object.entries(rec)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    // Role & location distribution.
    const byRole = toRows(countBy(employees, (e) => e.jobRole));
    const byLocation = toRows(countBy(employees, (e) => e.canonicalLocation));

    // Weight completeness per employee (all 80 in the baseline).
    const weightByEmp: Record<string, number> = {};
    for (const a of assignments) {
      weightByEmp[a.employeeId] = (weightByEmp[a.employeeId] ?? 0) + a.weight;
    }
    const complete = Object.values(weightByEmp).filter((w) => w === 100).length;
    const incomplete = Object.values(weightByEmp).length - complete;

    // KPI configuration mix.
    const byMode = toRows(countBy(assignments, (a) => a.measurementMode));
    const byFrequency = toRows(countBy(assignments, (a) => a.frequency));
    const scoringBlocked = assignments.filter((a) => a.scoringBlocked).length;

    // Data-quality posture.
    const RESOLVED = ["approved", "rejected", "resolved"];
    const dqByCategory = toRows(countBy(issues, (i) => i.category));
    const dqOpen = issues.filter((i) => !RESOLVED.includes(i.status)).length;
    const dqBlockers = issues.filter(
      (i) => i.blocksScoring && !RESOLVED.includes(i.status),
    ).length;

    // Measurement / score posture (may be sparse pre-capture).
    const byStatus = toRows(countBy(measurements, (m) => m.status));
    const withData = measurements.filter((m) => m.hasData).length;
    const evidenceComplete = measurements.filter((m) => m.evidenceComplete).length;
    const cadenceCompliant = measurements.filter((m) => m.cadenceCompliant).length;
    const approved = measurements.filter((m) => !m.isProvisional).length;

    return {
      totals: {
        employees: employees.length,
        assignments: assignments.length,
        measurements: measurements.length,
        scoringBlocked,
        dqOpen,
        dqBlockers,
      },
      byRole,
      byLocation,
      byMode,
      byFrequency,
      dqByCategory,
      measurementStatus: byStatus,
      weightCompleteness: [
        { label: "80 / 100 (baseline)", value: incomplete },
        { label: "100 / 100", value: complete },
      ],
      coverage: {
        withData,
        evidenceComplete,
        cadenceCompliant,
        approved,
        totalMeasurements: measurements.length,
      },
    };
  },
});

// --- Per-employee analytics --------------------------------------------------

const MODERATOR_ROLES = [
  "manager",
  "reviewer",
  "kpi_admin",
  "system_admin",
  "auditor",
  "executive_viewer",
];

/** Compact human summary of an activity's raw inputs, per measurement mode. */
function activityDetail(mode: string, a: Doc<"activities">): string {
  switch (mode) {
    case "ratio":
    case "composite":
      return `${a.numerator ?? "—"} / ${a.denominator ?? "—"}`;
    case "durationSla":
      return `${a.withinThreshold ?? "—"} / ${a.eligible ?? "—"} within SLA`;
    case "count":
      return `${a.quantity ?? "—"}`;
    case "reduction":
      return `${a.baseline ?? "—"} → ${a.currentValue ?? "—"}`;
    case "milestone":
      return `${a.completed ?? "—"} / ${a.planned ?? "—"} milestones`;
    case "binary":
      return a.pass ? "condition met" : "not met";
    case "rubric":
      return `${a.score ?? "—"} / ${a.maxScore ?? "—"} rubric`;
    default:
      return "";
  }
}

/**
 * One employee's analytics: current-period scorecard tiles, per-KPI attainment
 * with same-role peer averages, monthly score trend, and their activity log.
 * Moderators may select any employee in scope; everyone else always gets their
 * own linked employee (or null when unlinked).
 */
export const employeeAnalytics = query({
  args: { employeeId: v.optional(v.id("employees")) },
  handler: async (ctx, args) => {
    const { user, roles } = await getAuthContext(ctx);
    const canSelect = roles.some((r) => MODERATOR_ROLES.includes(r));

    let employeeId: Id<"employees"> | null = null;
    if (canSelect && args.employeeId) {
      await assertEmployeeReadScope(ctx, args.employeeId);
      employeeId = args.employeeId;
    } else if (user.employeeId) {
      employeeId = user.employeeId;
    }

    // Moderator roster for the selector (small, seeded table).
    const roster = canSelect
      ? (await ctx.db.query("employees").take(2000))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((e) => ({ id: e._id, displayName: e.displayName, jobRole: e.jobRole }))
      : [];

    if (!employeeId) {
      return {
        canSelect,
        roster,
        employee: null,
        currentPeriodKey: null,
        tiles: null,
        kpis: [],
        trend: [],
        activities: [],
      };
    }
    const core = await computeEmployeeAnalytics(ctx, employeeId);
    if (!core) {
      return {
        canSelect,
        roster,
        employee: null,
        currentPeriodKey: null,
        tiles: null,
        kpis: [],
        trend: [],
        activities: [],
      };
    }
    return { canSelect, roster, ...core };
  },
});

/** Shared computation for one employee (also used by the CLI audit query). */
export async function computeEmployeeAnalytics(
  ctx: QueryCtx,
  employeeId: Id<"employees">,
) {
    const employee = await ctx.db.get(employeeId);
    if (!employee) return null;

    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) return null;

    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", employeeId!).eq("performanceYearId", year._id),
      )
      .collect();

    const nowLagos = new Date(Date.now() + LAGOS_OFFSET_MS);
    const currentMonthKey = monthKey(nowLagos.getUTCFullYear(), nowLagos.getUTCMonth());

    const measurementAt = async (assignmentId: Id<"kpiAssignments">, pk: string) =>
      await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignmentId).eq("periodKey", pk),
        )
        .first();

    // Same-role peers for context averages (excluding the subject).
    const peers = (await ctx.db.query("employees").take(2000)).filter(
      (e) => e.jobRole === employee.jobRole && e._id !== employeeId,
    );
    const peerAssignments: Doc<"kpiAssignments">[] = [];
    for (const p of peers) {
      peerAssignments.push(
        ...(await ctx.db
          .query("kpiAssignments")
          .withIndex("by_employee_year", (q) =>
            q.eq("employeeId", p._id).eq("performanceYearId", year._id),
          )
          .collect()),
      );
    }

    // Per-KPI attainment (current cadence bucket) + peer average.
    const scorecardItems: ScorecardItem[] = [];
    const kpis = [];
    for (const a of assignments.sort((x, y) => x.displayOrder - y.displayOrder)) {
      const pk = cadencePeriodKey(a.frequency as Frequency, currentMonthKey);
      const m = await measurementAt(a._id, pk);
      const peerValues: number[] = [];
      for (const pa of peerAssignments) {
        if (pa.canonicalKey !== a.canonicalKey) continue;
        const ppk = cadencePeriodKey(pa.frequency as Frequency, currentMonthKey);
        const pm = await measurementAt(pa._id, ppk);
        if (pm?.hasData && pm.cappedAttainment !== null) {
          peerValues.push(pm.cappedAttainment);
        }
      }
      scorecardItems.push({
        weight: a.weight,
        cappedAttainment: m?.hasData ? (m.cappedAttainment ?? null) : null,
        evidenceComplete: m?.evidenceComplete ?? false,
        cadenceCompliant: m?.cadenceCompliant ?? false,
      });
      kpis.push({
        assignmentId: a._id,
        canonicalKey: a.canonicalKey,
        objective: a.objective,
        measurementMode: a.measurementMode,
        kpiCategory: a.kpiCategory ?? "core",
        weight: a.weight,
        periodKey: pk,
        attainment: m?.hasData ? (m.cappedAttainment ?? null) : null,
        status: m?.hasData ? m.status : "no_data",
        weightedContribution: m?.weightedContribution ?? 0,
        isProvisional: m?.isProvisional ?? true,
        peerAvg:
          peerValues.length > 0
            ? peerValues.reduce((s, x) => s + x, 0) / peerValues.length
            : null,
        peerCount: peerValues.length,
      });
    }
    const scorecard = scoreScorecard(scorecardItems);

    // Monthly trend across monthly-tracked KPIs (month-grain measurements).
    const weightByAssignment = new Map(assignments.map((a) => [a._id, a.weight]));
    const trend = [];
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const pk = monthKey(BASELINE_PERFORMANCE_YEAR, mIdx);
      let weight = 0;
      let scoreSum = 0;
      let withData = 0;
      for (const a of assignments) {
        const m2 = await measurementAt(a._id, pk);
        if (m2?.hasData && m2.cappedAttainment !== null) {
          const w = weightByAssignment.get(a._id) ?? 0;
          weight += w;
          scoreSum += m2.cappedAttainment * w;
          withData++;
        }
      }
      trend.push({
        periodKey: pk,
        monthIndex: mIdx,
        scoreOnMeasured: weight > 0 ? scoreSum / weight : null,
        kpisWithData: withData,
      });
    }

    // Activity log (newest first, capped).
    const assignmentById = new Map(assignments.map((a) => [a._id, a]));
    const rawActivities = await ctx.db
      .query("activities")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", employeeId!))
      .take(500);
    const activities = rawActivities
      .sort((x, y) => y.activityAt - x.activityAt)
      .slice(0, 30)
      .map((act) => {
        const a = assignmentById.get(act.kpiAssignmentId);
        return {
          id: act._id,
          activityAt: act.activityAt,
          periodKey: act.periodKey,
          title: act.title,
          status: act.status,
          canonicalKey: a?.canonicalKey ?? "",
          objective: a?.objective ?? "",
          detail: a ? activityDetail(a.measurementMode, act) : "",
        };
      });

    // Current-month activity count uses the real work-dates.
    const monthStart =
      Date.UTC(nowLagos.getUTCFullYear(), nowLagos.getUTCMonth(), 1) - LAGOS_OFFSET_MS;
    const monthEnd =
      Date.UTC(nowLagos.getUTCFullYear(), nowLagos.getUTCMonth() + 1, 1) - LAGOS_OFFSET_MS;
    const COUNTED = ["submitted", "verified", "approved", "locked"];
    const activitiesThisMonth = rawActivities.filter(
      (act) =>
        COUNTED.includes(act.status) &&
        act.activityAt >= monthStart &&
        act.activityAt < monthEnd,
    ).length;

    return {
      employee: {
        id: employee._id,
        displayName: employee.displayName,
        jobRole: employee.jobRole,
        location: employee.canonicalLocation,
      },
      currentPeriodKey: currentMonthKey,
      tiles: {
        scoreOnMeasured: scorecard.scoreOnMeasured,
        evidenceCompletionPct: scorecard.evidenceCompletionPct,
        cadenceCompliancePct: scorecard.cadenceCompliancePct,
        activitiesThisMonth,
        kpisWithData: scorecard.itemsWithData,
        kpiCount: scorecard.itemCount,
      },
      kpis,
      trend,
      activities,
    };
}
