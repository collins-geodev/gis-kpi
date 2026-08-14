/**
 * Scheduled maintenance: overdue-period flagging + reviewer/employee reminders.
 * Idempotent and bounded. Wired via convex/crons.ts.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { recordAudit } from "./audit";

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
