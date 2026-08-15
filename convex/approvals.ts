/**
 * Review queue + period approval.
 *
 * Approving an (employee, period) finalizes its provisional measurements and
 * freezes a reproducible scoreSnapshot. A measurement whose KPI requires
 * evidence cannot be approved until that evidence is approved, and a KPI blocked
 * by an open data-quality issue cannot be approved — enforcing acceptance #7.
 */
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertEmployeeReadScope, readableEmployeeIds, requireRole } from "./authz";
import { recordAudit } from "./audit";
import { resolveDisplayName } from "./emails";
import { formatPercent } from "./lib/format";
import { CALC_VERSION, scoreScorecard, type ScorecardItem } from "./lib/scoring";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";
import { cadencePeriodKey } from "./lib/periods";

/** Provisional measurements awaiting review, within the caller's scope. */
export const reviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["manager", "reviewer", "kpi_admin", "system_admin"]);
    const scope = await readableEmployeeIds(ctx);
    const measurements = await ctx.db.query("kpiMeasurements").take(2000);
    const rows = [];
    for (const m of measurements) {
      if (!m.isProvisional || !m.hasData) continue;
      if (scope !== "all" && !scope.includes(m.employeeId)) continue;
      const assignment = await ctx.db.get(m.kpiAssignmentId);
      const employee = await ctx.db.get(m.employeeId);
      if (!assignment || !employee) continue;
      rows.push({
        measurementId: m._id,
        employeeId: m.employeeId,
        employeeName: employee.displayName,
        assignmentId: assignment._id,
        objective: assignment.objective,
        periodKey: m.periodKey,
        cappedAttainment: m.cappedAttainment,
        weightedContribution: m.weightedContribution,
        status: m.status,
        evidenceRequired: assignment.evidenceRequired,
        evidenceComplete: m.evidenceComplete,
        cadenceCompliant: m.cadenceCompliant,
        scoringBlocked: assignment.scoringBlocked,
        ready:
          (!assignment.evidenceRequired || m.evidenceComplete) &&
          !assignment.scoringBlocked,
      });
    }
    return rows;
  },
});

/**
 * Reject a KPI submission after review: every submitted/verified activity for
 * that (KPI, period) returns to `needs_changes`, a review record captures the
 * required reason, and the employee is emailed the reason. Editing the entry
 * re-submits it for review.
 */
export const rejectSubmission = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    reason: v.string(),
  },
  returns: v.object({ returned: v.number() }),
  handler: async (ctx, { kpiAssignmentId, periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["manager", "kpi_admin", "system_admin"]);
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);
    const cleanReason = reason.trim();
    if (!cleanReason) throw new Error("A reason is required to reject a submission.");

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", kpiAssignmentId).eq("periodKey", periodKey),
      )
      .take(200);
    let returned = 0;
    for (const a of activities) {
      if (!["submitted", "verified"].includes(a.status)) continue;
      await ctx.db.patch(a._id, {
        status: "needs_changes",
        updatedByUserId: user._id,
        updatedAt: Date.now(),
      });
      returned++;
    }
    if (returned === 0) {
      throw new Error("No submitted activities to reject for this KPI and period.");
    }

    await ctx.db.insert("reviews", {
      subjectType: "measurement",
      subjectId: `${kpiAssignmentId}:${periodKey}`,
      kpiAssignmentId,
      employeeId: assignment.employeeId,
      periodKey,
      reviewerUserId: user._id,
      decision: "request_changes",
      comment: cleanReason.slice(0, 1000),
      createdAt: Date.now(),
    });

    await recordAudit(ctx, {
      entityType: "kpiAssignment",
      entityId: kpiAssignmentId,
      action: "reject_submission",
      actorUserId: user._id,
      reason: cleanReason,
      after: { periodKey, activitiesReturned: returned },
    });

    // Email + in-app: tell the employee why, and how to fix it.
    const employee = await ctx.db.get(assignment.employeeId);
    const reviewerName = await resolveDisplayName(ctx, user);
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
        subject: `Your KPI submission was rejected — action needed (${periodKey})`,
        intro: `*${reviewerName}* reviewed your ${periodKey} submission for the KPI below and returned it for changes. Please read the reason, update your entry from Activity Capture (edit the returned activity), and it will re-submit automatically.`,
        panelTitle: "Rejection details",
        rows: [
          { label: "KPI objective", value: assignment.objective },
          { label: "Period", value: periodKey },
          { label: "Decision", value: "REJECTED — CHANGES REQUESTED", strong: true },
          { label: "Reason", value: cleanReason.slice(0, 500) },
          { label: "Reviewed by", value: reviewerName },
        ],
        ctaLabel: "Open the KPI",
        ctaPath: `/kpi/${kpiAssignmentId}`,
        inAppTitle: `Submission rejected — ${periodKey}`,
        inAppBody: cleanReason.slice(0, 180),
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "kpiAssignment",
        entityId: kpiAssignmentId,
        auditAction: "submission_rejected",
        notices,
      });
    }

    return { returned };
  },
});

