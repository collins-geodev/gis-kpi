/**
 * One-off, audited data migrations run via `npx convex run` — never from the
 * UI. Each is idempotent so re-running is safe.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { NON_CORE_TEMPLATES } from "./lib/catalogue";
import { BASELINE_PERFORMANCE_YEAR, FULL_WEIGHT_TOTAL, JOB_ROLES } from "./lib/types";
import { v } from "convex/values";
import { recordAudit } from "./audit";
import { isStillBlocked } from "./dataQuality";
import { recomputeMeasurement } from "./measurementsModel";
import { vCanonicalKpiKey } from "./validators";
import { computeEmployeeAnalytics } from "./analytics";

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
 * Convert the QA data-quality KPI from a fixed monthly count (20) to a
 * coverage ratio: errors corrected ÷ errors identified, target 100%. The
 * month's real workload becomes the denominator, so both light (<20) and
 * heavy (>20) months score fairly. Idempotent.
 */
export const convertQaDataQualityToCoverageRatio = internalMutation({
  args: {},
  returns: v.object({
    definitions: v.number(),
    assignments: v.number(),
    measurementsRecomputed: v.number(),
  }),
  handler: async (ctx) => {
    const KEY = "qa_data_quality" as const;
    const METRIC =
      "Correct 100% of the data errors and inconsistencies identified during QA — errors corrected ÷ errors identified, at whatever volume the month brings.";
    const NOTES =
      "Coverage ratio (corrected ÷ identified), target 100%. Replaces the workbook's fixed 20/month count — the month's actual volume is the denominator. QA batches are logged incrementally; numerators and denominators sum across the month.";
    let definitions = 0;
    let assignments = 0;
    let measurementsRecomputed = 0;

    for (const d of await ctx.db.query("kpiDefinitions").take(500)) {
      if (d.canonicalKey !== KEY) continue;
      if (
        d.measurementMode === "ratio" &&
        d.defaultTarget === 1 &&
        d.scoringNotes === NOTES
      )
        continue;
      await ctx.db.patch(d._id, {
        measurementMode: "ratio",
        direction: "higherIsBetter",
        targetType: "percentage",
        defaultTarget: 1,
        canonicalMetric: METRIC,
        scoringNotes: NOTES,
      });
      definitions++;
    }

    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.canonicalKey !== KEY) continue;
      if (a.measurementMode !== "ratio" || a.target !== 1) {
        await ctx.db.patch(a._id, {
          measurementMode: "ratio",
          direction: "higherIsBetter",
          targetType: "percentage",
          target: 1,
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
        action: "convert_to_coverage_ratio",
        reason:
          "Fixed 20/month count penalized light months and ignored heavy ones; coverage ratio scores against the month's actual identified errors.",
        after: { definitions, assignments, measurementsRecomputed },
      });
    }
    return { definitions, assignments, measurementsRecomputed };
  },
});

/**
 * Repair job: re-run the deterministic recompute for every stored measurement.
 * Clears stale provisional rows left by decisions that predate the
 * recompute-on-reject fix (a measurement whose entries were all returned).
 */
export const recomputeAllMeasurements = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), remaining: v.number() }),
  handler: async (ctx) => {
    const measurements = await ctx.db.query("kpiMeasurements").take(1000);
    let scanned = 0;
    for (const m of measurements) {
      const assignment = await ctx.db.get(m.kpiAssignmentId);
      if (!assignment) continue;
      await recomputeMeasurement(ctx, assignment, m.periodKey);
      scanned++;
    }
    const remaining = (await ctx.db.query("kpiMeasurements").take(1000)).length;
    return { scanned, remaining };
  },
});

/**
 * Repair job: periods approved before approvals also flipped activity
 * statuses left the employee's entries showing "submitted". Align them —
 * every official (non-provisional) measurement's submitted/verified entries
 * become "approved".
 */
export const alignActivityStatusesWithApprovals = internalMutation({
  args: {},
  returns: v.object({ activitiesApproved: v.number() }),
  handler: async (ctx) => {
    let activitiesApproved = 0;
    for (const m of await ctx.db.query("kpiMeasurements").take(1000)) {
      if (m.isProvisional) continue;
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", m.kpiAssignmentId).eq("periodKey", m.periodKey),
        )
        .take(500);
      for (const a of acts) {
        if (["submitted", "verified"].includes(a.status)) {
          await ctx.db.patch(a._id, { status: "approved", updatedAt: Date.now() });
          activitiesApproved++;
        }
      }
    }
    return { activitiesApproved };
  },
});

