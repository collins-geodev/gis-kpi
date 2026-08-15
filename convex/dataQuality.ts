/**
 * Data Quality queue — the admin surface over the reconciliation exceptions.
 * Resolving an issue can unblock scoring for the affected KPI assignment once
 * no blocking issues remain. Every resolution is audit-logged.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireRole, requireUser } from "./authz";
import { recordAudit } from "./audit";
import { vDqCategory, vDqStatus } from "./validators";

const RESOLVED_STATES = ["approved", "rejected", "resolved"];

function issueDTO(i: Doc<"dataQualityIssues">) {
  return {
    id: i._id,
    code: i.code,
    category: i.category,
    severity: i.severity,
    status: i.status,
    employeeId: i.employeeId ?? null,
    sourceRowNumber: i.sourceRowNumber ?? null,
    canonicalKey: i.canonicalKey ?? null,
    field: i.field ?? null,
    sourceValue: i.sourceValue ?? null,
    proposedValue: i.proposedValue ?? null,
    reason: i.reason,
    blocksScoring: i.blocksScoring,
    resolutionNote: i.resolutionNote ?? null,
  };
}

export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const issues = await ctx.db.query("dataQualityIssues").take(5000);
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let blockers = 0;
    let open = 0;
    for (const i of issues) {
      byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      if (i.blocksScoring && !RESOLVED_STATES.includes(i.status)) blockers++;
      if (!RESOLVED_STATES.includes(i.status)) open++;
    }
    return { total: issues.length, open, blockers, byCategory, bySeverity, byStatus };
  },
});

export const listIssues = query({
  args: {
    status: v.optional(vDqStatus),
    category: v.optional(vDqCategory),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { status, category, paginationOpts }) => {
    await requireRole(ctx, ["system_admin", "kpi_admin", "auditor"]);
    const result = status
      ? await ctx.db
          .query("dataQualityIssues")
          .withIndex("by_status", (q) => q.eq("status", status))
          .order("desc")
          .paginate(paginationOpts)
      : category
        ? await ctx.db
            .query("dataQualityIssues")
            .withIndex("by_category", (q) => q.eq("category", category))
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db.query("dataQualityIssues").order("desc").paginate(paginationOpts);

    const page = [];
    for (const i of result.page) {
      let employeeName: string | null = null;
      if (i.employeeId) {
        const e = await ctx.db.get(i.employeeId);
        employeeName = e?.displayName ?? null;
      }
      page.push({ ...issueDTO(i), employeeName });
    }
    return { ...result, page };
  },
});

/** All assignments sharing a source row (row-keyed issues affect them all). */
async function assignmentsForRow(
  ctx: QueryCtx,
  sourceRowNumber: number,
): Promise<Doc<"kpiAssignments">[]> {
  const all = await ctx.db.query("kpiAssignments").take(500);
  return all.filter((a) => a.sourceRowNumber === sourceRowNumber);
}

/** Recompute whether a KPI assignment is still blocked by open issues. */
export async function isStillBlocked(
  ctx: QueryCtx,
  assignment: Doc<"kpiAssignments">,
): Promise<boolean> {
  const rowIssues = await ctx.db
    .query("dataQualityIssues")
    .withIndex("by_row", (q) => q.eq("sourceRowNumber", assignment.sourceRowNumber))
    .collect();
  if (rowIssues.some((i) => i.blocksScoring && !RESOLVED_STATES.includes(i.status))) {
    return true;
  }
  if (assignment.canonicalKey === "tech_innovation") {
    const rubric = await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_code", (q) => q.eq("code", "rubric_required:tech_innovation"))
      .first();
    if (rubric && !RESOLVED_STATES.includes(rubric.status)) return true;
  }
  return false;
}

