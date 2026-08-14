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
