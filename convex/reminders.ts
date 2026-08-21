/**
 * Scheduled maintenance: overdue-period flagging + reviewer/employee reminders.
 * Idempotent and bounded. Wired via convex/crons.ts.
 */
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { recordAudit } from "./audit";
import { oversightUsers, resolveDisplayName } from "./emails";
import { captureGrainForFrequency } from "./lib/periods";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";

/** Move open tracking periods past their due date into a grace state. */
export const scanOverdue = internalMutation({
  args: {},
  returns: v.object({ flagged: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const open = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_status_due", (q) => q.eq("status", "open"))
      .take(500);
    let flagged = 0;
    for (const p of open) {
      if (p.dueAt < now) {
        await ctx.db.patch(p._id, { status: "grace" });
        flagged++;
      }
    }
    if (flagged > 0) {
      await recordAudit(ctx, {
        entityType: "trackingPeriod",
        entityId: "scan",
        action: "flag_overdue",
        after: { flagged, at: now },
      });
    }
    return { flagged };
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 7;

/** Grace periods whose window has fully elapsed become closed for capture. */
export const closeExpiredGracePeriods = internalMutation({
  args: {},
  returns: v.object({ closed: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const grace = await ctx.db
      .query("trackingPeriods")
      .withIndex("by_status_due", (q) => q.eq("status", "grace"))
      .take(500);
    let closed = 0;
    for (const p of grace) {
      if (p.dueAt + GRACE_DAYS * DAY_MS < now) {
        await ctx.db.patch(p._id, { status: "closed" });
        closed++;
      }
    }
    if (closed > 0) {
      await recordAudit(ctx, {
        entityType: "trackingPeriod",
        entityId: "scan",
        action: "close_expired_grace",
        after: { closed, at: now },
      });
    }
    return { closed };
  },
});

/**
 * Submission reminder ladder. For every period approaching or past its due
 * date, employees with missing KPI data are emailed/notified:
 *   due_soon — within 3 days of the deadline
 *   overdue  — once the deadline passes (plus a one-time defaulter escalation
 *              to every System Admin)
 * Idempotent via reminderJobs dedupe keys; `now` is injectable for tests.
 */
export const scanSubmissionReminders = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ notified: v.number(), escalations: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) return { notified: 0, escalations: 0 };

    const periods = (await ctx.db.query("trackingPeriods").take(500)).filter((p) => {
      if (!["open", "grace"].includes(p.status)) return false;
      const stage =
        now > p.dueAt ? "overdue" : p.dueAt - now <= 3 * DAY_MS ? "due_soon" : null;
      return stage !== null && p.startAt <= now;
    });

    const employees = (await ctx.db.query("employees").take(500)).filter(
      (e) => e.isActive,
    );
    let notified = 0;
    let escalations = 0;

    for (const period of periods) {
      const stage = now > period.dueAt ? "overdue" : "due_soon";
      const defaulters: { name: string; missing: number }[] = [];
      const notices = [];

      for (const emp of employees) {
        const assignments = await ctx.db
          .query("kpiAssignments")
          .withIndex("by_employee_year", (q) =>
            q.eq("employeeId", emp._id).eq("performanceYearId", year._id),
          )
          .collect();
        const relevant = assignments.filter(
          (a) => captureGrainForFrequency(a.frequency as Frequency) === period.grain,
        );
        if (relevant.length === 0) continue;

        const missing: string[] = [];
        for (const a of relevant) {
          const m = await ctx.db
            .query("kpiMeasurements")
            .withIndex("by_assignment_period", (q) =>
              q.eq("kpiAssignmentId", a._id).eq("periodKey", period.periodKey),
            )
            .first();
          if (!m?.hasData) missing.push(a.objective);
        }
        if (missing.length === 0) continue;
        defaulters.push({ name: emp.displayName, missing: missing.length });

        const linked = await ctx.db
          .query("users")
          .withIndex("by_employee", (q) => q.eq("employeeId", emp._id))
          .take(10);
        for (const target of linked) {
          if (!target.email || target.isActive === false) continue;
          const dedupeKey = `submission:${stage}:${period.periodKey}:${target._id}`;
          const existing = await ctx.db
            .query("reminderJobs")
            .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
            .first();
          if (existing) continue;
          await ctx.db.insert("reminderJobs", {
            kind: `submission_${stage}`,
            periodKey: period.periodKey,
            targetUserId: target._id,
            scheduledFor: now,
            state: "completed",
            lastRunAt: now,
            attempts: 1,
            dedupeKey,
          });
          notices.push({
            userId: target._id,
            email: target.email,
            recipientName: await resolveDisplayName(ctx, target),
            subject:
              stage === "due_soon"
                ? `Reminder: ${missing.length} KPI(s) due for ${period.label}`
                : `Overdue: ${missing.length} KPI(s) not submitted for ${period.label}`,
            intro:
              stage === "due_soon"
                ? `The submission window for *${period.label}* closes soon. You still have *${missing.length} KPI(s)* without any captured activity — log them before the deadline so your entries count as on time.`
                : `The *${period.label}* deadline has passed and *${missing.length} KPI(s)* still have no captured activity. Entries logged now are flagged late; once the grace window ends the period closes entirely.`,
            panelTitle: "Outstanding KPIs",
            rows: missing
              .slice(0, 5)
              .map((o, i) => ({ label: `KPI ${i + 1}`, value: o })),
            ctaLabel: "Log your activities",
            ctaPath: "/activities",
            inAppTitle:
              stage === "due_soon"
                ? `${missing.length} KPI(s) due — ${period.label}`
                : `Overdue: ${missing.length} KPI(s) — ${period.label}`,
            inAppBody: missing[0]!.slice(0, 160),
          });
          notified++;
        }
      }

      if (notices.length > 0) {
        await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
          entityType: "trackingPeriod",
          entityId: period.periodKey,
          auditAction: `submission_${stage}`,
          notices,
        });
      }

      // One-time defaulter escalation to System Admins once a period is overdue.
      if (stage === "overdue" && defaulters.length > 0) {
        const dedupeKey = `submission:escalation:${period.periodKey}`;
        const existing = await ctx.db
          .query("reminderJobs")
          .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
          .first();
        if (!existing) {
          await ctx.db.insert("reminderJobs", {
            kind: "submission_escalation",
            periodKey: period.periodKey,
            scheduledFor: now,
            state: "completed",
            lastRunAt: now,
            attempts: 1,
            dedupeKey,
          });
          const adminNotices = [];
          for (const admin of await oversightUsers(ctx)) {
            adminNotices.push({
              userId: admin._id,
              email: admin.email!,
              recipientName: await resolveDisplayName(ctx, admin),
              subject: `${defaulters.length} employee(s) missed the ${period.label} KPI deadline`,
              intro: `The *${period.label}* submission deadline has passed with outstanding KPIs. Review the compliance board and follow up — the period closes for self-service capture ${GRACE_DAYS} days after the due date.`,
              panelTitle: "Defaulters",
              rows: defaulters
                .slice(0, 10)
                .map((d) => ({ label: d.name, value: `${d.missing} KPI(s) missing` })),
              ctaLabel: "Open the compliance board",
              ctaPath: "/compliance",
              inAppTitle: `${defaulters.length} defaulter(s) — ${period.label}`,
              inAppBody: defaulters
                .map((d) => d.name)
                .join(", ")
                .slice(0, 180),
            });
            escalations++;
          }
          if (adminNotices.length > 0) {
            await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
              entityType: "trackingPeriod",
              entityId: period.periodKey,
              auditAction: "submission_escalation",
              notices: adminNotices,
            });
          }
        }
      }
    }

    return { notified, escalations };
  },
});

