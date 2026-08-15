/**
 * One-off, audited data migrations run via `npx convex run` — never from the
 * UI. Each is idempotent so re-running is safe.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { recordAudit } from "./audit";
import { isStillBlocked } from "./dataQuality";

/**
 * Change an employee's business staff ID in place (e.g. HR issued a corrected
 * number). The Convex document id — which every assignment/measurement/user
 * link references — is untouched, so nothing else moves.
 */
/**
 * Repair job: recompute every assignment's scoringBlocked flag from the
 * CURRENT open data-quality issues (fixes flags left stale by historic
 * resolutions that predate the row-keyed recompute fix).
 */
export const recomputeScoringBlocks = internalMutation({
  args: {},
  returns: v.object({
    assignments: v.number(),
    blocked: v.number(),
    unblocked: v.number(),
  }),
  handler: async (ctx) => {
    const assignments = await ctx.db.query("kpiAssignments").take(500);
    let blocked = 0;
    let unblocked = 0;
    for (const a of assignments) {
      const nowBlocked = await isStillBlocked(ctx, a);
      if (nowBlocked) blocked++;
      if (a.scoringBlocked !== nowBlocked) {
        await ctx.db.patch(a._id, { scoringBlocked: nowBlocked });
        if (!nowBlocked) unblocked++;
      }
    }
    if (unblocked > 0) {
      await recordAudit(ctx, {
        entityType: "kpiAssignment",
        entityId: "recompute",
        action: "recompute_scoring_blocks",
        after: { assignments: assignments.length, blocked, unblocked },
      });
    }
    return { assignments: assignments.length, blocked, unblocked };
  },
});

/**
 * Wipe the audit log (e.g. clearing test data before go-live). Deliberately
 * CLI-only — no dashboard button, so the immutable-log guarantee holds for
 * day-to-day use. Leaves a single tombstone entry recording the wipe.
 */
export const clearAuditLogs = internalMutation({
  args: { confirm: v.literal("CLEAR ALL AUDIT LOGS") },
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    let cleared = 0;
    // Bounded batches; convex run can be repeated if >2000 entries.
    const rows = await ctx.db.query("auditLogs").take(2000);
    for (const r of rows) {
      await ctx.db.delete(r._id);
      cleared++;
    }
    await recordAudit(ctx, {
      entityType: "auditLog",
      entityId: "clear",
      action: "audit_log_cleared",
      reason: "Administrative wipe via CLI (npx convex run)",
      after: { cleared },
    });
    return { cleared };
  },
});

/** Rename the team's display name in place (slug unchanged for idempotency). */
export const renameTeamDisplayName = internalMutation({
  args: { slug: v.string(), name: v.string() },
  returns: v.union(v.object({ renamed: v.boolean() }), v.null()),
  handler: async (ctx, { slug, name }) => {
    const team = (await ctx.db.query("teams").take(50)).find((t) => t.slug === slug);
    if (!team) return null;
    if (team.name === name) return { renamed: false };
    await ctx.db.patch(team._id, { name });
    await recordAudit(ctx, {
      entityType: "team",
      entityId: team._id,
      action: "rename_team",
      before: { name: team.name },
      after: { name },
    });
    return { renamed: true };
  },
});

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
