/**
 * Self-service password change + the System Admin kill switch.
 *
 * Design (deliberately NOT approval-gated): the proof of identity is the
 * CURRENT password, verified server-side. On success the new credential takes
 * effect immediately, every session is terminated (the user — or anyone holding
 * a stolen session — must sign in again with the new password), and every
 * System Admin plus the user themselves is notified in-app and by email, with
 * an audit row. Admins additionally get `adminForceSignOut` to kill a
 * suspicious account's sessions on sight.
 */
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import {
  getAuthUserId,
  retrieveAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { adminUsers, resolveDisplayName } from "./emails";
import { requireRole } from "./authz";

const MIN_PASSWORD_LENGTH = 8;

function lagosNow(): string {
  return `${new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} (Lagos)`;
}

/** Everything the change-password action needs in one transactional read. */
export const getChangeContext = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      selfName: v.string(),
      admins: v.array(
        v.object({
          userId: v.id("users"),
          email: v.string(),
          name: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user?.email) return null;
    const selfName = await resolveDisplayName(ctx, user);
    const admins = [];
    for (const a of await adminUsers(ctx)) {
      if (a._id === userId) continue; // the actor gets the "self" notice
      admins.push({
        userId: a._id,
        email: a.email!,
        name: await resolveDisplayName(ctx, a),
      });
    }
    return { email: user.email, selfName, admins };
  },
});

/**
 * Change the signed-in user's password. Requires the current password; takes
 * effect immediately; terminates every session; notifies the user + all
 * System Admins (in-app always, email when configured); audit-logged.
 */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You must be signed in.");

    // Brute-force guard: 5 attempts per 15 minutes, counted per user.
    const gate = await ctx.runMutation(internal.rateLimit.hitForUser, {
      endpoint: "password_change",
      userId,
    });
    if (!gate.ok) {
      throw new ConvexError(
        `Too many password attempts — try again in ${Math.ceil(gate.retryAfterSeconds / 60)} minute(s).`,
      );
    }

    const info = await ctx.runQuery(internal.passwords.getChangeContext, { userId });
    if (!info) throw new ConvexError("This account has no password credential.");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ConvexError(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    if (newPassword === currentPassword) {
      throw new ConvexError("New password must be different from the current one.");
    }

    // Identity proof: the current password must verify against the stored hash.
    try {
      const found = await retrieveAccount(ctx, {
        provider: "password",
        account: { id: info.email, secret: currentPassword },
      });
      if (!found) throw new Error("no account");
    } catch {
      throw new ConvexError("Current password is incorrect.");
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: info.email, secret: newPassword },
    });

    // Everyone out — the new password is the only way back in.
    await invalidateSessions(ctx, { userId });

    const when = lagosNow();
    const notices = [
      {
        userId,
        email: info.email,
        recipientName: info.selfName,
        subject: "Your dashboard password was changed",
        intro:
          "Your GIS KPI Dashboard password was changed just now. Every session was signed out — sign in again with your new password. *If this wasn't you, contact your System Admin immediately.*",
        panelTitle: "Password change",
        rows: [
          { label: "Account", value: info.email },
          { label: "When", value: when },
          { label: "Sessions", value: "All signed out", strong: true },
        ],
        ctaLabel: "Sign in",
        ctaPath: "/signin",
        inAppTitle: "Your password was changed",
        inAppBody: "All sessions were signed out — sign in with the new password.",
      },
      ...info.admins.map((a) => ({
        userId: a.userId,
        email: a.email,
        recipientName: a.name,
        subject: `Password changed — ${info.selfName}`,
        intro: `*${info.selfName}* (${info.email}) changed their dashboard password. All of their sessions were terminated; they must sign in with the new password. If this looks suspicious, force a sign-out from Users & Organization and review the audit log.`,
        panelTitle: "Security notice",
        rows: [
          { label: "User", value: info.selfName, strong: true },
          { label: "Account", value: info.email },
          { label: "When", value: when },
        ],
        ctaLabel: "Open audit log",
        ctaPath: "/audit",
        inAppTitle: `Password changed — ${info.selfName}`,
        inAppBody: `${info.email} changed their password; all their sessions were signed out.`,
      })),
    ];

    await ctx.runAction(internal.emails.sendNotices, {
      entityType: "user",
      entityId: userId,
      auditAction: "password_changed",
      notices,
    });
    return null;
  },
});

/** Caller-role gate usable from an action. */
export const assertCallerIsSystemAdmin = internalQuery({
  args: {},
  returns: v.object({ actorId: v.id("users"), actorName: v.string() }),
  handler: async (ctx) => {
    const { user } = await requireRole(ctx, ["system_admin"]);
    return { actorId: user._id, actorName: await resolveDisplayName(ctx, user) };
  },
});

export const recordForceSignOut = internalMutation({
  args: {
    targetUserId: v.id("users"),
    actorId: v.id("users"),
    actorName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("notifications", {
      userId: args.targetUserId,
      kind: "force_sign_out",
      title: "You were signed out by an administrator",
      body: "All of your sessions were terminated. Sign in again to continue.",
      href: "/signin",
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      entityType: "user",
      entityId: args.targetUserId,
      action: "force_sign_out",
      actorUserId: args.actorId,
      reason: `Forced sign-out by ${args.actorName}`,
      at: now,
    });
    return null;
  },
});

/** System Admin kill switch: terminate every session of a user right now. */
export const adminForceSignOut = action({
  args: { targetUserId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { targetUserId }) => {
    let actor;
    try {
      actor = await ctx.runQuery(internal.passwords.assertCallerIsSystemAdmin, {});
    } catch {
      throw new ConvexError("Only a System Admin can force a sign-out.");
    }
    await invalidateSessions(ctx, { userId: targetUserId });
    await ctx.runMutation(internal.passwords.recordForceSignOut, {
      targetUserId,
      actorId: actor.actorId,
      actorName: actor.actorName,
    });
    return null;
  },
});