/**
 * CLI variant of the review queue's submission delete (no signed-in actor):
 * removes every non-locked activity for the KPI/period, soft-deletes the
 * KPI's active evidence, and recomputes measurements. Fully audited; prefer
 * the UI's Delete button when possible — it additionally notifies the
 * employee.
 */
export const cliDeleteSubmission = internalMutation({
  args: {
    canonicalKey: vCanonicalKpiKey,
    periodKey: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    assignments: v.number(),
    deleted: v.number(),
    evidenceDeleted: v.number(),
  }),
  handler: async (ctx, { canonicalKey, periodKey, reason }) => {
    let assignments = 0;
    let deleted = 0;
    let evidenceDeleted = 0;
    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.canonicalKey !== canonicalKey) continue;
      assignments++;
      const acts = await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", a._id).eq("periodKey", periodKey),
        )
        .take(500);
      for (const act of acts) {
        if (act.status === "locked") continue;
        await recordAudit(ctx, {
          entityType: "activity",
          entityId: act._id,
          action: "delete_submission_activity",
          reason,
          before: { ...act },
        });
        await ctx.db.delete(act._id);
        deleted++;
      }
      const evidence = await ctx.db
        .query("evidenceFiles")
        .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", a._id))
        .take(500);
      for (const e of evidence) {
        if (e.retentionState !== "active") continue;
        if (e.storageId) await ctx.storage.delete(e.storageId);
        await ctx.db.patch(e._id, { retentionState: "deleted", storageId: undefined });
        await recordAudit(ctx, {
          entityType: "evidenceFile",
          entityId: e._id,
          action: "delete_submission_evidence",
          reason,
          before: { title: e.title, reviewStatus: e.reviewStatus },
        });
        evidenceDeleted++;
      }
      const ms = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) => q.eq("kpiAssignmentId", a._id))
        .take(500);
      const periods = new Set(ms.map((m) => m.periodKey));
      periods.add(periodKey);
      for (const pk of periods) {
        await recomputeMeasurement(ctx, a, pk);
      }
    }
    return { assignments, deleted, evidenceDeleted };
  },
});

/** One employee's analytics by staff ID (CLI audit helper). */
export const cliEmployeeAnalytics = internalQuery({
  args: { employeeBusinessId: v.string() },
  returns: v.any(),
  handler: async (ctx, { employeeBusinessId }) => {
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_employeeId", (q) => q.eq("employeeId", employeeBusinessId))
      .first();
    if (!employee) return null;
    return await computeEmployeeAnalytics(ctx, employee._id);
  },
});

/** Full KPI settings per assignment (CLI audit helper). */
export const listKpiSettings = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const out = [];
    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      const emp = a.employeeId ? await ctx.db.get(a.employeeId) : null;
      out.push({
        employee: emp?.displayName ?? null,
        jobRole: emp?.jobRole ?? null,
        canonicalKey: a.canonicalKey,
        mode: a.measurementMode,
        direction: a.direction,
        target: a.target,
        targetType: a.targetType,
        weight: a.weight,
        frequency: a.frequency,
        evidenceRequired: a.evidenceRequired,
        pinnedBaseline: a.pinnedBaseline ?? null,
        scoringBlocked: a.scoringBlocked,
        status: a.status,
      });
    }
    return out.sort(
      (x, y) =>
        (x.employee ?? "").localeCompare(y.employee ?? "") ||
        x.canonicalKey.localeCompare(y.canonicalKey),
    );
  },
});

/** List every reduction-mode assignment and its pin state (CLI audit helper). */
export const listReductionPins = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      canonicalKey: v.string(),
      jobRole: v.union(v.string(), v.null()),
      employee: v.union(v.string(), v.null()),
      pinnedBaseline: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const out = [];
    for (const a of await ctx.db.query("kpiAssignments").take(1000)) {
      if (a.measurementMode !== "reduction") continue;
      const emp = a.employeeId ? await ctx.db.get(a.employeeId) : null;
      out.push({
        canonicalKey: a.canonicalKey as string,
        jobRole: emp?.jobRole ?? null,
        employee: emp?.displayName ?? null,
        pinnedBaseline: a.pinnedBaseline ?? null,
      });
    }
    return out;
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

