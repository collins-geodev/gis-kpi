/**
 * Analytics aggregates for the whole GIS Team (scope-aware). Charts answer
 * management questions; each has a table alternative in the UI. Works off the
 * seeded configuration even before measurements exist.
 */
import { query } from "./_generated/server";
import { getAuthContext } from "./authz";

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
