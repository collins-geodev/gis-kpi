/**
 * One-off, audited data migrations run via `npx convex run` — never from the
 * UI. Each is idempotent so re-running is safe.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { recordAudit } from "./audit";

/**
 * Change an employee's business staff ID in place (e.g. HR issued a corrected
 * number). The Convex document id — which every assignment/measurement/user
 * link references — is untouched, so nothing else moves.
 */
export const renameEmployeeBusinessId = internalMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.union(v.object({ renamed: v.boolean(), employee: v.string() }), v.null()),
  handler: async (ctx, { from, to }) => {
    const already = await ctx.db
      .query("employees")
      .withIndex("by_employeeId", (q) => q.eq("employeeId", to))
      .first();
    if (already) return { renamed: false, employee: already.displayName }; // idempotent

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_employeeId", (q) => q.eq("employeeId", from))
      .first();
    if (!employee) return null;

    await ctx.db.patch(employee._id, { employeeId: to });
    await recordAudit(ctx, {
      entityType: "employee",
      entityId: employee._id,
      action: "rename_business_id",
      reason: "HR-corrected staff ID",
      before: { employeeId: from },
      after: { employeeId: to },
    });
    return { renamed: true, employee: employee.displayName };
  },
});
