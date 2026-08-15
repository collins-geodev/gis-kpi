/**
 * Identity + application-role management.
 *
 * Authentication (Convex Auth) is separate from authorization: a freshly
 * signed-up user has no roles and therefore no access. The very first signed-in
 * user may claim System Admin via `bootstrapFirstAdmin` (only while no admin
 * exists, and — if configured — only for ADMIN_BOOTSTRAP_EMAIL). Thereafter an
 * admin grants roles.
 */
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { vAppRole } from "./validators";
import { getCurrentUser, getUserRoles, requireRole, requireUser } from "./authz";
import { recordAudit } from "./audit";

export const currentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      avatarUrl: v.union(v.string(), v.null()),
      isActive: v.boolean(),
      roles: v.array(vAppRole),
      employee: v.union(
        v.null(),
        v.object({
          id: v.id("employees"),
          employeeId: v.string(),
          displayName: v.string(),
          jobRole: v.string(),
          canonicalLocation: v.string(),
        }),
      ),
      systemAdminExists: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const roles = await getUserRoles(ctx, user._id);
    let employee = null;
    if (user.employeeId) {
      const emp = await ctx.db.get(user.employeeId);
      if (emp) {
        employee = {
          id: emp._id,
          employeeId: emp.employeeId,
          displayName: emp.displayName,
          jobRole: emp.jobRole,
          canonicalLocation: emp.canonicalLocation,
        };
      }
    }
    const anAdmin = await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_role", (q) => q.eq("role", "system_admin"))
      .first();
    return {
      userId: user._id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarStorageId
        ? await ctx.storage.getUrl(user.avatarStorageId)
        : null,
      isActive: user.isActive ?? true,
      roles,
      employee,
      systemAdminExists: anAdmin !== null,
    };
  },
});

export const bootstrapFirstAdmin = mutation({
  args: {},
  returns: v.object({ granted: v.boolean() }),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existingAdmin = await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_role", (q) => q.eq("role", "system_admin"))
      .first();
    if (existingAdmin) {
      throw new Error("A System Admin already exists. Ask an admin to grant your role.");
    }
    const allowlist = process.env.ADMIN_BOOTSTRAP_EMAIL;
    if (allowlist && user.email && user.email.toLowerCase() !== allowlist.toLowerCase()) {
      throw new Error("This account is not the configured bootstrap admin.");
    }
    await ctx.db.insert("userRoleAssignments", {
      userId: user._id,
      role: "system_admin",
      grantedAt: Date.now(),
      isActive: true,
    });
    if (user.isActive !== true) await ctx.db.patch(user._id, { isActive: true });
    await recordAudit(ctx, {
      entityType: "user",
      entityId: user._id,
      action: "bootstrap_admin",
      actorUserId: user._id,
      after: { role: "system_admin" },
    });
    return { granted: true };
  },
});

export const grantRole = mutation({
  args: {
    userId: v.id("users"),
    role: vAppRole,
    scopeLocationId: v.optional(v.id("locations")),
    scopeJobRole: v.optional(v.string()),
    scopeEmployeeIds: v.optional(v.array(v.id("employees"))),
  },
  returns: v.id("userRoleAssignments"),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    const id = await ctx.db.insert("userRoleAssignments", {
      userId: args.userId,
      role: args.role,
      scopeLocationId: args.scopeLocationId,
      scopeJobRole: args.scopeJobRole,
      scopeEmployeeIds: args.scopeEmployeeIds,
      grantedByUserId: actor._id,
      grantedAt: Date.now(),
      isActive: true,
    });
    await recordAudit(ctx, {
      entityType: "userRoleAssignment",
      entityId: id,
      action: "grant_role",
      actorUserId: actor._id,
      after: { userId: args.userId, role: args.role },
    });
    return id;
  },
});

/**
 * True when at least one OTHER active user besides `exceptUserId` holds an
 * active System Admin role — the lock-out guard for revoke/deactivate.
 */
async function anotherActiveAdminExists(
  ctx: Parameters<typeof requireRole>[0],
  exceptUserId: string,
): Promise<boolean> {
  const admins = await ctx.db
    .query("userRoleAssignments")
    .withIndex("by_role", (q) => q.eq("role", "system_admin"))
    .take(200);
  for (const a of admins) {
    if (!a.isActive || a.userId === exceptUserId) continue;
    const holder = await ctx.db.get(a.userId);
    if (holder && holder.isActive !== false) return true;
  }
  return false;
}

