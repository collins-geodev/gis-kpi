/**
 * Activity capture + deterministic measurement recompute.
 *
 * Creating an activity records the raw inputs that support a KPI result, then
 * recomputes the provisional measurement for that (assignment, period) using the
 * scoring engine — the AI model is never involved. Evidence completeness gates
 * whether a measurement can later become an approved official score.
 */
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { AuthError, getAuthContext, requireRole, requireUser } from "./authz";
import { recordAudit } from "./audit";
import { recomputeMeasurement } from "./measurementsModel";
import { BASELINE_PERFORMANCE_YEAR, type Frequency } from "./lib/types";
import { captureGrainForFrequency } from "./lib/periods";

/**
 * Activities must land in the KPI's native cadence bucket (Quarterly → Qn,
 * Annually → year, Monthly/Daily/Weekly → month) so entries accumulate
 * against the full-cadence target instead of distorting a smaller bucket.
 */
async function assertPeriodMatchesCadence(
  ctx: QueryCtx,
  frequency: string,
  periodKey: string,
  opts: { isAdmin: boolean },
): Promise<void> {
  const period = await ctx.db
    .query("trackingPeriods")
    .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
    .first();
  if (!period) return; // unknown keys simply produce no measurement period
  const expected = captureGrainForFrequency(frequency as Frequency);
  if (period.grain !== expected) {
    throw new Error(
      `This KPI is tracked ${frequency.toLowerCase()} — choose the ${expected} period so entries add up against the full target.`,
    );
  }
  // Gate: once a period's grace window has elapsed it is closed for
  // self-service capture. KPI/System Admins bypass (they own reopening).
  if (!opts.isAdmin && ["closed", "locked"].includes(period.status)) {
    throw new Error(
      `${period.label} is closed for capture — ask an admin to reopen it from the Compliance page.`,
    );
  }
}

/**
 * The activity date must fall inside the tracking period it is logged to —
 * otherwise day/week breakdowns and backfilled entries would be mis-dated.
 * Unknown period keys are tolerated (consistent with assertPeriodMatchesCadence).
 */
async function assertActivityDateInPeriod(
  ctx: QueryCtx,
  periodKey: string,
  activityAt: number,
): Promise<void> {
  const period = await ctx.db
    .query("trackingPeriods")
    .withIndex("by_periodKey", (q) => q.eq("periodKey", periodKey))
    .first();
  if (!period) return;
  if (activityAt < period.startAt || activityAt > period.endAt) {
    throw new Error(
      `Activity date must fall inside ${period.label} — pick the day the work actually happened, or switch the period.`,
    );
  }
}

/** Inputs each measurement mode must supply — capture is all-fields-required. */
const REQUIRED_INPUTS: Record<string, string[]> = {
  ratio: ["numerator", "denominator"],
  durationSla: ["withinThreshold", "eligible"],
  count: ["quantity"],
  reduction: ["baseline", "currentValue"],
  milestone: ["completed", "planned"],
  binary: ["pass"],
  rubric: ["score", "maxScore"],
  composite: ["numerator", "denominator", "quantity"],
};

const INPUT_LABELS: Record<string, string> = {
  numerator: "Numerator",
  denominator: "Denominator",
  withinThreshold: "Resolved within threshold",
  eligible: "Total eligible items",
  quantity: "Count",
  baseline: "Baseline",
  currentValue: "Current value",
  completed: "Milestones completed",
  planned: "Milestones planned",
  pass: "Pass/fail",
  score: "Rubric score",
  maxScore: "Rubric max",
};

function assertCompleteCapture(
  measurementMode: string,
  fields: {
    title: string;
    description: string;
    [key: string]: string | number | boolean | undefined;
  },
): void {
  if (!fields.title.trim()) throw new Error("Title is required.");
  if (!fields.description.trim()) throw new Error("Notes are required.");
  for (const key of REQUIRED_INPUTS[measurementMode] ?? []) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(
        `${INPUT_LABELS[key] ?? key} is required for this KPI (${measurementMode} measurement).`,
      );
    }
  }
}

