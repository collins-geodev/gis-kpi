/**
 * Review queue + period approval.
 *
 * Approving an (employee, period) finalizes its provisional measurements and
 * freezes a reproducible scoreSnapshot. A measurement whose KPI requires
 * evidence cannot be approved until that evidence is approved, and a KPI blocked
 * by an open data-quality issue cannot be approved — enforcing acceptance #7.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { assertEmployeeReadScope, readableEmployeeIds, requireRole } from "./authz";
import { recordAudit } from "./audit";
import { resolveDisplayName } from "./emails";
import { formatPercent } from "./lib/format";
import { CALC_VERSION, scoreScorecard, type ScorecardItem } from "./lib/scoring";
import { recomputeMeasurement } from "./measurementsModel";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";
import { cadencePeriodKey } from "./lib/periods";
import { describeActivityInputs, describeSelfReport } from "./lib/selfReport";

/** Provisional measurements awaiting review, within the caller's scope. */
export const reviewQueue = query({
  args: {
    /**
     * "pending" (default) = provisional submissions awaiting a decision;
     * "official" = already-approved periods (recallable / deletable);
     * "all" = both.
     */
    view: v.optional(
      v.union(v.literal("pending"), v.literal("official"), v.literal("all")),
    ),
  },
  handler: async (ctx, { view }) => {
    await requireRole(ctx, ["manager", "reviewer", "kpi_admin", "system_admin"]);
    const mode = view ?? "pending";
    const scope = await readableEmployeeIds(ctx);
    const measurements = await ctx.db.query("kpiMeasurements").take(2000);
    const rows = [];
    for (const m of measurements) {
      if (!m.hasData) continue;
      if (mode === "pending" && !m.isProvisional) continue;
      if (mode === "official" && m.isProvisional) continue;
      if (scope !== "all" && !scope.includes(m.employeeId)) continue;
      const assignment = await ctx.db.get(m.kpiAssignmentId);
      const employee = await ctx.db.get(m.employeeId);
      if (!assignment || !employee) continue;
      // Evidence that exists but awaits review — the queue can offer a
      // one-click approve instead of a misleading "evidence needed".
      let pendingEvidence = 0;
      if (assignment.evidenceRequired && !m.evidenceComplete) {
        const ev = await ctx.db
          .query("evidenceFiles")
          .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", assignment._id))
          .take(200);
        pendingEvidence = ev.filter((e) =>
          ["submitted", "verified"].includes(e.reviewStatus),
        ).length;
      }

      // What the employee self-reported: the raw counted entries behind the
      // provisional number, so the reviewer can eyeball the claim in place.
      const acts = (
        await ctx.db
          .query("activities")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignment._id).eq("periodKey", m.periodKey),
          )
          .take(200)
      )
        .filter((a) => ["submitted", "verified", "approved"].includes(a.status))
        .sort((a, b) => b.activityAt - a.activityAt);

      rows.push({
        isProvisional: m.isProvisional,
        selfReported: describeSelfReport(
          assignment.measurementMode,
          assignment.direction,
          assignment.target,
          acts,
        ),
        entryCount: acts.length,
        entries: acts.slice(0, 8).map((a) => ({
          id: a._id,
          activityAt: a.activityAt,
          title: a.title,
          values: describeActivityInputs(assignment.measurementMode, a),
          status: a.status,
        })),
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
        pendingEvidence,
        kpiCategory: assignment.kpiCategory ?? "core",
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
 * Delete EVERY approved snapshot for an employee's period and reopen the
 * official measurements/activities. Used when a submission is deleted after
 * approval — the frozen score cannot outlive the records behind it. (The
 * review queue's recall button pops only the LATEST snapshot; this clears
 * them all so no earlier approval silently becomes current.) No-op when the
 * period has no snapshots.
 */
export async function reopenApprovedPeriod(
  ctx: MutationCtx,
  employeeId: Id<"employees">,
  periodKey: string,
  reason: string,
  actorUserId?: Id<"users">,
): Promise<{ snapshotsDeleted: number; measurementsReopened: number }> {
  const snapshots = await ctx.db
    .query("scoreSnapshots")
    .withIndex("by_scope_period", (q) =>
      q.eq("scope", "individual").eq("scopeRef", employeeId).eq("periodKey", periodKey),
    )
    .take(100);
  if (snapshots.length === 0) {
    return { snapshotsDeleted: 0, measurementsReopened: 0 };
  }
  for (const s of snapshots) await ctx.db.delete(s._id);

  const year = await ctx.db
    .query("performanceYears")
    .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
    .first();
  let measurementsReopened = 0;
  if (year) {
    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", employeeId).eq("performanceYearId", year._id),
      )
      .collect();
    for (const assignment of assignments) {
      const lookupKey = cadencePeriodKey(assignment.frequency as Frequency, periodKey);
      const m = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignment._id).eq("periodKey", lookupKey),
        )
        .first();
      if (m && !m.isProvisional) {
        await ctx.db.patch(m._id, { isProvisional: true });
        measurementsReopened++;
        const acts = await ctx.db
          .query("activities")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignment._id).eq("periodKey", lookupKey),
          )
          .take(500);
        for (const a of acts) {
          if (a.status === "approved") {
            await ctx.db.patch(a._id, { status: "submitted", updatedAt: Date.now() });
          }
        }
      }
    }
    const approver = actorUserId ?? snapshots[0]!.createdByUserId;
    if (approver) {
      await ctx.db.insert("approvals", {
        employeeId,
        performanceYearId: year._id,
        periodKey,
        approverUserId: approver,
        state: "reopened",
        reason,
        priorScoreSnapshotId: undefined,
        createdAt: Date.now(),
      });
    }
  }
  await recordAudit(ctx, {
    entityType: "scoreSnapshot",
    entityId: `${employeeId}:${periodKey}`,
    action: "recall_period_approval",
    actorUserId,
    reason,
    before: { employeeId, periodKey, snapshotsDeleted: snapshots.length },
  });
  return { snapshotsDeleted: snapshots.length, measurementsReopened };
}

