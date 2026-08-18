/**
 * One-off, audited data migrations run via `npx convex run` — never from the
 * UI. Each is idempotent so re-running is safe.
 */
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { recordAudit } from "./audit";
import { isStillBlocked } from "./dataQuality";
import { recomputeMeasurement } from "./measurementsModel";
import { vCanonicalKpiKey } from "./validators";

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
 * Resolve the commercial-maintenance unit mismatch: the source workbook typed
 * "reduce errors by 20%" as Number/20, which made the reduction engine score
 * a met 20% drop as 1% attainment. Applies the approved resolution
 * (Percentage/0.2) to the seeded definition and every assignment, approves the
 * open unit_mismatch data-quality issue, recomputes scoring blocks, and
 * recomputes every existing measurement for the affected assignments.
 */
export const resolveCommercialMaintenanceTarget = internalMutation({
  args: {},
  returns: v.object({
    definitions: v.number(),
    assignments: v.number(),
    issuesApproved: v.number(),
    measurementsRecomputed: v.number(),
  }),
  handler: async (ctx) => {
    const KEY = "commercial_maintenance_quality" as const;
    let definitions = 0;
    let assignments = 0;
    let issuesApproved = 0;
    let measurementsRecomputed = 0;

    for (const d of await ctx.db.query("kpiDefinitions").take(500)) {
      if (d.canonicalKey !== KEY) continue;
      if (d.targetType === "percentage" && d.defaultTarget === 0.2) continue;
      await ctx.db.patch(d._id, {
        targetType: "percentage",
        defaultTarget: 0.2,
        needsClarification: false,
        scoringNotes:
          "Reduction vs prior-year baseline with a 20% target. The source workbook typed this as Number/20; resolved to Percentage/0.2.",
      });
      definitions++;
    }

    const affected: Doc<"kpiAssignments">[] = [];
    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.canonicalKey !== KEY) continue;
      if (a.targetType !== "percentage" || a.target !== 0.2) {
        await ctx.db.patch(a._id, { targetType: "percentage", target: 0.2 });
        assignments++;
      }
      affected.push(a);
    }

    // Approve the open unit-mismatch issue(s) — this is the admin resolution
    // the issue was waiting for, applied in data above.
    for (const i of await ctx.db
      .query("dataQualityIssues")
      .withIndex("by_category", (q) => q.eq("category", "unit_mismatch"))
      .take(100)) {
      if (i.canonicalKey !== KEY) continue;
      if (["approved", "rejected", "resolved"].includes(i.status)) continue;
      await ctx.db.patch(i._id, {
        status: "approved",
        resolutionNote:
          "Applied via migrations:resolveCommercialMaintenanceTarget — target resolved to Percentage/0.2 on the definition and all assignments.",
        resolvedAt: Date.now(),
      });
      issuesApproved++;
    }

    for (const a of affected) {
      const fresh = await ctx.db.get(a._id);
      if (!fresh) continue;
      const blocked = await isStillBlocked(ctx, fresh);
      if (fresh.scoringBlocked !== blocked) {
        await ctx.db.patch(fresh._id, { scoringBlocked: blocked });
      }
      const measurements = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", fresh._id))
        .take(500);
      const updated = (await ctx.db.get(fresh._id))!;
      for (const m of measurements) {
        await recomputeMeasurement(ctx, updated, m.periodKey);
        measurementsRecomputed++;
      }
    }

    if (definitions + assignments + issuesApproved > 0) {
      await recordAudit(ctx, {
        entityType: "kpiDefinition",
        entityId: KEY,
        action: "resolve_unit_mismatch",
        reason: "Reduce-by-20% typed as Number/20 in the source workbook",
        after: { definitions, assignments, issuesApproved, measurementsRecomputed },
      });
    }
    return { definitions, assignments, issuesApproved, measurementsRecomputed };
  },
});

/**
 * Convert the commercial-maintenance KPI from reduction-vs-baseline to a
 * monthly error budget (count, lower-is-better): attainment = budget ÷ errors
 * found, capped. The budget encodes the workbook's "reduce by 20%" intent as
 * prior-year monthly baseline × 0.8; pass `monthlyBudget` to set the agreed
 * number (defaults to the seeded 24). Re-runnable: pass a new budget any time.
 */