export const create = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    activityAt: v.number(),
    title: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    numerator: v.optional(v.number()),
    denominator: v.optional(v.number()),
    baseline: v.optional(v.number()),
    currentValue: v.optional(v.number()),
    withinThreshold: v.optional(v.number()),
    eligible: v.optional(v.number()),
    completed: v.optional(v.number()),
    planned: v.optional(v.number()),
    pass: v.optional(v.boolean()),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
    projectRef: v.optional(v.string()),
    ticketRef: v.optional(v.string()),
    assetRef: v.optional(v.string()),
  },
  returns: v.id("activities"),
  handler: async (ctx, args) => {
    const { user, roles } = await getAuthContext(ctx);
    const assignment = await ctx.db.get(args.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");

    const isOwner = user.employeeId && user.employeeId === assignment.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    if (!isOwner && !isAdmin) {
      throw new AuthError("You can only log activities for your own KPIs");
    }

    // Admin-pinned baseline is authoritative — whatever the client sent.
    if (assignment.measurementMode === "reduction" && assignment.pinnedBaseline != null) {
      args = { ...args, baseline: assignment.pinnedBaseline };
    }

    assertCompleteCapture(assignment.measurementMode, args);
    await assertPeriodMatchesCadence(ctx, assignment.frequency, args.periodKey, {
      isAdmin,
    });
    await assertActivityDateInPeriod(ctx, args.periodKey, args.activityAt);

    // Period-total modes: one entry IS the period's summary — block duplicates.
    if (isPeriodTotal(assignment.measurementMode, assignment.canonicalKey)) {
      const existing = (
        await ctx.db
          .query("activities")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", args.kpiAssignmentId).eq("periodKey", args.periodKey),
          )
          .take(20)
      ).filter((a) => DUPLICATE_BLOCKING_STATES.includes(a.status));
      if (existing.length > 0) {
        throw new Error(
          `This KPI has already been captured for ${args.periodKey} (“${existing[0]!.title.slice(0, 80)}”). A ${assignment.measurementMode} entry is the period's single summary — edit the existing entry (pencil icon under Recent activities) instead of logging it again.`,
        );
      }
    }

    const activityId = await ctx.db.insert("activities", {
      employeeId: assignment.employeeId,
      kpiAssignmentId: args.kpiAssignmentId,
      periodKey: args.periodKey,
      activityAt: args.activityAt,
      title: args.title.slice(0, 300),
      description: args.description.slice(0, 4000),
      quantity: args.quantity,
      numerator: args.numerator,
      denominator: args.denominator,
      baseline: args.baseline,
      currentValue: args.currentValue,
      withinThreshold: args.withinThreshold,
      eligible: args.eligible,
      completed: args.completed,
      planned: args.planned,
      pass: args.pass,
      score: args.score,
      maxScore: args.maxScore,
      durationHours: undefined,
      projectRef: args.projectRef,
      ticketRef: args.ticketRef,
      assetRef: args.assetRef,
      status: "submitted",
      createdByUserId: user._id,
      updatedByUserId: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await recomputeMeasurement(ctx, assignment, args.periodKey);

    await recordAudit(ctx, {
      entityType: "activity",
      entityId: activityId,
      action: "create_activity",
      actorUserId: user._id,
      after: { kpiAssignmentId: args.kpiAssignmentId, periodKey: args.periodKey },
    });

    // Notify admins + the actor (branded email if RESEND_API_KEY is configured,
    // in-app notification always). Scheduled so the mutation stays transactional.
    await ctx.scheduler.runAfter(0, internal.emails.notifyKpiUpdate, { activityId });

    return activityId;
  },
});