/** Revoke every active assignment of `role` from a user (System Admin only). */
export const revokeRole = mutation({
  args: { userId: v.id("users"), role: vAppRole },
  returns: v.object({ revoked: v.number() }),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    if (args.role === "system_admin") {
      const stillCovered = await anotherActiveAdminExists(ctx, args.userId);
      if (!stillCovered) {
        throw new Error(
          "Cannot revoke the last active System Admin — grant the role to someone else first.",
        );
      }
    }
    const rows = await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    let revoked = 0;
    for (const r of rows) {
      if (r.role !== args.role || !r.isActive) continue;
      await ctx.db.patch(r._id, { isActive: false });
      revoked++;
      await recordAudit(ctx, {
        entityType: "userRoleAssignment",
        entityId: r._id,
        action: "revoke_role",
        actorUserId: actor._id,
        before: { userId: args.userId, role: args.role, isActive: true },
        after: { isActive: false },
      });
    }
    return { revoked };
  },
});

/** Deactivate or reactivate a user account (System Admin only). */
export const setUserActive = mutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    if (!args.isActive) {
      if (target._id === actor._id) {
        throw new Error("You cannot deactivate your own account.");
      }
      const targetRoles = await getUserRoles(ctx, target._id);
      if (targetRoles.includes("system_admin")) {
        const stillCovered = await anotherActiveAdminExists(ctx, target._id);
        if (!stillCovered) {
          throw new Error("Cannot deactivate the last active System Admin.");
        }
      }
    }
    await ctx.db.patch(args.userId, { isActive: args.isActive });
    await recordAudit(ctx, {
      entityType: "user",
      entityId: args.userId,
      action: args.isActive ? "reactivate_user" : "deactivate_user",
      actorUserId: actor._id,
      before: { isActive: target.isActive ?? true },
      after: { isActive: args.isActive },
    });
    return null;
  },
});

export const linkUserToEmployee = mutation({
  args: { userId: v.id("users"), employeeId: v.id("employees") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const before = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, { employeeId: args.employeeId });
    await recordAudit(ctx, {
      entityType: "user",
      entityId: args.userId,
      action: "link_employee",
      actorUserId: actor._id,
      before: { employeeId: before?.employeeId },
      after: { employeeId: args.employeeId },
    });
    return null;
  },
});

/** Wipe every piece of captured KPI data for one roster employee. */
async function wipeEmployeeData(
  ctx: MutationCtx,
  emp: Id<"employees">,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    activities: 0,
    evidence: 0,
    evidenceSkippedLegalHold: 0,
    measurements: 0,
    overrides: 0,
    reviews: 0,
    approvals: 0,
    snapshots: 0,
  };
  {
    for (const a of await ctx.db
      .query("activities")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", emp))
      .take(2000)) {
      await ctx.db.delete(a._id);
      counts.activities!++;
    }
    for (const e of await ctx.db
      .query("evidenceFiles")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", emp))
      .take(2000)) {
      if (e.retentionState === "legal_hold") {
        counts.evidenceSkippedLegalHold!++;
        continue;
      }
      if (e.storageId) await ctx.storage.delete(e.storageId);
      for (const l of await ctx.db
        .query("evidenceLinks")
        .withIndex("by_evidence", (q) => q.eq("evidenceFileId", e._id))
        .take(100)) {
        await ctx.db.delete(l._id);
      }
      await ctx.db.delete(e._id);
      counts.evidence!++;
    }
    for (const m of await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", emp))
      .take(2000)) {
      await ctx.db.delete(m._id);
      counts.measurements!++;
    }
    for (const o of (await ctx.db.query("scoreOverrides").take(1000)).filter(
      (o) => o.employeeId === emp,
    )) {
      await ctx.db.delete(o._id);
      counts.overrides!++;
    }
    for (const r of await ctx.db
      .query("reviews")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", emp))
      .take(2000)) {
      await ctx.db.delete(r._id);
      counts.reviews!++;
    }
    for (const ap of await ctx.db
      .query("approvals")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", emp))
      .take(1000)) {
      await ctx.db.delete(ap._id);
      counts.approvals!++;
    }
    for (const s of await ctx.db
      .query("scoreSnapshots")
      .withIndex("by_scope_period", (q) =>
        q.eq("scope", "individual").eq("scopeRef", emp),
      )
      .take(500)) {
      await ctx.db.delete(s._id);
      counts.snapshots!++;
    }
  }
  // Any user's notifications about this employee's KPIs (admin bells,
  // "KPI update — X" entries) would otherwise linger pointing at wiped data.
  {
    const kpiHrefs = new Set(
      (
        await ctx.db
          .query("kpiAssignments")
          .withIndex("by_employee_year", (q) => q.eq("employeeId", emp))
          .take(100)
      ).map((a) => `/kpi/${a._id}`),
    );
    counts.crossNotifications = 0;
    for (const n of await ctx.db.query("notifications").take(2000)) {
      if (n.href && kpiHrefs.has(n.href)) {
        await ctx.db.delete(n._id);
        counts.crossNotifications++;
      }
    }
  }
  return counts;
}

