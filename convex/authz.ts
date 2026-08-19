/**
 * Centralized authentication + authorization helpers.
 *
 * EVERY public query/mutation/action calls one of these at the top. Application
 * permission roles (userRoleAssignments) are separate from employee job roles.
 * Scope is enforced by employee / reviewer-assignment / role / location.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { AppRole } from "./lib/types";

// Extends ConvexError so the message survives prod redaction (plain Error
// reaches clients as an unusable "Server Error").
export class AuthError extends ConvexError<string> {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Roles with organization-wide read access to performance data. */
const ORG_WIDE_READ: AppRole[] = [
  "system_admin",
  "kpi_admin",
  "executive_viewer",
  "auditor",
];

export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new AuthError("Not authenticated", 401);
  if (user.isActive === false) throw new AuthError("Account is deactivated", 403);
  return user;
}

export async function getUserRoles(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<AppRole[]> {
  const rows = await ctx.db
    .query("userRoleAssignments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.filter((r) => r.isActive).map((r) => r.role);
}

export interface AuthContext {
  user: Doc<"users">;
  roles: AppRole[];
}

export async function getAuthContext(ctx: QueryCtx): Promise<AuthContext> {
  const user = await requireUser(ctx);
  const roles = await getUserRoles(ctx, user._id);
  return { user, roles };
}

export function hasAnyRole(roles: AppRole[], allowed: AppRole[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

/** Require the caller to hold at least one of the allowed roles. */
export async function requireRole(
  ctx: QueryCtx,
  allowed: AppRole[],
): Promise<AuthContext> {
  const auth = await getAuthContext(ctx);
  if (!hasAnyRole(auth.roles, allowed)) {
    throw new AuthError(`Requires one of: ${allowed.join(", ")}`);
  }
  return auth;
}

/** Does a manager/reviewer's scope cover this employee? */
async function userHasScopeOverEmployee(
  ctx: QueryCtx,
  userId: Id<"users">,
  employeeId: Id<"employees">,
): Promise<boolean> {
  const assignments = (
    await ctx.db
      .query("userRoleAssignments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  ).filter((a) => a.isActive && (a.role === "manager" || a.role === "reviewer"));
  if (assignments.length === 0) return false;

  const emp = await ctx.db.get(employeeId);
  if (!emp) return false;

  for (const a of assignments) {
    const unrestricted =
      !a.scopeLocationId &&
      !a.scopeJobRole &&
      (!a.scopeEmployeeIds || a.scopeEmployeeIds.length === 0);
    if (unrestricted) return true;
    if (a.scopeEmployeeIds?.some((id) => id === employeeId)) return true;
    if (a.scopeJobRole && a.scopeJobRole === emp.jobRole) return true;
    if (a.scopeLocationId) {
      const loc = await ctx.db.get(a.scopeLocationId);
      if (loc && loc.name === emp.canonicalLocation) return true;
    }
  }
  return false;
}

/** Assert the caller may read a given employee's performance data. */
export async function assertEmployeeReadScope(
  ctx: QueryCtx,
  employeeId: Id<"employees">,
): Promise<AuthContext> {
  const auth = await getAuthContext(ctx);
  if (hasAnyRole(auth.roles, ORG_WIDE_READ)) return auth;
  if (auth.user.employeeId && auth.user.employeeId === employeeId) return auth; // self
  if (hasAnyRole(auth.roles, ["manager", "reviewer"])) {
    if (await userHasScopeOverEmployee(ctx, auth.user._id, employeeId)) return auth;
  }
  throw new AuthError("Employee is outside your scope");
}

/** Assert the caller may access an evidence record (metadata or content). */
export async function assertEvidenceAccess(
  ctx: QueryCtx,
  evidence: Doc<"evidenceFiles">,
  mode: "metadata" | "content",
): Promise<AuthContext> {
  const auth = await getAuthContext(ctx);
  const { user, roles } = auth;
  if (hasAnyRole(roles, ["system_admin", "kpi_admin"])) return auth;
  if (roles.includes("auditor") && mode === "metadata") return auth;
  // Owner (the subject employee or the uploader).
  if (user.employeeId && user.employeeId === evidence.employeeId) return auth;
  if (evidence.uploadedByUserId === user._id) return auth;
  // Managers/reviewers within scope; confidential content is manager-only.
  if (hasAnyRole(roles, ["manager", "reviewer"])) {
    const inScope = await userHasScopeOverEmployee(ctx, user._id, evidence.employeeId);
    if (
      inScope &&
      (evidence.confidentiality !== "confidential" || roles.includes("manager"))
    ) {
      return auth;
    }
  }
  throw new AuthError("Evidence is outside your scope");
}

/** Convenience: list of employeeIds the caller is allowed to read. */
export async function readableEmployeeIds(
  ctx: QueryCtx,
): Promise<Id<"employees">[] | "all"> {
  const auth = await getAuthContext(ctx);
  if (hasAnyRole(auth.roles, ORG_WIDE_READ)) return "all";
  const ids = new Set<Id<"employees">>();
  if (auth.user.employeeId) ids.add(auth.user.employeeId);
  if (hasAnyRole(auth.roles, ["manager", "reviewer"])) {
    // Unrestricted manager/reviewer sees all; otherwise resolve scoped set.
    const assignments = (
      await ctx.db
        .query("userRoleAssignments")
        .withIndex("by_user", (q) => q.eq("userId", auth.user._id))
        .collect()
    ).filter((a) => a.isActive && (a.role === "manager" || a.role === "reviewer"));
    for (const a of assignments) {
      const unrestricted =
        !a.scopeLocationId &&
        !a.scopeJobRole &&
        (!a.scopeEmployeeIds || a.scopeEmployeeIds.length === 0);
      if (unrestricted) return "all";
      for (const id of a.scopeEmployeeIds ?? []) ids.add(id);
      if (a.scopeJobRole) {
        const byRole = await ctx.db
          .query("employees")
          .withIndex("by_jobRole", (q) => q.eq("jobRole", a.scopeJobRole!))
          .collect();
        for (const e of byRole) ids.add(e._id);
      }
      if (a.scopeLocationId) {
        const loc = await ctx.db.get(a.scopeLocationId);
        if (loc) {
          const byLoc = await ctx.db
            .query("employees")
            .withIndex("by_location", (q) => q.eq("canonicalLocation", loc.name))
            .collect();
          for (const e of byLoc) ids.add(e._id);
        }
      }
    }
  }
  return Array.from(ids);
}