/**
 * Add the shared non-core KPIs (20 corporate points: safety, compliance,
 * customer satisfaction, training hours) to every roster employee, completing
 * the 80 + 20 = 100 configured weight. Creates per-role definitions and
 * per-employee assignments (idempotent), and resolves each employee's
 * weight_incomplete data-quality flag once their total reaches 100.
 */
export const addNonCoreKpis = internalMutation({
  args: {},
  returns: v.object({
    definitions: v.number(),
    assignments: v.number(),
    weightIssuesResolved: v.number(),
  }),
  handler: async (ctx) => {
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) throw new Error("Performance year not seeded");

    // Workbook source-layer values (audit): weight 0.05 each.
    const SOURCE: Record<string, { target: number; type: string; freq: string }> = {
      safety_hazard_reporting: { target: 12, type: "Number", freq: "Monthly" },
      compliance_recertification: { target: 0.8, type: "Percentage", freq: "Annually" },
      internal_customer_satisfaction: {
        target: 0.85,
        type: "Percentage",
        freq: "Annually",
      },
      training_hours: { target: 20, type: "Number", freq: "Annually" },
    };

    let definitions = 0;
    let assignments = 0;
    let weightIssuesResolved = 0;

    // Per-role definitions.
    const defIdByRoleKey = new Map<string, Id<"kpiDefinitions">>();
    for (const role of JOB_ROLES) {
      for (const t of NON_CORE_TEMPLATES) {
        const mapKey = `${role}::${t.key}`;
        const existing = await ctx.db
          .query("kpiDefinitions")
          .withIndex("by_role_key", (q) =>
            q.eq("jobRole", role).eq("canonicalKey", t.key),
          )
          .first();
        if (existing) {
          defIdByRoleKey.set(mapKey, existing._id);
          continue;
        }
        const defId = await ctx.db.insert("kpiDefinitions", {
          canonicalKey: t.key,
          jobRole: role,
          title: t.title,
          canonicalObjective: t.canonicalObjective,
          canonicalMetric: t.canonicalMetric,
          measurementMode: t.measurementMode,
          direction: t.direction,
          targetType: t.targetType,
          defaultTarget: t.target,
          unit: t.unit,
          frequency: t.frequency,
          defaultWeight: t.weight,
          evidenceRequired: t.evidenceRequired,
          needsRubric: false,
          needsClarification: false,
          scoringNotes: t.scoringNotes,
          kpiCategory: "non_core",
          status: "active",
          currentVersion: 1,
        });
        await ctx.db.insert("kpiDefinitionVersions", {
          kpiDefinitionId: defId,
          version: 1,
          effectiveFrom: Date.now(),
          snapshot: t,
          changeReason: "Non-core KPI import (2025 workbook, 20 corporate points)",
          createdAt: Date.now(),
        });
        defIdByRoleKey.set(mapKey, defId);
        definitions++;
      }
    }

    // Per-employee assignments + weight flag resolution.
    for (const employee of await ctx.db.query("employees").take(2000)) {
      const existing = await ctx.db
        .query("kpiAssignments")
        .withIndex("by_employee_year", (q) =>
          q.eq("employeeId", employee._id).eq("performanceYearId", year._id),
        )
        .collect();
      const haveKeys = new Set(existing.map((a) => a.canonicalKey));
      const maxOrder = existing.reduce((m, a) => Math.max(m, a.displayOrder), 0);
      let added = 0;
      for (const t of NON_CORE_TEMPLATES) {
        if (haveKeys.has(t.key)) continue;
        const src = SOURCE[t.key]!;
        await ctx.db.insert("kpiAssignments", {
          performanceYearId: year._id,
          employeeId: employee._id,
          kpiDefinitionId: defIdByRoleKey.get(`${employee.jobRole}::${t.key}`),
          canonicalKey: t.key,
          objective: t.canonicalObjective,
          metric: t.canonicalMetric,
          weight: t.weight,
          target: t.target,
          targetType: t.targetType,
          frequency: t.frequency,
          measurementMode: t.measurementMode,
          direction: t.direction,
          scoreCap: 1,
          stretchCap: 1.2,
          evidenceRequired: t.evidenceRequired,
          kpiCategory: "non_core",
          // Synthetic source layer: these rows come from the non-core sheet
          // sections, outside the core import's row numbering.
          sourceRowNumber: 0,
          sourceObjective: t.canonicalObjective,
          sourceMetric: t.canonicalMetric,
          sourceWeight: 0.05,
          sourceTarget: src.target,
          sourceTargetType: src.type,
          sourceFrequency: src.freq,
          status: "active",
          scoringBlocked: false,
          displayOrder: maxOrder + 1 + added,
          createdAt: Date.now(),
        });
        added++;
        assignments++;
      }

      // Resolve the 80/100 flag once this employee's weights total 100.
      const total =
        existing.reduce((s, a) => s + a.weight, 0) +
        NON_CORE_TEMPLATES.filter((t) => !haveKeys.has(t.key)).reduce(
          (s, t) => s + t.weight,
          0,
        );
      if (total === FULL_WEIGHT_TOTAL) {
        // Issue codes are keyed by the business staff ID from the source rows.
        const issue = await ctx.db
          .query("dataQualityIssues")
          .withIndex("by_code", (q) =>
            q.eq("code", `weight_incomplete:${employee.employeeId}`),
          )
          .first();
        if (issue && !["approved", "rejected", "resolved"].includes(issue.status)) {
          await ctx.db.patch(issue._id, {
            status: "resolved",
            resolutionNote:
              "Non-core KPIs (20 corporate points) added — configured weights now total 100.",
            resolvedAt: Date.now(),
          });
          weightIssuesResolved++;
        }
      }
    }

    if (definitions + assignments > 0) {
      await recordAudit(ctx, {
        entityType: "kpiDefinition",
        entityId: "non_core_import",
        action: "add_non_core_kpis",
        reason: "2025 workbook non-core sections (20 corporate points per employee)",
        after: { definitions, assignments, weightIssuesResolved },
      });
    }
    return { definitions, assignments, weightIssuesResolved };
  },
});

