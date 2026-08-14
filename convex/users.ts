/**
 * Application user administration (System Admin only). Lists auth users with
 * their application roles and any linked roster employee. Employee roster reads
 * for the org chart live in employees.ts.
 */
import { query } from "./_generated/server";
import { requireRole } from "./authz";

export const listAppUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["system_admin"]);
    const users = await ctx.db.query("users").take(1000);
    const rows = [];
    for (const u of users) {
      const roleRows = await ctx.db
        .query("userRoleAssignments")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .collect();
      let employee: { displayName: string; jobRole: string } | null = null;
      if (u.employeeId) {
        const e = await ctx.db.get(u.employeeId);
        if (e) employee = { displayName: e.displayName, jobRole: e.jobRole };
      }
      rows.push({
        id: u._id,
        name: u.name ?? null,
        email: u.email ?? null,
        isActive: u.isActive ?? true,
        roles: roleRows.filter((r) => r.isActive).map((r) => r.role),
        employee,
      });
    }
    return rows;
  },
});

/** Roster employees available for linking to an app user (admin only). */
export const listRosterForLinking = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["system_admin", "kpi_admin"]);
    const employees = await ctx.db.query("employees").take(1000);
    return employees
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((e) => ({
        id: e._id,
        employeeId: e.employeeId,
        displayName: e.displayName,
        jobRole: e.jobRole,
      }));
  },
});