export const approveEmployeePeriod = mutation({
  args: {
    employeeId: v.id("employees"),
    periodKey: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    snapshotId: v.id("scoreSnapshots"),
    assignedWeightScore: v.number(),
    configuredWeight: v.number(),
    normalizedScore: v.number(),
  }),
  handler: async (ctx, { employeeId, periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["manager", "kpi_admin", "system_admin"]);
    await assertEmployeeReadScope(ctx, employeeId);

    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) throw new Error("Performance year not seeded");

    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", employeeId).eq("performanceYearId", year._id),
      )
      .collect();

    const blockers: string[] = [];
    const items: {
      assignment: (typeof assignments)[number];
      measurementId?: string;
      cappedAttainment: number | null;
      weightedContribution: number;
      status: string;
      evidenceComplete: boolean;
      cadenceCompliant: boolean;
    }[] = [];

    for (const assignment of assignments) {
      // Each KPI is read at its own cadence bucket: a monthly approval blends
      // quarter-to-date / year-to-date values for quarterly & annual KPIs.
      const lookupKey = cadencePeriodKey(assignment.frequency as Frequency, periodKey);
      const m = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignment._id).eq("periodKey", lookupKey),
        )
        .first();
      if (m && m.hasData) {
        if (assignment.evidenceRequired && !m.evidenceComplete) {
          blockers.push(`${assignment.objective.slice(0, 48)}: evidence not approved`);
        }
        if (assignment.scoringBlocked) {
          blockers.push(`${assignment.objective.slice(0, 48)}: data-quality blocked`);
        }
      }
      items.push({
        assignment,
        measurementId: m?._id,
        cappedAttainment: m?.cappedAttainment ?? null,
        weightedContribution: m?.weightedContribution ?? 0,
        status: m?.status ?? "no_data",
        evidenceComplete: m?.evidenceComplete ?? false,
        cadenceCompliant: m?.cadenceCompliant ?? false,
      });
    }

    if (blockers.length > 0) {
      throw new Error(`Cannot approve — resolve first: ${blockers.join("; ")}`);
    }

    // Finalize measurements (no longer provisional) and lock them.
    for (const it of items) {
      if (it.measurementId) {
        await ctx.db.patch(it.measurementId as never, { isProvisional: false });
      }
    }

    const scorecardItems: ScorecardItem[] = items.map((it) => ({
      weight: it.assignment.weight,
      cappedAttainment: it.cappedAttainment,
      evidenceComplete: it.evidenceComplete,
      cadenceCompliant: it.cadenceCompliant,
    }));
    const scorecard = scoreScorecard(scorecardItems);

    const priorSnapshot = await ctx.db
      .query("scoreSnapshots")
      .withIndex("by_scope_period", (q) =>
        q.eq("scope", "individual").eq("scopeRef", employeeId).eq("periodKey", periodKey),
      )
      .first();

    const snapshotId = await ctx.db.insert("scoreSnapshots", {
      scope: "individual",
      scopeRef: employeeId,
      performanceYearId: year._id,
      periodKey,
      calcVersion: CALC_VERSION,
      payload: {
        items: items.map((it) => ({
          assignmentId: it.assignment._id,
          canonicalKey: it.assignment.canonicalKey,
          objective: it.assignment.objective,
          weight: it.assignment.weight,
          target: it.assignment.target,
          targetType: it.assignment.targetType,
          cappedAttainment: it.cappedAttainment,
          weightedContribution: it.weightedContribution,
          status: it.status,
        })),
        scorecard,
      },
      configuredWeight: scorecard.configuredWeight,
      assignedWeightScore: scorecard.assignedWeightScore,
      normalizedScore: scorecard.normalizedScore,
      normalizationEnabled: year.normalizationEnabled,
      evidenceCompletionPct: scorecard.evidenceCompletionPct,
      cadenceCompliancePct: scorecard.cadenceCompliancePct,
      approvalState: "approved",
      createdByUserId: user._id,
      createdAt: Date.now(),
    });

    await ctx.db.insert("approvals", {
      employeeId,
      performanceYearId: year._id,
      periodKey,
      approverUserId: user._id,
      state: "approved",
      reason,
      priorScoreSnapshotId: priorSnapshot?._id,
      createdAt: Date.now(),
    });

    await recordAudit(ctx, {
      entityType: "scoreSnapshot",
      entityId: snapshotId,
      action: "approve_period",
      actorUserId: user._id,
      reason,
      after: {
        employeeId,
        periodKey,
        assignedWeightScore: scorecard.assignedWeightScore,
        configuredWeight: scorecard.configuredWeight,
      },
    });

    // The approval decision notifies the employee's linked account(s).
    const employee = await ctx.db.get(employeeId);
    const approverName = await resolveDisplayName(ctx, user);
    const score = `${Math.round(scorecard.assignedWeightScore * 100) / 100} / ${scorecard.configuredWeight}`;
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
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
        subject: `Your ${periodKey} scorecard was approved — ${score}`,
        intro: `*${approverName}* approved your ${periodKey} performance${reason ? ` (“${reason.slice(0, 140)}”)` : ""}. Your official score is frozen in a reproducible, auditable snapshot.`,
        panelTitle: "Approved scorecard",
        rows: [
          { label: "Period", value: periodKey },
          { label: "Official score", value: score, strong: true },
          {
            label: "Normalized score",
            value: formatPercent(scorecard.normalizedScore),
          },
          {
            label: "Evidence completion",
            value: formatPercent(scorecard.evidenceCompletionPct),
          },
          { label: "Approved by", value: approverName },
        ],
        ctaLabel: "View your scorecard",
        ctaPath: `/employees/${employeeId}`,
        inAppTitle: `${periodKey} scorecard approved — ${score}`,
        inAppBody: `Approved by ${approverName}${reason ? `: ${reason.slice(0, 160)}` : ""}`,
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "scoreSnapshot",
        entityId: snapshotId,
        auditAction: "period_approved",
        notices,
      });
    }

    return {
      snapshotId,
      assignedWeightScore: scorecard.assignedWeightScore,
      configuredWeight: scorecard.configuredWeight,
      normalizedScore: scorecard.normalizedScore,
    };
  },
});