export const convertCommercialMaintenanceToErrorBudget = internalMutation({
  args: { monthlyBudget: v.optional(v.number()) },
  returns: v.object({
    budget: v.number(),
    definitions: v.number(),
    assignments: v.number(),
    measurementsRecomputed: v.number(),
  }),
  handler: async (ctx, { monthlyBudget }) => {
    const KEY = "commercial_maintenance_quality" as const;
    const budget = monthlyBudget ?? 24;
    if (budget <= 0) throw new Error("monthlyBudget must be > 0");
    const METRIC =
      "Keep identified errors within a monthly error budget set 20% below the prior-year monthly baseline.";
    const NOTES =
      "Monthly error budget = prior-year monthly error baseline × 0.8. Attainment = budget ÷ errors found, capped at 100%.";
    let definitions = 0;
    let assignments = 0;
    let measurementsRecomputed = 0;

    for (const d of await ctx.db.query("kpiDefinitions").take(500)) {
      if (d.canonicalKey !== KEY) continue;
      if (d.measurementMode === "count" && d.defaultTarget === budget) continue;
      await ctx.db.patch(d._id, {
        measurementMode: "count",
        direction: "lowerIsBetter",
        targetType: "number",
        defaultTarget: budget,
        canonicalMetric: METRIC,
        scoringNotes: NOTES,
      });
      definitions++;
    }

    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.canonicalKey !== KEY) continue;
      if (a.measurementMode !== "count" || a.target !== budget) {
        await ctx.db.patch(a._id, {
          measurementMode: "count",
          direction: "lowerIsBetter",
          targetType: "number",
          target: budget,
          metric: METRIC,
        });
        assignments++;
      }
      const updated = (await ctx.db.get(a._id))!;
      const measurements = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", a._id))
        .take(500);
      for (const m of measurements) {
        await recomputeMeasurement(ctx, updated, m.periodKey);
        measurementsRecomputed++;
      }
    }

    if (definitions + assignments > 0) {
      await recordAudit(ctx, {
        entityType: "kpiDefinition",
        entityId: KEY,
        action: "convert_to_error_budget",
        reason:
          "Reduction-vs-baseline scored as a cliff with small counts; converted to a monthly error budget (count, lower-is-better).",
        after: { budget, definitions, assignments, measurementsRecomputed },
      });
    }
    return { budget, definitions, assignments, measurementsRecomputed };
  },
});

/**
 * Pin (or unpin, with null) the prior-year baseline on every assignment of a
 * canonical KPI. On reduction-mode assignments the pin takes effect at capture
 * time: employees only enter the current value and the baseline stays fixed
 * all year. On other modes the value is recorded for documentation and applies
 * automatically if the KPI is ever switched (back) to reduction. Idempotent.
 */
export const pinReductionBaseline = internalMutation({
  args: {
    canonicalKey: vCanonicalKpiKey,
    baseline: v.union(v.number(), v.null()),
  },
  returns: v.object({ pinned: v.number(), inertOnNonReduction: v.number() }),
  handler: async (ctx, { canonicalKey, baseline }) => {
    if (baseline !== null && baseline < 0) throw new Error("baseline must be ≥ 0");
    let pinned = 0;
    let inertOnNonReduction = 0;
    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.canonicalKey !== canonicalKey) continue;
      const next = baseline ?? undefined;
      if ((a.pinnedBaseline ?? undefined) === next) continue;
      await ctx.db.patch(a._id, { pinnedBaseline: next });
      await recordAudit(ctx, {
        entityType: "kpiAssignment",
        entityId: a._id,
        action: baseline === null ? "unpin_baseline" : "pin_baseline",
        reason: "Baseline fixed by admin so capture only asks for the current value",
        before: { pinnedBaseline: a.pinnedBaseline ?? null },
        after: { pinnedBaseline: baseline },
      });
      pinned++;
      if (a.measurementMode !== "reduction") inertOnNonReduction++;
    }
    return { pinned, inertOnNonReduction };
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