/** Notify reviewers of provisional measurements awaiting review (bounded). */
export const notifyReviewBacklog = internalMutation({
  args: {},
  returns: v.object({ notified: v.number() }),
  handler: async (ctx) => {
    const provisional = (await ctx.db.query("kpiMeasurements").take(2000)).filter(
      (m) => m.isProvisional && m.hasData,
    );
    if (provisional.length === 0) return { notified: 0 };

    const reviewers = (
      await ctx.db
        .query("userRoleAssignments")
        .withIndex("by_role", (q) => q.eq("role", "manager"))
        .take(200)
    ).filter((r) => r.isActive);

    let notified = 0;
    const now = Date.now();
    for (const r of reviewers) {
      // Idempotent-ish: skip if a fresh unread backlog notice already exists.
      const existing = await ctx.db
        .query("notifications")
        .withIndex("by_user_unread", (q) =>
          q.eq("userId", r.userId).eq("readAt", undefined),
        )
        .take(20);
      if (existing.some((n) => n.kind === "review_backlog")) continue;
      await ctx.db.insert("notifications", {
        userId: r.userId,
        kind: "review_backlog",
        title: "Measurements awaiting review",
        body: `${provisional.length} provisional measurement(s) need review/approval.`,
        href: "/review",
        createdAt: now,
      });
      notified++;
    }
    return { notified };
  },
});