/** Recent activities across ALL employees — the admin/manager activity feed. */
export const listRecentAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireRole(ctx, [
      "system_admin",
      "kpi_admin",
      "manager",
      "reviewer",
      "auditor",
    ]);
    const rows = await ctx.db
      .query("activities")
      .order("desc")
      .take(Math.min(limit ?? 40, 100));
    const out = [];
    for (const a of rows) {
      const employee = await ctx.db.get(a.employeeId);
      const assignment = await ctx.db.get(a.kpiAssignmentId);
      const actor = await ctx.db.get(a.createdByUserId);
      const measurement = await ctx.db
        .query("kpiMeasurements")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", a.kpiAssignmentId).eq("periodKey", a.periodKey),
        )
        .first();
      out.push({
        id: a._id,
        title: a.title,
        description: a.description,
        periodKey: a.periodKey,
        activityAt: a.activityAt,
        createdAt: a.createdAt,
        status: a.status,
        employeeName: employee?.displayName ?? "Unknown",
        jobRole: employee?.jobRole ?? "",
        actorName: actor?.name ?? actor?.email ?? "system",
        objective: assignment?.objective ?? "",
        kpiAssignmentId: a.kpiAssignmentId,
        cappedAttainment: measurement?.cappedAttainment ?? null,
        measurementStatus: measurement?.status ?? "no_data",
      });
    }
    return out;
  },
});

/**
 * Modes where ONE entry is the period's summary (a second capture is a
 * duplicate by definition): ratio, reduction, binary and rubric. Incremental
 * modes (count/durationSla/milestone/composite) legitimately accumulate.
 */
const PERIOD_TOTAL_MODES = ["ratio", "reduction", "binary", "rubric"];

/**
 * Ratio KPIs whose entries are incremental batch logs rather than one period
 * summary — numerators/denominators sum across the period (QA batches are
 * logged as they happen).
 */
export const ACCUMULATING_RATIO_KEYS = ["qa_data_quality"];

/** Whether one entry is this KPI's whole period summary (duplicates blocked). */
function isPeriodTotal(measurementMode: string, canonicalKey: string): boolean {
  return (
    PERIOD_TOTAL_MODES.includes(measurementMode) &&
    !ACCUMULATING_RATIO_KEYS.includes(canonicalKey)
  );
}

const DUPLICATE_BLOCKING_STATES = [
  "draft",
  "submitted",
  "needs_changes",
  "verified",
  "approved",
  "locked",
];

/**
 * What is already captured for one (KPI, period) — powers the duplicate
 * warning/blocker in the capture form.
 */
export const existingForPeriod = query({
  args: { kpiAssignmentId: v.id("kpiAssignments"), periodKey: v.string() },
  handler: async (ctx, { kpiAssignmentId, periodKey }) => {
    const { user, roles } = await getAuthContext(ctx);
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) return null;
    const isOwner = user.employeeId && user.employeeId === assignment.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    if (!isOwner && !isAdmin) return null;

    const rows = (
      await ctx.db
        .query("activities")
        .withIndex("by_assignment_period", (q) =>
          q.eq("kpiAssignmentId", kpiAssignmentId).eq("periodKey", periodKey),
        )
        .take(100)
    ).filter((a) => DUPLICATE_BLOCKING_STATES.includes(a.status));

    // Raw inputs of the entries that count toward the measurement, so the
    // capture form can preview "period so far" through the real engine.
    const MEASURED_STATES = ["submitted", "verified", "approved"];
    return {
      count: rows.length,
      singleEntry: isPeriodTotal(assignment.measurementMode, assignment.canonicalKey),
      entries: rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((a) => ({ id: a._id, title: a.title, status: a.status })),
      countedInputs: rows
        .filter((a) => MEASURED_STATES.includes(a.status))
        .map((a) => ({
          id: a._id,
          activityAt: a.activityAt,
          quantity: a.quantity ?? null,
          numerator: a.numerator ?? null,
          denominator: a.denominator ?? null,
          baseline: a.baseline ?? null,
          currentValue: a.currentValue ?? null,
          withinThreshold: a.withinThreshold ?? null,
          eligible: a.eligible ?? null,
          completed: a.completed ?? null,
          planned: a.planned ?? null,
          pass: a.pass ?? null,
          score: a.score ?? null,
          maxScore: a.maxScore ?? null,
        })),
    };
  },
});