export const resolveIssue = mutation({
  args: {
    issueId: v.id("dataQualityIssues"),
    decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("resolve")),
    note: v.optional(v.string()),
  },
  returns: v.object({ status: vDqStatus }),
  handler: async (ctx, { issueId, decision, note }) => {
    const { user } = await requireRole(ctx, ["system_admin", "kpi_admin"]);
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error("Issue not found");
    if (decision === "reject" && !note) {
      throw new Error("A reason is required to reject a data-quality proposal.");
    }

    const status: "approved" | "rejected" | "resolved" =
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "resolved";
    await ctx.db.patch(issueId, {
      status,
      resolvedByUserId: user._id,
      resolutionNote: note,
      resolvedAt: Date.now(),
    });

    // Recompute scoring-block state for affected assignment(s) — via the
    // direct link when present, otherwise via the shared source row.
    const affectedAssignments: Doc<"kpiAssignments">[] = [];
    if (issue.kpiAssignmentId) {
      const a = await ctx.db.get(issue.kpiAssignmentId);
      if (a) affectedAssignments.push(a);
    } else if (issue.sourceRowNumber !== undefined) {
      affectedAssignments.push(...(await assignmentsForRow(ctx, issue.sourceRowNumber)));
    }
    for (const a of affectedAssignments) {
      const blocked = await isStillBlocked(ctx, a);
      if (a.scoringBlocked !== blocked)
        await ctx.db.patch(a._id, { scoringBlocked: blocked });
    }
    // Resolving the rubric requirement can unblock every innovation assignment.
    if (
      issue.category === "rubric_required" &&
      issue.canonicalKey === "tech_innovation" &&
      issue.performanceYearId &&
      status !== "rejected"
    ) {
      const innovations = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_year_key", (q) =>
          q
            .eq("performanceYearId", issue.performanceYearId!)
            .eq("canonicalKey", "tech_innovation"),
        )
        .take(500);
      for (const a of innovations) {
        const blocked = await isStillBlocked(ctx, a);
        if (a.scoringBlocked !== blocked)
          await ctx.db.patch(a._id, { scoringBlocked: blocked });
      }
    }

    await recordAudit(ctx, {
      entityType: "dataQualityIssue",
      entityId: issueId,
      action: `dq_${decision}`,
      actorUserId: user._id,
      reason: note,
      before: { status: issue.status },
      after: { status },
    });
    return { status };
  },
});

/**
 * Bulk-approve/resolve every open issue in a category (or all categories).
 * "approve" only touches issues that carry a proposed value. Recomputes the
 * scoring-block state for all affected KPI assignments once at the end.
 */
export const bulkResolve = mutation({
  args: {
    category: v.optional(vDqCategory),
    decision: v.union(v.literal("approve"), v.literal("resolve")),
    note: v.optional(v.string()),
  },
  returns: v.object({ resolved: v.number(), skipped: v.number() }),
  handler: async (ctx, { category, decision, note }) => {
    const { user } = await requireRole(ctx, ["system_admin", "kpi_admin"]);

    const issues = category
      ? await ctx.db
          .query("dataQualityIssues")
          .withIndex("by_category", (q) => q.eq("category", category))
          .take(5000)
      : await ctx.db.query("dataQualityIssues").take(5000);

    const status = decision === "approve" ? "approved" : "resolved";
    const affected = new Set<Id<"kpiAssignments">>();
    let rubricYearId: Id<"performanceYears"> | undefined;
    let resolved = 0;
    let skipped = 0;
    const now = Date.now();

    for (const i of issues) {
      if (RESOLVED_STATES.includes(i.status)) continue;
      // Approving requires a proposed value (e.g. weight_incomplete has none).
      if (
        decision === "approve" &&
        (i.proposedValue === undefined || i.proposedValue === null)
      ) {
        skipped++;
        continue;
      }
      await ctx.db.patch(i._id, {
        status,
        resolvedByUserId: user._id,
        resolutionNote: note,
        resolvedAt: now,
      });
      resolved++;
      if (i.kpiAssignmentId) affected.add(i.kpiAssignmentId);
      else if (i.sourceRowNumber !== undefined) {
        for (const a of await assignmentsForRow(ctx, i.sourceRowNumber)) {
          affected.add(a._id);
        }
      }
      if (i.category === "rubric_required" && i.canonicalKey === "tech_innovation") {
        rubricYearId = i.performanceYearId;
      }
    }

    // Recompute scoring-block for directly-affected assignments.
    for (const id of affected) {
      const a = await ctx.db.get(id);
      if (a) {
        const blocked = await isStillBlocked(ctx, a);
        if (a.scoringBlocked !== blocked)
          await ctx.db.patch(a._id, { scoringBlocked: blocked });
      }
    }
    // If the rubric requirement was cleared, recompute all innovation KPIs.
    if (rubricYearId) {
      const innovations = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_year_key", (q) =>
          q.eq("performanceYearId", rubricYearId!).eq("canonicalKey", "tech_innovation"),
        )
        .take(500);
      for (const a of innovations) {
        const blocked = await isStillBlocked(ctx, a);
        if (a.scoringBlocked !== blocked)
          await ctx.db.patch(a._id, { scoringBlocked: blocked });
      }
    }

    await recordAudit(ctx, {
      entityType: "dataQualityIssue",
      entityId: category ? `bulk:${category}` : "bulk:all",
      action: `dq_bulk_${decision}`,
      actorUserId: user._id,
      reason: note,
      after: { resolved, skipped, category: category ?? "all" },
    });
    return { resolved, skipped };
  },
});
