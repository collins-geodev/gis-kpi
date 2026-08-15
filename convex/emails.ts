/**
 * Email notifications for KPI updates — sent to every System Admin and to the
 * person who logged the update, using the branded template in
 * lib/emailTemplate.ts via the Resend API.
 *
 * Config (Convex env):
 *   RESEND_API_KEY  — required to actually send; without it we skip sending
 *                     (in-app notifications are still created).
 *   EMAIL_FROM      — e.g. "GIS KPI Dashboard <kpi@yourdomain.com>".
 *                     Defaults to Resend's onboarding sender (test mode: only
 *                     delivers to the Resend account owner's address).
 *   DASHBOARD_URL   — CTA link base; defaults to the production site.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildKpiUpdateEmail } from "./lib/emailTemplate";
import { formatPercent } from "./lib/format";
import { STATUS_BAND_LABELS } from "./lib/types";

const vRecipient = v.object({
  email: v.string(),
  name: v.string(),
  userId: v.id("users"),
  variant: v.union(v.literal("admin"), v.literal("self")),
});

/** Gather everything the notification needs in one transactional read. */
export const getKpiUpdatePayload = internalQuery({
  args: { activityId: v.id("activities") },
  returns: v.union(
    v.null(),
    v.object({
      actorName: v.string(),
      employeeName: v.string(),
      employeeBusinessId: v.string(),
      objective: v.string(),
      activityTitle: v.string(),
      periodKey: v.string(),
      attainmentPct: v.string(),
      statusLabel: v.string(),
      kpiPath: v.string(),
      recipients: v.array(vRecipient),
    }),
  ),
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity) return null;
    const assignment = await ctx.db.get(activity.kpiAssignmentId);
    const employee = await ctx.db.get(activity.employeeId);
    if (!assignment || !employee) return null;
    const actor = await ctx.db.get(activity.createdByUserId);

    const measurement = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", assignment._id).eq("periodKey", activity.periodKey),
      )
      .first();

    const recipients: {
      email: string;
      name: string;
      userId: typeof activity.createdByUserId;
      variant: "admin" | "self";
    }[] = [];

    // The person who logged the update.
    if (actor?.email) {
      recipients.push({
        email: actor.email,
        name: actor.name ?? actor.email,
        userId: actor._id,
        variant: "self",
      });
    }

    // Every active System Admin (except the actor — they get the "self" mail).
    const adminAssignments = await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_role", (q) => q.eq("role", "system_admin"))
      .take(100);
    const seen = new Set(recipients.map((r) => r.email.toLowerCase()));
    for (const a of adminAssignments) {
      if (!a.isActive) continue;
      const admin = await ctx.db.get(a.userId);
      if (!admin?.email) continue;
      const key = admin.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        email: admin.email,
        name: admin.name ?? admin.email,
        userId: admin._id,
        variant: "admin",
      });
    }

    return {
      actorName: actor?.name ?? actor?.email ?? "A team member",
      employeeName: employee.displayName,
      employeeBusinessId: employee.employeeId,
      objective: assignment.objective,
      activityTitle: activity.title,
      periodKey: activity.periodKey,
      attainmentPct:
        measurement?.cappedAttainment != null
          ? formatPercent(measurement.cappedAttainment)
          : "—",
      statusLabel: measurement ? STATUS_BAND_LABELS[measurement.status] : "No Data",
      kpiPath: `/kpi/${assignment._id}`,
      recipients,
    };
  },
});

/** Record in-app notifications + an audit entry for the send. */
export const recordNotifications = internalMutation({
  args: {
    activityId: v.id("activities"),
    recipients: v.array(vRecipient),
    kpiPath: v.string(),
    activityTitle: v.string(),
    employeeName: v.string(),
    emailed: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const r of args.recipients) {
      await ctx.db.insert("notifications", {
        userId: r.userId,
        kind: "kpi_update",
        title:
          r.variant === "self"
            ? "Your KPI update was recorded"
            : `KPI update — ${args.employeeName}`,
        body: `${args.activityTitle} (${args.emailed ? "email sent" : "email pending setup"})`,
        href: args.kpiPath,
        createdAt: now,
      });
    }
    await ctx.db.insert("auditLogs", {
      entityType: "activity",
      entityId: args.activityId,
      action: args.emailed ? "email_notification_sent" : "email_notification_skipped",
      after: {
        recipients: args.recipients.map((r) => r.variant),
        reason: args.emailed ? undefined : "RESEND_API_KEY not configured",
      },
      at: now,
    });
    return null;
  },
});

/** Fire the notifications for one KPI-update activity (scheduled, best-effort). */
export const notifyKpiUpdate = internalAction({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const payload = await ctx.runQuery(internal.emails.getKpiUpdatePayload, {
      activityId,
    });
    if (!payload || payload.recipients.length === 0) return null;

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "GIS KPI Dashboard <onboarding@resend.dev>";
    const dashboardUrl = process.env.DASHBOARD_URL ?? "https://gis-kpi.vercel.app";
    let emailed = false;

    if (apiKey) {
      for (const r of payload.recipients) {
        const { subject, html, text } = buildKpiUpdateEmail({
          variant: r.variant,
          recipientName: r.name,
          actorName: payload.actorName,
          employeeName: payload.employeeName,
          employeeBusinessId: payload.employeeBusinessId,
          objective: payload.objective,
          activityTitle: payload.activityTitle,
          periodKey: payload.periodKey,
          attainmentPct: payload.attainmentPct,
          statusLabel: payload.statusLabel,
          dashboardUrl,
          kpiPath: payload.kpiPath,
        });
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from, to: [r.email], subject, html, text }),
          });
          if (res.ok) emailed = true;
          else console.error("Resend send failed", res.status, await res.text());
        } catch (err) {
          console.error("Resend send error", err);
        }
      }
    }

    await ctx.runMutation(internal.emails.recordNotifications, {
      activityId,
      recipients: payload.recipients,
      kpiPath: payload.kpiPath,
      activityTitle: payload.activityTitle,
      employeeName: payload.employeeName,
      emailed,
    });
    return null;
  },
});
