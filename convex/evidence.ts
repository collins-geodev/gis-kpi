/**
 * Evidence access authorization + audit (used by the authenticated file-serving
 * HTTP route). Full evidence CRUD lives alongside the activity/evidence
 * workflow; these two internal functions gate download access on every request.
 */
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { adminUsers, resolveDisplayName } from "./emails";
import {
  assertEmployeeReadScope,
  assertEvidenceAccess,
  AuthError,
  getAuthContext,
  readableEmployeeIds,
  requireRole,
} from "./authz";
import { recordAudit } from "./audit";
import { recomputeMeasurement } from "./measurementsModel";
import { vConfidentiality } from "./validators";

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "evidence";
}

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "application/vnd", // office
  "application/msword",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
];

export const authorizeDownload = internalQuery({
  args: { evidenceId: v.id("evidenceFiles") },
  returns: v.object({
    allowed: v.boolean(),
    status: v.number(),
    message: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    storageId: v.optional(v.union(v.id("_storage"), v.null())),
    externalUrl: v.optional(v.union(v.string(), v.null())),
    mimeType: v.optional(v.string()),
    filename: v.optional(v.string()),
  }),
  handler: async (ctx, { evidenceId }) => {
    const evidence = await ctx.db.get(evidenceId);
    if (!evidence) return { allowed: false, status: 404, message: "Not found" };
    if (evidence.retentionState === "deleted") {
      return { allowed: false, status: 410, message: "Evidence deleted" };
    }
    try {
      const { user } = await assertEvidenceAccess(ctx, evidence, "content");
      return {
        allowed: true,
        status: 200,
        userId: user._id,
        storageId: evidence.storageId ?? null,
        externalUrl: evidence.externalUrl ?? null,
        mimeType: evidence.mimeType,
        filename: evidence.originalFilename,
      };
    } catch (e) {
      const status = e instanceof AuthError ? e.status : 403;
      return { allowed: false, status, message: "Forbidden" };
    }
  },
});

export const logAccess = internalMutation({
  args: { evidenceId: v.id("evidenceFiles"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { evidenceId, userId }) => {
    await recordAudit(ctx, {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: "download",
      actorUserId: userId,
    });
    return null;
  },
});

/** Short-lived upload URL for direct-to-storage evidence uploads. */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await getAuthContext(ctx); // authenticated with a role
    return await ctx.storage.generateUploadUrl();
  },
});