/** Delete every notification addressed to one user. */
async function wipeOwnNotifications(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  let n = 0;
  for (const row of await ctx.db
    .query("notifications")
    .withIndex("by_user_unread", (q) => q.eq("userId", userId))
    .take(1000)) {
    await ctx.db.delete(row._id);
    n++;
  }
  return n;
}

/**
 * Reset a user's dashboard data (System Admin only): every captured activity,
 * evidence item (files destroyed; legal holds kept), measurement, override,
 * review, approval and score snapshot for their linked employee is deleted.
 * KPI configuration and the audit trail are untouched.
 */
export const resetUserData = mutation({
  args: { userId: v.id("users") },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, { userId }) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found");
    if (!target.employeeId) {
      throw new Error(
        "This account has no linked employee, so there is no captured KPI data to reset. To wipe a roster employee's data (e.g. entries an admin logged for them), open that employee's page and use “Reset captured data” there.",
      );
    }
    const counts = await wipeEmployeeData(ctx, target.employeeId);
    counts.notifications = await wipeOwnNotifications(ctx, target._id);
    await recordAudit(ctx, {
      entityType: "user",
      entityId: userId,
      action: "reset_user_data",
      actorUserId: actor._id,
      after: counts,
    });
    return counts;
  },
});

/**
 * Reset a roster employee's captured data directly (System Admin only) —
 * works regardless of whether any account is linked, covering entries an
 * admin logged on the employee's behalf.
 */
export const resetEmployeeData = mutation({
  args: { employeeId: v.id("employees") },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, { employeeId }) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new Error("Employee not found");
    const counts = await wipeEmployeeData(ctx, employeeId);
    await recordAudit(ctx, {
      entityType: "employee",
      entityId: employeeId,
      action: "reset_employee_data",
      actorUserId: actor._id,
      after: { ...counts, employee: undefined },
      reason: `Reset captured data for ${employee.displayName}`,
    });
    return counts;
  },
});

/**
 * Permanently delete a user account (System Admin only): roles, sessions,
 * auth records, notifications — and optionally their captured KPI data. The
 * roster employee itself remains. Self-deletion and deleting the last active
 * System Admin are blocked.
 */
export const deleteUser = mutation({
  args: { userId: v.id("users"), alsoResetData: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    if (args.userId === actor._id) {
      throw new Error("You cannot delete your own account.");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found");
    const targetRoles = await getUserRoles(ctx, target._id);
    if (targetRoles.includes("system_admin")) {
      const stillCovered = await anotherActiveAdminExists(ctx, target._id);
      if (!stillCovered) {
        throw new Error("Cannot delete the last active System Admin.");
      }
    }

    let dataCounts: Record<string, number> | undefined;
    if (args.alsoResetData && target.employeeId) {
      dataCounts = await wipeEmployeeData(ctx, target.employeeId);
    }

    for (const r of await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) {
      await ctx.db.delete(r._id);
    }
    for (const n of await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", args.userId))
      .take(1000)) {
      await ctx.db.delete(n._id);
    }
    for (const s of await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(200)) {
      await ctx.db.delete(s._id);
    }
    for (const a of await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .take(50)) {
      await ctx.db.delete(a._id);
    }
    if (target.avatarStorageId) await ctx.storage.delete(target.avatarStorageId);
    await ctx.db.delete(args.userId);

    await recordAudit(ctx, {
      entityType: "user",
      entityId: args.userId,
      action: "delete_user",
      actorUserId: actor._id,
      before: { email: target.email, employeeId: target.employeeId },
      after: { dataAlsoReset: Boolean(args.alsoResetData), dataCounts },
    });
    return null;
  },
});

/** Remove a user's roster-employee link (System Admin only). */
export const unlinkUserFromEmployee = mutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user: actor } = await requireRole(ctx, ["system_admin"]);
    const before = await ctx.db.get(args.userId);
    if (!before) throw new Error("User not found");
    if (!before.employeeId) return null; // already unlinked
    await ctx.db.patch(args.userId, { employeeId: undefined });
    await recordAudit(ctx, {
      entityType: "user",
      entityId: args.userId,
      action: "unlink_employee",
      actorUserId: actor._id,
      before: { employeeId: before.employeeId },
      after: { employeeId: null },
    });
    return null;
  },
});
