/**
 * Email notifications for KPI updates — sent to the whole team (every active
 * user with an app role, employees included) and to the person who logged
 * the update, using the branded template in lib/emailTemplate.ts via the
 * Resend API. Security-sensitive notices (password changes, malware flags)
 * stay System-Admin-only — they are the only ones who can act.
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
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { buildKpiUpdateEmail, buildNoticeEmail } from "./lib/emailTemplate";
import { formatPercent } from "./lib/format";
import { APP_ROLES, STATUS_BAND_LABELS, type AppRole } from "./lib/types";

/**
 * Friendly display name for greetings: profile name → linked roster name →
 * the local part of the email address (never the full address).
 */
export async function resolveDisplayName(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<string> {
  // Some accounts have their email stored as the profile name — a "name"
  // containing @ is not a greeting-worthy name, so fall through.
  const name = user.name?.trim();
  if (name && !name.includes("@")) return name;
  if (user.employeeId) {
    const emp = await ctx.db.get(user.employeeId);
    if (emp) return emp.displayName;
  }
  return (user.email ?? "there").split("@")[0]!;
}

/** Active users holding any of the given app roles, with an email, deduped. */
export async function usersWithRoles(
  ctx: QueryCtx,
  roles: readonly AppRole[],
): Promise<Doc<"users">[]> {
  const out: Doc<"users">[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    const rows = await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_role", (q) => q.eq("role", role))
      .take(100);
    for (const a of rows) {
      if (!a.isActive) continue;
      const u = await ctx.db.get(a.userId);
      if (!u?.email || u.isActive === false) continue;
      const key = u.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}

/** Active System Admin users with an email, deduped. */
export async function adminUsers(ctx: QueryCtx): Promise<Doc<"users">[]> {
  return usersWithRoles(ctx, ["system_admin"]);
}

/**
 * The full-team notification audience: every active user holding ANY app
 * role — employees included. KPI updates, evidence submissions, and deadline
 * escalations fan out to all of them, so the whole team sees the work as it
 * happens. Security notices (password changes, malware flags) deliberately
 * stay with adminUsers — only System Admins can act on those.
 */
export async function teamUsers(ctx: QueryCtx): Promise<Doc<"users">[]> {
  return usersWithRoles(ctx, APP_ROLES);
}

const vRecipient = v.object({
  email: v.string(),
  name: v.string(),
  userId: v.id("users"),
  variant: v.union(v.literal("admin"), v.literal("self"), v.literal("employee")),
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
      variant: "admin" | "self" | "employee";
    }[] = [];

    // The person who logged the update (greeted by name, never raw email).
    if (actor?.email) {
      recipients.push({
        email: actor.email,
        name: await resolveDisplayName(ctx, actor),
        userId: actor._id,
        variant: "self",
      });
    }
    const seen = new Set(recipients.map((r) => r.email.toLowerCase()));

    // The employee the KPI belongs to — emailed even when someone else
    // (an admin backfilling, a manager) logged the update on their behalf.
    const employeeUser = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", activity.employeeId))
      .first();
    if (
      employeeUser?.email &&
      employeeUser.isActive !== false &&
      !seen.has(employeeUser.email.toLowerCase())
    ) {
      seen.add(employeeUser.email.toLowerCase());
      recipients.push({
        email: employeeUser.email,
        name: await resolveDisplayName(ctx, employeeUser),
        userId: employeeUser._id,
        variant: "employee",
      });
    }

    // The whole team (except anyone already covered above).
    for (const admin of await teamUsers(ctx)) {
      const key = admin.email!.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({
        email: admin.email!,
        name: await resolveDisplayName(ctx, admin),
        userId: admin._id,
        variant: "admin",
      });
    }

    return {
      actorName: actor ? await resolveDisplayName(ctx, actor) : "A team member",
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

/** Per-recipient delivery outcome, kept in the audit log for diagnosis. */
const vDeliveryResult = v.object({
  email: v.string(),
  ok: v.boolean(),
  status: v.number(), // HTTP status from Resend; 0 = not attempted (no API key)
  detail: v.optional(v.string()),
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
    results: v.optional(v.array(vDeliveryResult)),
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
            : r.variant === "employee"
              ? "A KPI update was logged for you"
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
        deliveries: args.results,
      },
      at: now,
    });
    return null;
  },
});

const vNotice = v.object({
  userId: v.id("users"),
  email: v.string(),
  recipientName: v.string(),
  subject: v.string(),
  intro: v.string(),
  panelTitle: v.string(),
  rows: v.array(
    v.object({ label: v.string(), value: v.string(), strong: v.optional(v.boolean()) }),
  ),
  ctaLabel: v.string(),
  ctaPath: v.string(),
  inAppTitle: v.string(),
  inAppBody: v.string(),
});

/** In-app notifications + one audit row for a batch of notices. */
export const recordNoticeResults = internalMutation({
  args: {
    entityType: v.string(),
    entityId: v.string(),
    auditAction: v.string(),
    emailed: v.boolean(),
    recipients: v.array(
      v.object({
        userId: v.id("users"),
        title: v.string(),
        body: v.string(),
        href: v.string(),
      }),
    ),
    results: v.optional(v.array(vDeliveryResult)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const r of args.recipients) {
      await ctx.db.insert("notifications", {
        userId: r.userId,
        kind: args.auditAction,
        title: r.title,
        body: `${r.body}${args.emailed ? "" : " (email pending setup)"}`,
        href: r.href,
        createdAt: now,
      });
    }
    await ctx.db.insert("auditLogs", {
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.emailed
        ? `${args.auditAction}_email_sent`
        : `${args.auditAction}_email_skipped`,
      after: { recipients: args.recipients.length, deliveries: args.results },
      at: now,
    });
    return null;
  },
});

/**
 * Send a batch of branded notice emails (evidence submitted, review decisions,
 * period approvals) and record in-app notifications + an audit entry. Sending
 * is skipped gracefully until RESEND_API_KEY is configured.
 */
export const sendNotices = internalAction({
  args: {
    entityType: v.string(),
    entityId: v.string(),
    auditAction: v.string(),
    notices: v.array(vNotice),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.notices.length === 0) return null;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "GIS KPI Dashboard <onboarding@resend.dev>";
    const dashboardUrl = process.env.DASHBOARD_URL ?? "https://gis-kpi.vercel.app";
    let emailed = false;

    const results: { email: string; ok: boolean; status: number; detail?: string }[] = [];
    if (apiKey) {
      for (const n of args.notices) {
        const { subject, html, text } = buildNoticeEmail({
          recipientName: n.recipientName,
          subject: n.subject,
          intro: n.intro,
          panelTitle: n.panelTitle,
          rows: n.rows,
          ctaLabel: n.ctaLabel,
          ctaPath: n.ctaPath,
          dashboardUrl,
        });
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from, to: [n.email], subject, html, text }),
          });
          if (res.ok) {
            emailed = true;
            results.push({ email: n.email, ok: true, status: res.status });
          } else {
            const detail = (await res.text()).slice(0, 300);
            console.error("Resend send failed", res.status, detail);
            results.push({ email: n.email, ok: false, status: res.status, detail });
          }
        } catch (err) {
          console.error("Resend send error", err);
          results.push({
            email: n.email,
            ok: false,
            status: -1,
            detail: err instanceof Error ? err.message.slice(0, 300) : "network error",
          });
        }
      }
    } else {
      for (const n of args.notices) {
        results.push({
          email: n.email,
          ok: false,
          status: 0,
          detail: "RESEND_API_KEY not configured",
        });
      }
    }

    await ctx.runMutation(internal.emails.recordNoticeResults, {
      entityType: args.entityType,
      entityId: args.entityId,
      auditAction: args.auditAction,
      emailed,
      results,
      recipients: args.notices.map((n) => ({
        userId: n.userId,
        title: n.inAppTitle,
        body: n.inAppBody,
        href: n.ctaPath,
      })),
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
    const results: { email: string; ok: boolean; status: number; detail?: string }[] = [];

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
          if (res.ok) {
            emailed = true;
            results.push({ email: r.email, ok: true, status: res.status });
          } else {
            const detail = (await res.text()).slice(0, 300);
            console.error("Resend send failed", res.status, detail);
            results.push({ email: r.email, ok: false, status: res.status, detail });
          }
        } catch (err) {
          console.error("Resend send error", err);
          results.push({
            email: r.email,
            ok: false,
            status: -1,
            detail: err instanceof Error ? err.message.slice(0, 300) : "network error",
          });
        }
      }
    } else {
      for (const r of payload.recipients) {
        results.push({
          email: r.email,
          ok: false,
          status: 0,
          detail: "RESEND_API_KEY not configured",
        });
      }
    }

    await ctx.runMutation(internal.emails.recordNotifications, {
      activityId,
      recipients: payload.recipients,
      kpiPath: payload.kpiPath,
      activityTitle: payload.activityTitle,
      employeeName: payload.employeeName,
      emailed,
      results,
    });
    return null;
  },
});