/**
 * Admin hard-delete of a period's submission: every non-locked activity for
 * the (KPI, period) is removed — the records are shared, so they disappear
 * from the employee's side too — the provisional measurement is recomputed
 * (and removed when nothing counted remains), everything is audit-logged with
 * the full former payload, and the employee is notified with the reason.
 * Works after approval too: the period approval is recalled automatically
 * first (all snapshots cleared), so the frozen score never outlives its data.
 */
export const deleteSubmission = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    reason: v.string(),
  },
  returns: v.object({ deleted: v.number(), evidenceDeleted: v.number() }),
  handler: async (ctx, { kpiAssignmentId, periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["system_admin", "kpi_admin"]);
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new ConvexError("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);
    const cleanReason = reason.trim();
    if (!cleanReason)
      throw new ConvexError("A reason is required to delete a submission.");

    // Approved period? Recall the approval first — automatically.
    await reopenApprovedPeriod(
      ctx,
      assignment.employeeId,
      periodKey,
      `Submission deleted: ${cleanReason}`,
      user._id,
    );

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", kpiAssignmentId).eq("periodKey", periodKey),
      )
      .take(500);
    let deleted = 0;
    for (const a of activities) {
      if (a.status === "locked") continue;
      await recordAudit(ctx, {
        entityType: "activity",
        entityId: a._id,
        action: "delete_submission_activity",
        actorUserId: user._id,
        reason: cleanReason,
        before: { ...a },
      });
      await ctx.db.delete(a._id);
      deleted++;
    }
    if (deleted === 0) {
      throw new ConvexError("No deletable activities for this KPI and period.");
    }

    // The attached evidence goes with the submission: soft-delete every active
    // item on the KPI (same semantics as Evidence Centre deletion — the blob
    // is removed, the record is tombstoned; legal holds are never touched).
    const evidence = await ctx.db
      .query("evidenceFiles")
      .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", kpiAssignmentId))
      .take(500);
    let evidenceDeleted = 0;
    for (const e of evidence) {
      if (e.retentionState !== "active") continue;
      if (e.storageId) await ctx.storage.delete(e.storageId);
      await ctx.db.patch(e._id, { retentionState: "deleted", storageId: undefined });
      await recordAudit(ctx, {
        entityType: "evidenceFile",
        entityId: e._id,
        action: "delete_submission_evidence",
        actorUserId: user._id,
        reason: cleanReason,
        before: {
          title: e.title,
          originalFilename: e.originalFilename,
          reviewStatus: e.reviewStatus,
          kpiAssignmentId: e.kpiAssignmentId,
        },
      });
      evidenceDeleted++;
    }

    // Evidence gates may change on every period of this KPI — recompute all.
    const measurements = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", kpiAssignmentId))
      .take(500);
    const periods = new Set(measurements.map((m) => m.periodKey));
    periods.add(periodKey);
    for (const pk of periods) {
      await recomputeMeasurement(ctx, assignment, pk);
    }

    // Notify the employee — same channel as approval/rejection decisions.
    const adminName = await resolveDisplayName(ctx, user);
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", assignment.employeeId))
      .take(10);
    const notices = [];
    for (const target of linked) {
      if (!target.email || target.isActive === false || target._id === user._id) continue;
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Your ${periodKey} submission was deleted — ${assignment.objective.slice(0, 80)}`,
        intro: `*${adminName}* deleted your ${periodKey} submission (${deleted} ${deleted === 1 ? "entry" : "entries"}${evidenceDeleted > 0 ? ` and ${evidenceDeleted} evidence item${evidenceDeleted === 1 ? "" : "s"}` : ""}) for “${assignment.objective.slice(0, 120)}”. If work for this period still needs to be recorded, please capture it again.`,
        panelTitle: "Submission deleted",
        rows: [
          { label: "KPI objective", value: assignment.objective.slice(0, 200) },
          { label: "Period", value: periodKey },
          { label: "Entries removed", value: String(deleted), strong: true },
          { label: "Evidence removed", value: String(evidenceDeleted) },
          { label: "Reason", value: cleanReason.slice(0, 500) },
        ],
        ctaLabel: "Open Activity Capture",
        ctaPath: "/activities",
        inAppTitle: `${periodKey} submission deleted — ${assignment.objective.slice(0, 80)}`,
        inAppBody: `${adminName}: ${cleanReason.slice(0, 180)}`,
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "activity",
        entityId: `${kpiAssignmentId}:${periodKey}`,
        auditAction: "submission_deleted_notice",
        notices,
      });
    }
    return { deleted, evidenceDeleted };
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
    if (!assignment) throw new ConvexError("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);
    const cleanReason = reason.trim();
    if (!cleanReason)
      throw new ConvexError("A reason is required to reject a submission.");

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
      throw new ConvexError(
        "Nothing left to reject — this submission was already rejected (or deleted). The entries are back with the employee; the row clears once measurements recompute.",
      );
    }

    // Returned entries no longer count — the provisional measurement recomputes
    // (and disappears when nothing counted remains), so the queue reflects the
    // rejection immediately.
    await recomputeMeasurement(ctx, assignment, periodKey);

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

/**
 * Recall a rejection made in error: the returned (`needs_changes`) entries go
 * back to `submitted`, the measurement recomputes, and the employee is told to
 * disregard the earlier rejection.
 */
export const recallRejection = mutation({
  args: { kpiAssignmentId: v.id("kpiAssignments"), periodKey: v.string() },
  returns: v.object({ restored: v.number() }),
  handler: async (ctx, { kpiAssignmentId, periodKey }) => {
    const { user } = await requireRole(ctx, ["manager", "kpi_admin", "system_admin"]);
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new ConvexError("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);

    const activities = await ctx.db
      .query("activities")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", kpiAssignmentId).eq("periodKey", periodKey),
      )
      .take(200);
    let restored = 0;
    for (const a of activities) {
      if (a.status !== "needs_changes") continue;
      await ctx.db.patch(a._id, {
        status: "submitted",
        updatedByUserId: user._id,
        updatedAt: Date.now(),
      });
      restored++;
    }
    if (restored === 0) {
      throw new ConvexError(
        "Nothing to recall — no returned entries for this KPI and period.",
      );
    }
    await recomputeMeasurement(ctx, assignment, periodKey);

    await recordAudit(ctx, {
      entityType: "kpiAssignment",
      entityId: kpiAssignmentId,
      action: "recall_rejection",
      actorUserId: user._id,
      after: { periodKey, activitiesRestored: restored },
    });

    const reviewerName = await resolveDisplayName(ctx, user);
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", assignment.employeeId))
      .take(10);
    const notices = [];
    for (const target of linked) {
      if (!target.email || target.isActive === false || target._id === user._id) continue;
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Please disregard the rejection — ${periodKey} submission restored`,
        intro: `*${reviewerName}* recalled the earlier rejection of your ${periodKey} submission for “${assignment.objective.slice(0, 120)}”. Your entries are back in review — no action is needed.`,
        panelTitle: "Rejection recalled",
        rows: [
          { label: "KPI objective", value: assignment.objective.slice(0, 200) },
          { label: "Period", value: periodKey },
          { label: "Entries restored", value: String(restored), strong: true },
        ],
        ctaLabel: "Open the KPI",
        ctaPath: `/kpi/${kpiAssignmentId}`,
        inAppTitle: `Rejection recalled — ${periodKey}`,
        inAppBody: `${reviewerName} restored your submission; no action needed.`,
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "kpiAssignment",
        entityId: kpiAssignmentId,
        auditAction: "rejection_recalled",
        notices,
      });
    }
    return { restored };
  },
});