/** Persist evidence metadata (file already uploaded, or an approved link). */
export const saveEvidence = mutation({
  args: {
    kpiAssignmentId: v.id("kpiAssignments"),
    activityId: v.optional(v.id("activities")),
    periodKey: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    externalUrl: v.optional(v.string()),
    originalFilename: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
    checksum: v.optional(v.string()),
    category: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    confidentiality: v.optional(vConfidentiality),
  },
  returns: v.id("evidenceFiles"),
  handler: async (ctx, args) => {
    const { user, roles } = await getAuthContext(ctx);
    const assignment = await ctx.db.get(args.kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");

    const isOwner = user.employeeId && user.employeeId === assignment.employeeId;
    const isAdmin = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
    if (!isOwner && !isAdmin) {
      throw new AuthError("You can only attach evidence to your own KPIs");
    }
    if (!args.storageId && !args.externalUrl) {
      throw new Error("Provide either an uploaded file or an external URL.");
    }
    if (args.fileSize > MAX_EVIDENCE_BYTES) {
      throw new Error("File exceeds the 25 MB evidence limit.");
    }
    if (
      args.storageId &&
      !ALLOWED_MIME_PREFIXES.some((p) => args.mimeType.startsWith(p))
    ) {
      throw new Error(`Unsupported file type: ${args.mimeType}`);
    }

    const evidenceId = await ctx.db.insert("evidenceFiles", {
      employeeId: assignment.employeeId,
      kpiAssignmentId: args.kpiAssignmentId,
      activityId: args.activityId,
      periodKey: args.periodKey,
      storageId: args.storageId,
      externalUrl: args.externalUrl,
      originalFilename: sanitizeFilename(args.originalFilename),
      mimeType: args.mimeType,
      fileSize: args.fileSize,
      checksum: args.checksum,
      category: args.category.slice(0, 80),
      title: args.title.slice(0, 200),
      description: args.description?.slice(0, 2000),
      uploadedByUserId: user._id,
      uploadedAt: Date.now(),
      version: 1,
      confidentiality: args.confidentiality ?? "internal",
      reviewStatus: "submitted",
      retentionState: "active",
      scanStatus: "pending",
    });

    await recordAudit(ctx, {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: "upload_evidence",
      actorUserId: user._id,
      after: { kpiAssignmentId: args.kpiAssignmentId },
    });

    // Submitting for review notifies every System Admin (email + in-app).
    const employee = await ctx.db.get(assignment.employeeId);
    const uploaderName = await resolveDisplayName(ctx, user);
    const notices = [];
    for (const admin of await adminUsers(ctx)) {
      if (admin._id === user._id) continue;
      notices.push({
        userId: admin._id,
        email: admin.email!,
        recipientName: await resolveDisplayName(ctx, admin),
        subject: `Evidence awaiting review — ${employee?.displayName ?? "employee"}: ${args.title.slice(0, 80)}`,
        intro: `*${uploaderName}* submitted evidence for *${employee?.displayName ?? "an employee"}*'s KPI. It is now awaiting verification and approval.`,
        panelTitle: "Evidence details",
        rows: [
          { label: "Evidence", value: args.title.slice(0, 200), strong: true },
          { label: "KPI objective", value: assignment.objective },
          {
            label: "Employee",
            value: `${employee?.displayName ?? "—"} (${employee?.employeeId ?? "—"})`,
          },
          { label: "Category", value: args.category.slice(0, 80) },
          {
            label: "File",
            value: args.storageId
              ? args.originalFilename.slice(0, 120)
              : (args.externalUrl ?? "link"),
          },
        ],
        ctaLabel: "Review in the dashboard",
        ctaPath: `/kpi/${args.kpiAssignmentId}`,
        inAppTitle: `Evidence awaiting review — ${employee?.displayName ?? "employee"}`,
        inAppBody: args.title.slice(0, 200),
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "evidenceFile",
        entityId: evidenceId,
        auditAction: "evidence_submitted",
        notices,
      });
    }
    return evidenceId;
  },
});

/**
 * One-click reviewer action for the review queue: approve every pending
 * (submitted/verified) evidence item on a KPI, recompute its gates once, and
 * send the employee a single combined notification.
 */
export const approveAllForAssignment = mutation({
  args: { kpiAssignmentId: v.id("kpiAssignments") },
  returns: v.object({ approved: v.number() }),
  handler: async (ctx, { kpiAssignmentId }) => {
    const { user } = await requireRole(ctx, [
      "reviewer",
      "manager",
      "kpi_admin",
      "system_admin",
    ]);
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    await assertEmployeeReadScope(ctx, assignment.employeeId);

    const evidence = await ctx.db
      .query("evidenceFiles")
      .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", kpiAssignmentId))
      .take(500);
    const pending = evidence.filter((e) =>
      ["submitted", "verified"].includes(e.reviewStatus),
    );
    if (pending.length === 0) return { approved: 0 };

    for (const e of pending) {
      await ctx.db.patch(e._id, { reviewStatus: "approved" });
    }

    const measurements = await ctx.db
      .query("kpiMeasurements")
      .withIndex("by_assignment_period", (q) =>
        q.eq("kpiAssignmentId", kpiAssignmentId),
      )
      .take(500);
    const periods = new Set(measurements.map((m) => m.periodKey));
    for (const e of pending) if (e.periodKey) periods.add(e.periodKey);
    for (const periodKey of periods) {
      await recomputeMeasurement(ctx, assignment, periodKey);
    }

    await recordAudit(ctx, {
      entityType: "evidenceFile",
      entityId: kpiAssignmentId,
      action: "evidence_bulk_approve",
      actorUserId: user._id,
      after: { approved: pending.length, titles: pending.map((e) => e.title.slice(0, 80)) },
    });

    const reviewerName = await resolveDisplayName(ctx, user);
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", assignment.employeeId))
      .take(10);
    const notices = [];
    for (const target of linked) {
      if (!target.email || target.isActive === false || target._id === user._id) continue;
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Your evidence was approved — ${assignment.objective.slice(0, 80)}`,
        intro: `*${reviewerName}* approved ${pending.length === 1 ? "your evidence item" : `all ${pending.length} pending evidence items`} for “${assignment.objective.slice(0, 120)}”. It now counts toward the evidence gate for official scoring.`,
        panelTitle: "Review decision",
        rows: [
          { label: "KPI objective", value: assignment.objective.slice(0, 200) },
          { label: "Items approved", value: String(pending.length), strong: true },
        ],
        ctaLabel: "Open in the dashboard",
        ctaPath: `/kpi/${kpiAssignmentId}`,
        inAppTitle: `Evidence approved — ${assignment.objective.slice(0, 80)}`,
        inAppBody: `${reviewerName} approved ${pending.length} evidence item${pending.length === 1 ? "" : "s"}.`,
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "evidenceFile",
        entityId: kpiAssignmentId,
        auditAction: "evidence_decision_approved",
        notices,
      });
    }
    return { approved: pending.length };
  },
});

/** Reviewer decision on an evidence item; approval unblocks scoring gates. */
export const reviewEvidence = mutation({
  args: {
    evidenceId: v.id("evidenceFiles"),
    decision: v.union(v.literal("verify"), v.literal("approve"), v.literal("reject")),
    comment: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { evidenceId, decision, comment }) => {
    const { user } = await requireRole(ctx, [
      "reviewer",
      "manager",
      "kpi_admin",
      "system_admin",
    ]);
    const evidence = await ctx.db.get(evidenceId);
    if (!evidence) throw new Error("Evidence not found");
    await assertEmployeeReadScope(ctx, evidence.employeeId);
    if (decision === "reject" && !comment) {
      throw new Error("A comment is required to reject evidence.");
    }

    const reviewStatus =
      decision === "approve"
        ? "approved"
        : decision === "verify"
          ? "verified"
          : "rejected";
    await ctx.db.patch(evidenceId, { reviewStatus, reviewerComments: comment });

    // Approving/removing approval changes evidence completeness — recompute.
    if (evidence.kpiAssignmentId) {
      const assignment = await ctx.db.get(evidence.kpiAssignmentId);
      if (assignment) {
        const measurements = await ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignment._id),
          )
          .take(500);
        const periods = new Set(measurements.map((m) => m.periodKey));
        if (evidence.periodKey) periods.add(evidence.periodKey);
        for (const periodKey of periods) {
          await recomputeMeasurement(ctx, assignment, periodKey);
        }
      }
    }

    await recordAudit(ctx, {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: `evidence_${decision}`,
      actorUserId: user._id,
      reason: comment,
      before: { reviewStatus: evidence.reviewStatus },
      after: { reviewStatus },
    });

    // The decision notifies the employee's account(s) and the uploader.
    const reviewerName = await resolveDisplayName(ctx, user);
    const assignment = evidence.kpiAssignmentId
      ? await ctx.db.get(evidence.kpiAssignmentId)
      : null;
    const targets = new Map<string, (typeof user & { email?: string }) | null>();
    const linked = await ctx.db
      .query("users")
      .withIndex("by_employee", (q) => q.eq("employeeId", evidence.employeeId))
      .take(10);
    for (const u of linked) targets.set(u._id, u);
    const uploader = await ctx.db.get(evidence.uploadedByUserId);
    if (uploader) targets.set(uploader._id, uploader);
    targets.delete(user._id); // don't notify the reviewer about their own decision

    const outcomeText =
      reviewStatus === "approved"
        ? "It now counts toward the evidence gate for official scoring."
        : reviewStatus === "verified"
          ? "It has been verified and awaits final approval."
          : "See the reviewer's comment below, then update and re-submit.";
    const notices = [];
    for (const target of targets.values()) {
      if (!target?.email || target.isActive === false) continue;
      notices.push({
        userId: target._id,
        email: target.email,
        recipientName: await resolveDisplayName(ctx, target),
        subject: `Your evidence was ${reviewStatus} — ${evidence.title.slice(0, 80)}`,
        intro: `*${reviewerName}* has ${reviewStatus} the evidence “${evidence.title.slice(0, 120)}”. ${outcomeText}`,
        panelTitle: "Review decision",
        rows: [
          { label: "Evidence", value: evidence.title.slice(0, 200) },
          { label: "KPI objective", value: assignment?.objective ?? "—" },
          { label: "Decision", value: reviewStatus.toUpperCase(), strong: true },
          ...(comment
            ? [{ label: "Reviewer comment", value: comment.slice(0, 500) }]
            : []),
        ],
        ctaLabel: "Open in the dashboard",
        ctaPath: evidence.kpiAssignmentId
          ? `/kpi/${evidence.kpiAssignmentId}`
          : "/evidence",
        inAppTitle: `Evidence ${reviewStatus} — ${evidence.title.slice(0, 80)}`,
        inAppBody: comment ? `${reviewStatus}: ${comment.slice(0, 180)}` : reviewStatus,
      });
    }
    if (notices.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
        entityType: "evidenceFile",
        entityId: evidenceId,
        auditAction: `evidence_decision_${reviewStatus}`,
        notices,
      });
    }
    return null;
  },
});

/** May this user delete this evidence item? (Shared by queries + mutation.) */
function canDeleteEvidence(
  evidence: {
    retentionState: string;
    reviewStatus: string;
    employeeId: string;
    uploadedByUserId: string;
  },
  user: { _id: string; employeeId?: string },
  roles: string[],
): boolean {
  if (evidence.retentionState !== "active") return false;
  if (roles.includes("kpi_admin") || roles.includes("system_admin")) return true;
  const isOwner =
    (user.employeeId && user.employeeId === evidence.employeeId) ||
    evidence.uploadedByUserId === user._id;
  return (
    Boolean(isOwner) &&
    ["draft", "submitted", "needs_changes", "rejected"].includes(evidence.reviewStatus)
  );
}

/**
 * Delete an evidence item. Owners may remove their own while it is still
 * pre-approval (submitted/needs_changes/rejected); KPI/System Admins anything
 * except legal holds. Soft-delete: the stored file is destroyed, the metadata
 * row is retained as `deleted` for the audit trail, and the affected KPI's
 * evidence-completeness gate recomputes.
 */
export const removeEvidence = mutation({
  args: { evidenceId: v.id("evidenceFiles") },
  returns: v.null(),
  handler: async (ctx, { evidenceId }) => {
    const { user, roles } = await getAuthContext(ctx);
    const evidence = await ctx.db.get(evidenceId);
    if (!evidence) throw new Error("Evidence not found");
    if (evidence.retentionState === "deleted") return null;
    if (evidence.retentionState === "legal_hold") {
      throw new AuthError("This item is under legal hold and cannot be deleted.");
    }
    if (!canDeleteEvidence(evidence, user, roles)) {
      throw new AuthError(
        ["approved", "verified"].includes(evidence.reviewStatus)
          ? "Reviewed evidence can only be deleted by a KPI/System Admin."
          : "You can only delete evidence you uploaded or that belongs to your KPIs.",
      );
    }

    if (evidence.storageId) await ctx.storage.delete(evidence.storageId);
    await ctx.db.patch(evidenceId, {
      retentionState: "deleted",
      storageId: undefined,
    });

    // Deleting approved evidence can reopen the completeness gate — recompute.
    if (evidence.kpiAssignmentId) {
      const assignment = await ctx.db.get(evidence.kpiAssignmentId);
      if (assignment) {
        const measurements = await ctx.db
          .query("kpiMeasurements")
          .withIndex("by_assignment_period", (q) =>
            q.eq("kpiAssignmentId", assignment._id),
          )
          .take(500);
        const periods = new Set(measurements.map((m) => m.periodKey));
        if (evidence.periodKey) periods.add(evidence.periodKey);
        for (const periodKey of periods) {
          await recomputeMeasurement(ctx, assignment, periodKey);
        }
      }
    }

    await recordAudit(ctx, {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: "delete_evidence",
      actorUserId: user._id,
      before: {
        title: evidence.title,
        originalFilename: evidence.originalFilename,
        reviewStatus: evidence.reviewStatus,
        kpiAssignmentId: evidence.kpiAssignmentId,
      },
    });
    return null;
  },
});

/**
 * Every evidence item the caller may read, newest first — the Evidence Centre
 * feed. Employees see their own; managers/reviewers their scope; org-wide
 * roles everything. Joined with the KPI objective and employee for display.
 */
export const listCentre = query({
  args: {},
  handler: async (ctx) => {
    const readable = await readableEmployeeIds(ctx);
    let rows;
    if (readable === "all") {
      rows = await ctx.db.query("evidenceFiles").take(500);
    } else {
      rows = [];
      for (const employeeId of readable) {
        const chunk = await ctx.db
          .query("evidenceFiles")
          .withIndex("by_employee_period", (q) => q.eq("employeeId", employeeId))
          .take(200);
        rows.push(...chunk);
      }
    }
    rows = rows
      .filter((e) => e.retentionState !== "deleted")
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .slice(0, 400);

    const { user, roles } = await getAuthContext(ctx);
    const out = [];
    for (const e of rows) {
      const assignment = e.kpiAssignmentId ? await ctx.db.get(e.kpiAssignmentId) : null;
      const employee = await ctx.db.get(e.employeeId);
      out.push({
        id: e._id,
        canDelete: canDeleteEvidence(e, user, roles),
        title: e.title,
        category: e.category,
        reviewStatus: e.reviewStatus,
        confidentiality: e.confidentiality,
        originalFilename: e.originalFilename,
        mimeType: e.mimeType,
        fileSize: e.fileSize,
        uploadedAt: e.uploadedAt,
        periodKey: e.periodKey ?? null,
        hasFile: e.storageId !== undefined,
        externalUrl: e.externalUrl ?? null,
        kpiAssignmentId: e.kpiAssignmentId ?? null,
        objective: assignment?.objective ?? null,
        employeeName: employee?.displayName ?? "—",
      });
    }
    return out;
  },
});

/** Evidence attached to a KPI assignment (permission-aware metadata). */
export const listForAssignment = query({
  args: { kpiAssignmentId: v.id("kpiAssignments") },
  handler: async (ctx, { kpiAssignmentId }) => {
    const assignment = await ctx.db.get(kpiAssignmentId);
    if (!assignment) throw new Error("KPI assignment not found");
    const { user, roles } = await assertEmployeeReadScope(ctx, assignment.employeeId);
    const rows = await ctx.db
      .query("evidenceFiles")
      .withIndex("by_assignment", (q) => q.eq("kpiAssignmentId", kpiAssignmentId))
      .take(200);
    return rows
      .filter((e) => e.retentionState !== "deleted")
      .map((e) => ({
        id: e._id,
        canDelete: canDeleteEvidence(e, user, roles),
        title: e.title,
        category: e.category,
        originalFilename: e.originalFilename,
        mimeType: e.mimeType,
        fileSize: e.fileSize,
        reviewStatus: e.reviewStatus,
        confidentiality: e.confidentiality,
        hasFile: e.storageId !== undefined,
        externalUrl: e.externalUrl ?? null,
        uploadedAt: e.uploadedAt,
      }));
  },
});
