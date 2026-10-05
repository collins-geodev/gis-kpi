"use client";

import { errorMessage } from "@/lib/errors";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import type { AppRole } from "@convex/lib/types";
import { suggestEvidence } from "@/lib/evidence-suggestions";
import { formatDate, formatDateTime, periodLabel } from "@convex/lib/format";

/** SHA-256 of a file (hex) — lets admins spot the same file uploaded twice. */
async function sha256Hex(file: File): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return undefined; // never block an upload on the fingerprint
  }
}

const REVIEW_VARIANT: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  submitted: "muted",
  verified: "info",
  approved: "success",
  rejected: "critical",
  needs_changes: "warning",
};

export function EvidencePanel({
  assignmentId,
  kpi,
  deferNotice,
  periodKey,
  activityAt,
}: {
  assignmentId: Id<"kpiAssignments">;
  /** When provided, the title/category start with a KPI-aware suggestion. */
  kpi?: { canonicalKey?: string; objective?: string };
  /**
   * True inside the Activity Capture form: attachments are a step of a
   * submission still being written, so no notifications fire on upload —
   * saving the activity is the announced event.
   */
  deferNotice?: boolean;
  /** The capture period this evidence supports (e.g. "2026-M07"). */
  periodKey?: string;
  /** The work-date selected in the capture form — shown beside the file name. */
  activityAt?: number;
}) {
  const me = useQuery(api.access.currentUser);
  const evidence = useQuery(api.evidence.listForAssignment, {
    kpiAssignmentId: assignmentId,
  });
  const generateUploadUrl = useMutation(api.evidence.generateUploadUrl);
  const saveEvidence = useMutation(api.evidence.saveEvidence);
  const reviewEvidence = useMutation(api.evidence.reviewEvidence);
  const removeEvidence = useMutation(api.evidence.removeEvidence);
  const setEvidencePeriod = useMutation(api.evidence.setEvidencePeriod);
  const [retagging, setRetagging] = useState<string | null>(null);

  const roles = (me?.roles ?? []) as AppRole[];
  const canReview = roles.some((r) =>
    ["reviewer", "manager", "kpi_admin", "system_admin"].includes(r),
  );

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("supporting_document");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Outside the capture form no period is implied, so the uploader picks the
  // month the proof supports — evidence only completes the period it is
  // tagged with (a quarterly/annual KPI counts its months toward the bucket).
  const periods = useQuery(api.activities.periods);
  const monthOptions = useMemo(
    () =>
      (periods ?? [])
        .filter((p) => p.grain === "month" && p.startAt <= Date.now())
        .reverse(),
    [periods],
  );
  const [pickedPeriod, setPickedPeriod] = useState("");
  useEffect(() => {
    if (periodKey || pickedPeriod || monthOptions.length === 0) return;
    // Early in a month, proof usually belongs to the month just closed.
    const [current, previous] = monthOptions;
    const early = Date.now() < current!.startAt + 5 * 24 * 60 * 60 * 1000;
    setPickedPeriod((early && previous ? previous : current)!.periodKey);
  }, [periodKey, pickedPeriod, monthOptions]);
  const uploadPeriod = periodKey ?? (pickedPeriod || undefined);

  // Months a file can be moved to (newest first), keeping its current period
  // selectable even when it is a quarter/year or outside the list.
  const retagOptions = (current: string) => {
    const keys = monthOptions.map((p) => p.periodKey);
    return keys.includes(current) ? keys : [current, ...keys];
  };
  async function retag(evidenceId: string, newPeriod: string) {
    setRetagging(evidenceId);
    setError(null);
    try {
      await setEvidencePeriod({
        evidenceId: evidenceId as Id<"evidenceFiles">,
        periodKey: newPeriod,
      });
    } catch (e) {
      setError(errorMessage(e, "Could not change the evidence period."));
    } finally {
      setRetagging(null);
    }
  }

  // Pre-describe the evidence from the KPI it supports (always editable).
  useEffect(() => {
    const s = suggestEvidence(kpi?.canonicalKey, kpi?.objective);
    setTitle(s.title);
    setCategory(s.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, kpi?.canonicalKey]);

  async function attachFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const checksum = await sha256Hex(file);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      await saveEvidence({
        kpiAssignmentId: assignmentId,
        storageId: storageId as Id<"_storage">,
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        ...(checksum ? { checksum } : {}),
        category,
        title: title || file.name,
        ...(deferNotice ? { deferNotice: true } : {}),
        ...(uploadPeriod ? { periodKey: uploadPeriod } : {}),
        ...(activityAt !== undefined ? { activityAt } : {}),
      });
      setTitle("");
    } catch (e) {
      setError(errorMessage(e, "Could not attach file."));
    } finally {
      setBusy(false);
    }
  }

  async function attachLink() {
    if (!linkUrl) return;
    setBusy(true);
    setError(null);
    try {
      await saveEvidence({
        kpiAssignmentId: assignmentId,
        externalUrl: linkUrl,
        originalFilename: linkUrl.split("/").pop() ?? "link",
        mimeType: "text/uri-list",
        fileSize: 0,
        category,
        title: title || "External evidence",
        ...(deferNotice ? { deferNotice: true } : {}),
        ...(uploadPeriod ? { periodKey: uploadPeriod } : {}),
        ...(activityAt !== undefined ? { activityAt } : {}),
      });
      setLinkUrl("");
      setTitle("");
    } catch (e) {
      setError(errorMessage(e, "Could not attach link."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" /> Evidence ({evidence?.length ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Attach */}
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Evidence title"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex">
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-muted">
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload file
              </span>
            </label>
            <span className="text-xs text-muted-foreground">or</span>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://link-to-evidence"
              className="h-8 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={attachLink}
              disabled={busy || !linkUrl}
            >
              Attach link
            </Button>
          </div>
          {!periodKey && monthOptions.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Evidence for
              <select
                value={pickedPeriod}
                onChange={(e) => setPickedPeriod(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                aria-label="Period this evidence supports"
              >
                {monthOptions.map((p) => (
                  <option key={p.periodKey} value={p.periodKey}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span>— evidence only counts toward the period it supports.</span>
            </label>
          )}
          {error && <p className="text-xs text-critical">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Max 25 MB. Files stream through an authenticated, audited path — never a
            permanent public URL.
          </p>
        </div>

        {/* List */}
        {evidence && evidence.length > 0 ? (
          <ul className="space-y-2">
            {evidence.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.title}</span>
                    <Badge variant={REVIEW_VARIANT[e.reviewStatus] ?? "muted"}>
                      {e.reviewStatus}
                    </Badge>
                    <Badge variant="muted">{e.category}</Badge>
                    {e.scanStatus === "flagged" && (
                      <Badge
                        variant="critical"
                        title="The malware scanner flagged this file — downloads are blocked"
                      >
                        ⚠ malware flagged
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.originalFilename}
                    <span
                      className="ml-2 whitespace-nowrap"
                      title={
                        e.activityAt !== null
                          ? "The work date selected when this evidence was captured"
                          : "When this evidence was attached (Lagos time)"
                      }
                    >
                      ·{" "}
                      {e.activityAt !== null
                        ? formatDate(e.activityAt)
                        : `uploaded ${formatDateTime(e.uploadedAt)}`}
                    </span>
                    <span
                      className="ml-2 whitespace-nowrap"
                      title="The KPI period this evidence counts toward — evidence only completes its own period"
                    >
                      · for{" "}
                      {e.canRetag ? (
                        <select
                          value={e.countsFor}
                          disabled={retagging === e.id}
                          onChange={(ev) => retag(e.id, ev.target.value)}
                          aria-label={`Period for ${e.title}`}
                          className="h-6 rounded border border-input bg-background px-1 text-xs text-foreground"
                        >
                          {retagOptions(e.countsFor).map((p) => (
                            <option key={p} value={p}>
                              {periodLabel(p)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        periodLabel(e.countsFor)
                      )}
                    </span>
                    {e.noWorkInPeriod && (
                      <Badge
                        variant="warning"
                        className="ml-2"
                        title="No work is logged on this KPI for that period — this evidence may be tagged to the wrong month"
                      >
                        no work logged for {periodLabel(e.countsFor)}
                      </Badge>
                    )}
                    {e.externalUrl && (
                      <a
                        href={e.externalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-2 inline-flex items-center gap-0.5 text-accent hover:underline"
                      >
                        open <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {canReview && !["approved", "rejected"].includes(e.reviewStatus) && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reviewEvidence({ evidenceId: e.id, decision: "approve" })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const comment =
                            window.prompt("Reason for rejecting?") ?? undefined;
                          if (comment)
                            reviewEvidence({
                              evidenceId: e.id,
                              decision: "reject",
                              comment,
                            });
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {e.canDelete && (
                    <button
                      type="button"
                      aria-label={`Delete evidence “${e.title}”`}
                      title="Delete this evidence (audited; the KPI's evidence gate recomputes)"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-critical/10 hover:text-critical"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete “${e.title}”? The file is removed and the KPI's evidence status recomputes.`,
                          )
                        )
                          return;
                        void removeEvidence({ evidenceId: e.id }).catch((err) =>
                          setError(errorMessage(err, "Could not delete.")),
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No evidence attached. Required evidence must be approved before this KPI can
            be scored officially.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