/**
 * Change the email address stored on a user account (e.g. wrong casing or a
 * renamed corporate mailbox). Only `users.email` (and a `name` that mirrored
 * the old email) is changed — the authAccounts credential row is untouched,
 * so the user keeps signing in exactly as before. Idempotent.
 *
 *   npx convex run migrations:updateUserEmail \
 *     '{"from":"old@example.com","to":"New@example.com"}' --prod
 */
export const updateUserEmail = internalMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.union(
    v.object({ updated: v.boolean(), email: v.string() }),
    v.null(),
  ),
  handler: async (ctx, { from, to }) => {
    if (!to.includes("@")) throw new Error(`"to" is not an email address: ${to}`);
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", from))
      .first();
    if (!user) {
      // Already renamed? Then report idempotent success.
      const done = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", to))
        .first();
      return done ? { updated: false, email: to } : null;
    }
    await ctx.db.patch(user._id, {
      email: to,
      // Accounts created before profile setup mirror the email into `name`.
      ...(user.name === from ? { name: to } : {}),
    });
    await recordAudit(ctx, {
      entityType: "user",
      entityId: user._id,
      action: "update_user_email",
      reason: "Admin-corrected account email (CLI)",
      before: { email: from },
      after: { email: to },
    });
    return { updated: true, email: to };
  },
});

/**
 * Set (or clear) the performance year's capture go-live. Defaults to
 * 1 July 2026 00:00 Africa/Lagos. Idempotent — safe to re-run.
 *
 *   npx convex run migrations:setCaptureStart           # 2026-07-01
 *   npx convex run migrations:setCaptureStart '{"dateIso":"2026-08-01"}'
 *   npx convex run migrations:setCaptureStart '{"clear":true}'
 */
export const setCaptureStart = internalMutation({
  args: { dateIso: v.optional(v.string()), clear: v.optional(v.boolean()) },
  returns: v.object({ captureStartAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, { dateIso, clear }) => {
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) throw new Error("Performance year not seeded");

    let captureStartAt: number | null;
    if (clear) {
      captureStartAt = null;
      await ctx.db.patch(year._id, { captureStartAt: undefined });
    } else {
      const iso = dateIso ?? "2026-07-01";
      const ms = Date.parse(`${iso}T00:00:00+01:00`); // Africa/Lagos midnight
      if (Number.isNaN(ms)) throw new Error(`Invalid dateIso: ${iso}`);
      captureStartAt = ms;
      await ctx.db.patch(year._id, { captureStartAt: ms });
    }
    await recordAudit(ctx, {
      entityType: "performanceYear",
      entityId: year._id,
      action: "set_capture_start",
      reason: clear
        ? "Capture window opened for the whole year"
        : `KPI capture opens ${dateIso ?? "2026-07-01"} (Africa/Lagos)`,
      before: { captureStartAt: year.captureStartAt ?? null },
      after: { captureStartAt },
    });
    return { captureStartAt };
  },
});