/**
 * Delete a mistaken activity and recompute the affected measurement.
 * Owners may delete their own entries while still in the pre-approval states;
 * KPI/System Admins may delete anything except locked records. Audit-logged
 * with the full former payload so nothing disappears untraceably.
 */
export const remove = mutation({
  args: { activityId: v.id("activities") },
  returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const { user, roles } = await getAuthContext(ctx);
    const activity = await ctx.db.get(activityId);
    if (!activity) throw new Error("Activity not found");
    const assignment = await ctx.db.get(activity.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");

    const isOwner = user.employeeId && user.employeeId === activity.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    const OWNER_DELETABLE = ["draft", "submitted", "needs_changes"];
    if (isAdmin) {
      if (activity.status === "locked") {
        throw new AuthError("Locked activities cannot be deleted.");
      }
    } else if (isOwner) {
      if (!OWNER_DELETABLE.includes(activity.status)) {
        throw new AuthError(
          "This activity has already been reviewed — ask an admin to remove it.",
        );
      }
    } else {
      throw new AuthError("You can only delete your own activities");
    }

    await ctx.db.delete(activityId);
    await recomputeMeasurement(ctx, assignment, activity.periodKey);

    await recordAudit(ctx, {
      entityType: "activity",
      entityId: activityId,
      action: "delete_activity",
      actorUserId: user._id,
      before: activity,
    });
    return null;
  },
});

/** Full editable payload of one activity (owner or KPI/System Admin). */
export const getForEdit = query({
  args: { activityId: v.id("activities") },
  handler: async (ctx, { activityId }) => {
    const { user, roles } = await getAuthContext(ctx);
    const activity = await ctx.db.get(activityId);
    if (!activity) return null;
    const isOwner = user.employeeId && user.employeeId === activity.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    if (!isOwner && !isAdmin) throw new AuthError("Not your activity");
    return {
      id: activity._id,
      kpiAssignmentId: activity.kpiAssignmentId,
      periodKey: activity.periodKey,
      activityAt: activity.activityAt,
      title: activity.title,
      description: activity.description,
      status: activity.status,
      quantity: activity.quantity,
      numerator: activity.numerator,
      denominator: activity.denominator,
      baseline: activity.baseline,
      currentValue: activity.currentValue,
      withinThreshold: activity.withinThreshold,
      eligible: activity.eligible,
      completed: activity.completed,
      planned: activity.planned,
      pass: activity.pass,
      score: activity.score,
      maxScore: activity.maxScore,
    };
  },
});

/**
 * Edit an activity's capture fields. Same permission rules as `remove`;
 * an edited "needs_changes" entry returns to "submitted" for re-review.
 * Measurements recompute for the original period and, when the period was
 * moved, the new one too.
 */
