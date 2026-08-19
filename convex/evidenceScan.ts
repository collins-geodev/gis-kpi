/**
 * Malware scanning for uploaded evidence files — the integration point behind
 * `evidenceFiles.scanStatus`. Same graceful pattern as email: fully wired, and
 * dormant until a scanner endpoint is configured.
 *
 * Config (Convex env):
 *   MALWARE_SCAN_WEBHOOK_URL    — scanning service endpoint. The file bytes are
 *                                 POSTed to it; it must answer 200 with JSON
 *                                 {"verdict": "clean" | "flagged", "detail"?: string}.
 *   MALWARE_SCAN_WEBHOOK_TOKEN  — optional bearer token for that endpoint.
 *
 * Unconfigured → files stay scanStatus "pending" (uploads and review continue;
 * only a *flagged* verdict blocks downloads). Flagged → downloads are blocked
 * and every System Admin is alerted in-app/by email.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { adminUsers, resolveDisplayName } from "./emails";

const vVerdict = v.union(v.literal("clean"), v.literal("flagged"));

export const getScanTarget = internalQuery({
  args: { evidenceId: v.id("evidenceFiles") },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.union(v.id("_storage"), v.null()),
      filename: v.string(),
      mimeType: v.string(),
      scanStatus: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { evidenceId }) => {
    const e = await ctx.db.get(evidenceId);
    if (!e) return null;
    return {
      storageId: e.storageId ?? null,
      filename: e.originalFilename,
      mimeType: e.mimeType,
      scanStatus: e.scanStatus ?? null,
    };
  },
});

export const recordVerdict = internalMutation({
  args: {
    evidenceId: v.id("evidenceFiles"),
    verdict: vVerdict,
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { evidenceId, verdict, detail }) => {
    const evidence = await ctx.db.get(evidenceId);
    if (!evidence) return null;
    await ctx.db.patch(evidenceId, { scanStatus: verdict });
    await ctx.db.insert("auditLogs", {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: verdict === "flagged" ? "malware_flagged" : "malware_scan_clean",
      after: { verdict, detail },
      at: Date.now(),
    });

    if (verdict === "flagged") {
      // Downloads are now blocked; put it in front of every System Admin.
      const employee = await ctx.db.get(evidence.employeeId);
      const notices = [];
      for (const admin of await adminUsers(ctx)) {
        notices.push({
          userId: admin._id,
          email: admin.email!,
          recipientName: await resolveDisplayName(ctx, admin),
          subject: `Malware flagged — evidence "${evidence.title.slice(0, 60)}"`,
          intro: `The malware scanner *flagged* an uploaded evidence file for *${employee?.displayName ?? "an employee"}*. Downloads of this file are blocked. Review it and reject or delete the submission.`,
          panelTitle: "Flagged file",
          rows: [
            { label: "Evidence", value: evidence.title.slice(0, 200), strong: true },
            { label: "File", value: evidence.originalFilename },
            {
              label: "Employee",
              value: `${employee?.displayName ?? "—"} (${employee?.employeeId ?? "—"})`,
            },
            { label: "Scanner detail", value: (detail ?? "no detail").slice(0, 300) },
          ],
          ctaLabel: "Open the KPI",
          ctaPath: evidence.kpiAssignmentId
            ? `/kpi/${evidence.kpiAssignmentId}`
            : "/evidence",
          inAppTitle: "Malware flagged in uploaded evidence",
          inAppBody: `${evidence.originalFilename} — downloads blocked.`,
        });
      }
      if (notices.length > 0) {
        await ctx.scheduler.runAfter(0, internal.emails.sendNotices, {
          entityType: "evidenceFile",
          entityId: evidenceId,
          auditAction: "malware_flagged",
          notices,
        });
      }
    }
    return null;
  },
});

export const recordScanError = internalMutation({
  args: { evidenceId: v.id("evidenceFiles"), detail: v.string() },
  returns: v.null(),
  handler: async (ctx, { evidenceId, detail }) => {
    // Stays "pending" — an unreachable scanner must not fake a verdict.
    await ctx.db.insert("auditLogs", {
      entityType: "evidenceFile",
      entityId: evidenceId,
      action: "malware_scan_error",
      after: { detail: detail.slice(0, 300) },
      at: Date.now(),
    });
    return null;
  },
});

/** Scan one uploaded evidence file (scheduled from saveEvidence). */
export const scanEvidence = internalAction({
  args: { evidenceId: v.id("evidenceFiles") },
  returns: v.null(),
  handler: async (ctx, { evidenceId }) => {
    const url = process.env.MALWARE_SCAN_WEBHOOK_URL;
    if (!url) return null; // integration point dormant — file stays "pending"

    const target = await ctx.runQuery(internal.evidenceScan.getScanTarget, {
      evidenceId,
    });
    if (!target?.storageId) return null; // links and deleted rows are not scannable

    const blob = await ctx.storage.get(target.storageId);
    if (!blob) return null;

    try {
      const token = process.env.MALWARE_SCAN_WEBHOOK_TOKEN;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": target.mimeType || "application/octet-stream",
          "X-Filename": target.filename,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: blob,
      });
      if (!res.ok) {
        await ctx.runMutation(internal.evidenceScan.recordScanError, {
          evidenceId,
          detail: `scanner responded ${res.status}`,
        });
        return null;
      }
      const body = (await res.json()) as { verdict?: string; detail?: string };
      if (body.verdict !== "clean" && body.verdict !== "flagged") {
        await ctx.runMutation(internal.evidenceScan.recordScanError, {
          evidenceId,
          detail: `invalid scanner verdict: ${String(body.verdict).slice(0, 60)}`,
        });
        return null;
      }
      await ctx.runMutation(internal.evidenceScan.recordVerdict, {
        evidenceId,
        verdict: body.verdict,
        detail: body.detail,
      });
    } catch (err) {
      await ctx.runMutation(internal.evidenceScan.recordScanError, {
        evidenceId,
        detail: err instanceof Error ? err.message : "network error",
      });
    }
    return null;
  },
});