/**
 * Recall a period approval made in error: the latest frozen snapshot is
 * removed, the period's measurements return to provisional (back into the
 * review queue), a "reopened" approvals record keeps the trail, and the
 * employee is notified.
 */
export const recallPeriodApproval = mutation({
  args: {
    employeeId: v.id("employees"),
    periodKey: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({ measurementsReopened: v.number() }),
  handler: async (ctx, { employeeId, periodKey, reason }) => {
    const { user } = await requireRole(ctx, ["manager", "kpi_admin", "system_admin"]);
    await assertEmployeeReadScope(ctx, employeeId);
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) throw new ConvexError("Performance year not seeded");

    const snapshots = await ctx.db
      .query("scoreSnapshots")
      .withIndex("by_scope_period", (q) =>
        q.eq("scope", "individual").eq("scopeRef", employeeId).eq("periodKey", periodKey),
      )
      .take(50);
    const latest = snapshots.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) {
      throw new ConvexError(
        "No approved snapshot to recall for this employee and period.",
      );
    }
    await ctx.db.delete(latest._id);

    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", employeeId).eq("performanceYearId", year._id),
      )
      .collect();
    let measurementsReopened = 0;
    for (const assignment of assignments) {
      const lookupKey = cadencePeriodKey(assignment.frequency as Frequency, periodKey);
      const m = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", assignment._id).eq("periodKey", lookupKey),
        )
        .first();
      if (m && !m.isProvisional) {
        await ctx.db.patch(m._id, { isProvisional: true });
        measurementsReopened++;
        // Mirror of approval: the employee's approved entries return to
        // "submitted" so their side shows the period is under review again.
        const acts = await ctx.db
          .query("activities")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignment._id).eq("periodKey", lookupKey),
          )
          .take(500);
        for (const a of acts) {
          if (a.status === "approved") {
            await ctx.db.patch(a._id, { status: "submitted", updatedAt: Date.now() });
          }
        }
      }
    }

    await ctx.db.insert("approvals", {
      employeeId,
      performanceYearId: year._id,
      periodKey,
      approverUserId: user._id,
      state: "reopened",
      reason: reason ?? "Approval recalled",
      priorScoreSnapshotId: undefined,
      createdAt: Date.now(),
    });

    await recordAudit(ctx, {
      entityType: "scoreSnapshot",
      entityId: latest._id,
      action: "recall_period_approval",
      actorUserId: user._id,
      reason,
      before: {
        employeeId,
        periodKey,
        assignedWeightScore: latest.assignedWeightScore,
        configuredWeight: latest.configuredWeight,
      },
    });

    const approverName = await resolveDisplayName(ctx, user);
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
      .take(10);
    const notices = [];
    for (const target of linked) {
      if (!target.email || target.isActive === false || target._id === user._id) continue;
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Your ${periodKey} approval was recalled`,
        intro: `*${approverName}* recalled the approval of your ${periodKey} scorecard${reason ? ` (“${reason.slice(0, 140)}”)` : ""}. Your scores are provisional again and will be re-reviewed.`,
        panelTitle: "Approval recalled",
        rows: [
          { label: "Period", value: periodKey },
          ...(reason ? [{ label: "Reason", value: reason.slice(0, 500) }] : []),
        ],
        ctaLabel: "Open your scorecard",
        ctaPath: "/profile",
        inAppTitle: `${periodKey} approval recalled`,
        inAppBody: reason ? reason.slice(0, 180) : "Scores are provisional again.",
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "scoreSnapshot",
        entityId: `${employeeId}:${periodKey}`,
        auditAction: "period_approval_recalled",
        notices,
      });
    }
    return { measurementsReopened };
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
    if (!year) throw new ConvexError("Performance year not seeded");

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
      throw new ConvexError(`Cannot approve — resolve first: ${blockers.join("; ")}`);
    }

    // Finalize measurements (no longer provisional) and lock them. The
    // employee's counted entries flip to "approved" so the decision is
    // immediately visible on their side too.
    for (const it of items) {
      if (!it.measurementId) continue;
      await ctx.db.patch(it.measurementId as never, { isProvisional: false });
      const lookupKey = cadencePeriodKey(it.assignment.frequency as Frequency, periodKey);
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", it.assignment._id).eq("periodKey", lookupKey),
        )
        .take(500);
      for (const a of acts) {
        if (["submitted", "verified"].includes(a.status)) {
          await ctx.db.patch(a._id, { status: "approved", updatedAt: Date.now() });
        }
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