export const update = mutation({
  args: {
    activityId: v.id("activities"),
    periodKey: v.string(),
    activityAt: v.optional(v.number()),
    title: v.string(),
    description: v.string(),
    quantity: v.optional(v.number()),
    numerator: v.optional(v.number()),
    denominator: v.optional(v.number()),
    baseline: v.optional(v.number()),
    currentValue: v.optional(v.number()),
    withinThreshold: v.optional(v.number()),
    eligible: v.optional(v.number()),
    completed: v.optional(v.number()),
    planned: v.optional(v.number()),
    pass: v.optional(v.boolean()),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, roles } = await getAuthContext(ctx);
    const activity = await ctx.db.get(args.activityId);
    if (!activity) throw new Error("Activity not found");
    const assignment = await ctx.db.get(activity.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");

    const isOwner = user.employeeId && user.employeeId === activity.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    const OWNER_EDITABLE = ["draft", "submitted", "needs_changes"];
    if (isAdmin) {
      if (activity.status === "locked") {
        throw new AuthError("Locked activities cannot be edited.");
      }
    } else if (isOwner) {
      if (!OWNER_EDITABLE.includes(activity.status)) {
        throw new AuthError(
          "This activity has already been reviewed — ask an admin to change it.",
        );
      }
    } else {
      throw new AuthError("You can only edit your own activities");
    }

    // Admin-pinned baseline is authoritative — whatever the client sent.
    if (assignment.measurementMode === "reduction" && assignment.pinnedBaseline != null) {
      args = { ...args, baseline: assignment.pinnedBaseline };
    }

    assertCompleteCapture(assignment.measurementMode, args);
    await assertPeriodMatchesCadence(ctx, assignment.frequency, args.periodKey, {
      isAdmin,
    });
    const activityAt = args.activityAt ?? activity.activityAt;
    await assertActivityDateInPeriod(ctx, args.periodKey, activityAt);

    const before = { ...activity };
    const oldPeriodKey = activity.periodKey;
    await ctx.db.patch(args.activityId, {
      periodKey: args.periodKey,
      activityAt,
      title: args.title.slice(0, 300),
      description: args.description.slice(0, 4000),
      quantity: args.quantity,
      numerator: args.numerator,
      denominator: args.denominator,
      baseline: args.baseline,
      currentValue: args.currentValue,
      withinThreshold: args.withinThreshold,
      eligible: args.eligible,
      completed: args.completed,
      planned: args.planned,
      pass: args.pass,
      score: args.score,
      maxScore: args.maxScore,
      status: activity.status === "needs_changes" ? "submitted" : activity.status,
      updatedByUserId: user._id,
      updatedAt: Date.now(),
    });

    await recomputeMeasurement(ctx, assignment, oldPeriodKey);
    if (args.periodKey !== oldPeriodKey) {
      await recomputeMeasurement(ctx, assignment, args.periodKey);
    }

    await recordAudit(ctx, {
      entityType: "activity",
      entityId: args.activityId,
      action: "update_activity",
      actorUserId: user._id,
      before,
      after: { periodKey: args.periodKey, title: args.title },
    });
    return null;
  },
});

/** Tracking periods available for logging (2026 month/quarter/year). */
export const periods = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("trackingPeriods").take(500);
    return rows
      .sort((a, b) => a.startAt - b.startAt)
      .map((p) => ({
        periodKey: p.periodKey,
        label: p.label,
        grain: p.grain,
        startAt: p.startAt,
        endAt: p.endAt,
      }));
  },
});

/** The current user's own KPI assignments (for the capture form). */
export const myAssignments = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.employeeId) return [];
    const year = await ctx.db
      .query("performanceYears")
      .withIndex("by_year", (q) => q.eq("year", BASELINE_PERFORMANCE_YEAR))
      .first();
    if (!year) return [];
    const assignments = await ctx.db
      .query("kpiAssignments")
      .withIndex("by_employee_year", (q) =>
        q.eq("employeeId", user.employeeId!).eq("performanceYearId", year._id),
      )
      .collect();
    return assignments
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((a) => ({
        id: a._id,
        objective: a.objective,
        metric: a.metric,
        canonicalKey: a.canonicalKey,
        measurementMode: a.measurementMode,
        direction: a.direction,
        targetType: a.targetType,
        target: a.target,
        frequency: a.frequency,
        weight: a.weight,
        evidenceRequired: a.evidenceRequired,
        pinnedBaseline: a.pinnedBaseline ?? null,
        scoringBlocked: a.scoringBlocked,
        kpiCategory: a.kpiCategory ?? "core",
      }));
  },
});

/** Recent activities for the current user's employee. */
export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const user = await requireUser(ctx);
    if (!user.employeeId) return [];
    const rows = await ctx.db
      .query("activities")
      .withIndex("by_employee_period", (q) => q.eq("employeeId", user.employeeId!))
      .take(Math.min(limit ?? 25, 100));
    return rows
      .sort((a, b) => b.activityAt - a.activityAt)
      .map((a) => ({
        id: a._id,
        title: a.title,
        periodKey: a.periodKey,
        activityAt: a.activityAt,
        status: a.status,
        kpiAssignmentId: a.kpiAssignmentId,
      }));
  },
});
