"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { errorMessage } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AccessDenied } from "@/components/access-denied";
import { formatPercent } from "@convex/lib/format";
import {
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  Inbox,
  Lock,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import type { AppRole } from "@convex/lib/types";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Human label for any period key: "2026-M07" → "Jul 2026", "2026-Q3" → "Q3 2026". */
function periodLabel(pk: string): string {
  const m = /^(\d{4})-M(\d{2})$/.exec(pk);
  if (m) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  const q = /^(\d{4})-Q([1-4])$/.exec(pk);
  if (q) return `Q${q[2]} ${q[1]}`;
  return pk;
}

export default function ReviewPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) =>
    ["manager", "reviewer", "kpi_admin", "system_admin"].includes(r),
  );
  const canApprove = roles.some((r) =>
    ["manager", "kpi_admin", "system_admin"].includes(r),
  );

  const isAdmin = roles.some((r) => ["kpi_admin", "system_admin"].includes(r));

  const [view, setView] = useState<"pending" | "official" | "all">("pending");
  const queue = useQuery(api.approvals.reviewQueue, canView ? { view } : "skip");
  const approve = useMutation(api.approvals.approveEmployeePeriod);
  const reject = useMutation(api.approvals.rejectSubmission);
  const approveEvidence = useMutation(api.evidence.approveAllForAssignment);
  const deleteSubmission = useMutation(api.approvals.deleteSubmission);
  const recallRejection = useMutation(api.approvals.recallRejection);
  const recallApproval = useMutation(api.approvals.recallPeriodApproval);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    undo?: () => Promise<void>;
  } | null>(null);

  async function doUndo() {
    if (!notice?.undo) return;
    setBusy("undo");
    setError(null);
    try {
      await notice.undo();
      setNotice({
        text: "Recalled — the decision has been reversed and the employee notified.",
      });
    } catch (e) {
      setError(errorMessage(e, "Recall failed."));
    } finally {
      setBusy(null);
    }
  }

  async function doReject(assignmentId: string, periodKey: string) {
    const reason = window.prompt(
      "Reason for rejecting this submission (required — it is emailed to the employee):",
    );
    if (!reason?.trim()) return;
    setBusy(assignmentId);
    setError(null);
    try {
      await reject({
        kpiAssignmentId: assignmentId as Id<"kpiAssignments">,
        periodKey,
        reason: reason.trim(),
      });
      setNotice({
        text: `Rejected — the ${periodKey} submission was returned to the employee and they have been notified.`,
        undo: async () => {
          await recallRejection({
            kpiAssignmentId: assignmentId as Id<"kpiAssignments">,
            periodKey,
          });
        },
      });
    } catch (e) {
      setError(errorMessage(e, "Rejection failed."));
    } finally {
      setBusy(null);
    }
  }

  async function doApproveEvidence(assignmentId: string) {
    setBusy(assignmentId);
    setError(null);
    try {
      await approveEvidence({
        kpiAssignmentId: assignmentId as Id<"kpiAssignments">,
      });
      setNotice({ text: "Evidence approved — the employee has been notified." });
    } catch (e) {
      setError(errorMessage(e, "Evidence approval failed."));
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(assignmentId: string, periodKey: string, objective: string) {
    const reason = window.prompt(
      `Delete the ${periodKey} submission for “${objective.slice(0, 80)}”?\n\nEvery entry AND the KPI's attached evidence are removed for the employee as well, and they are notified with this reason (required). If the period was already approved, the approval is recalled automatically first:`,
    );
    if (!reason?.trim()) return;
    setBusy(assignmentId);
    setError(null);
    try {
      await deleteSubmission({
        kpiAssignmentId: assignmentId as Id<"kpiAssignments">,
        periodKey,
        reason: reason.trim(),
      });
      setNotice({
        text: `Deleted — the ${periodKey} entries and attached evidence were removed and the employee notified.`,
      });
    } catch (e) {
      setError(errorMessage(e, "Deletion failed."));
    } finally {
      setBusy(null);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        periodKey: string;
        items: NonNullable<typeof queue>;
      }
    >();
    for (const row of queue ?? []) {
      const key = `${row.employeeId}::${row.periodKey}`;
      const g = map.get(key) ?? {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        periodKey: row.periodKey,
        items: [] as NonNullable<typeof queue>,
      };
      g.items.push(row);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [queue]);

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canView) return <AccessDenied />;

  async function doApprove(employeeId: string, periodKey: string) {
    setBusy(`${employeeId}::${periodKey}`);
    setError(null);
    try {
      await approve({
        employeeId: employeeId as Id<"employees">,
        periodKey,
        reason: "Period approved from review queue",
      });
      setNotice({
        text: `Period ${periodKey} approved — the official score is frozen and the employee notified.`,
        undo: async () => {
          await recallApproval({
            employeeId: employeeId as Id<"employees">,
            periodKey,
            reason: "Approved in error — recalled from the review queue",
          });
        },
      });
    } catch (e) {
      setError(errorMessage(e, "Approval failed."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review & Approval Queue"
        description="Provisional measurements awaiting review. A period can only be approved once required evidence is approved and no data-quality issue blocks it — then its score is frozen into a reproducible snapshot."
      />

      <div className="flex items-center gap-2">
        <select
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filter the queue"
        >
          <option value="pending">Awaiting review</option>
          <option value="official">Approved (official)</option>
          <option value="all">All submissions</option>
        </select>
        {view !== "pending" && (
          <span className="text-xs text-muted-foreground">
            Approved submissions can be recalled for re-review, or deleted — deleting
            recalls the approval automatically.
          </span>
        )}
      </div>

      {error && (
        <Card className="border-critical/50 bg-critical/5">
          <CardContent className="p-3 text-sm text-critical">{error}</CardContent>
        </Card>
      )}

      {notice && (
        <Card className="border-success/50 bg-success/5" role="status" aria-live="polite">
          <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            <span className="flex-1">{notice.text}</span>
            {notice.undo && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "undo"}
                title="Recall this decision — it is reversed and the employee notified"
                onClick={doUndo}
              >
                Undo
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {queue === undefined ? (
        <Skeleton className="h-48" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Nothing to review"
          description="Provisional measurements appear here as employees capture activities. Log an activity to see the review flow."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const allReady = g.items.every((i) => i.ready);
            const official = g.items.every((i) => i.isProvisional === false);
            const gk = `${g.employeeId}::${g.periodKey}`;
            return (
              <Card key={gk}>
                <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-base">
                      <Link
                        href={`/employees/${g.employeeId}` as never}
                        className="hover:underline"
                      >
                        {g.employeeName}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        · {periodLabel(g.periodKey)}
                      </span>
                      {official && (
                        <Badge variant="success" className="ml-2 align-middle">
                          approved
                        </Badge>
                      )}
                    </CardTitle>
                  </div>
                  {canApprove &&
                    (official ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === gk}
                        title="Reopen this period for re-review — the frozen score is recalled and the employee notified"
                        onClick={async () => {
                          const reason = window.prompt(
                            `Recall the ${g.periodKey} approval for ${g.employeeName}?\n\nThe frozen score is removed, their submissions return to review, and they are notified. Reason (optional):`,
                          );
                          if (reason === null) return;
                          setBusy(gk);
                          setError(null);
                          try {
                            await recallApproval({
                              employeeId: g.employeeId as Id<"employees">,
                              periodKey: g.periodKey,
                              reason: reason.trim() || undefined,
                            });
                            setNotice({
                              text: `Approval recalled — ${g.periodKey} is back under review and ${g.employeeName} has been notified.`,
                            });
                          } catch (e) {
                            setError(errorMessage(e, "Recall failed."));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Undo2 className="h-4 w-4" /> Recall approval
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={allReady ? "default" : "outline"}
                        disabled={!allReady || busy === gk}
                        onClick={() => doApprove(g.employeeId, g.periodKey)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {allReady ? "Approve period" : "Blocked"}
                      </Button>
                    ))}
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.items.map((i) => (
                    <div
                      key={i.measurementId}
                      className="space-y-1.5 rounded-md border border-border p-2.5 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/kpi/${i.assignmentId}` as never}
                          className="max-w-md font-medium text-accent hover:underline"
                        >
                          {i.objective}
                        </Link>
                        <div className="flex items-center gap-2">
                          {i.kpiCategory === "non_core" && (
                            <Badge variant="info">non-core</Badge>
                          )}
                          {i.isProvisional === false && (
                            <Badge variant="success">official</Badge>
                          )}
                          <span className="tabular text-muted-foreground">
                            {i.cappedAttainment === null
                              ? "—"
                              : formatPercent(i.cappedAttainment)}
                          </span>
                          <StatusBadge status={i.status as never} />
                          {i.evidenceRequired &&
                            (i.evidenceComplete ? (
                              <Badge variant="success">evidence ✓</Badge>
                            ) : i.pendingEvidence > 0 ? (
                              <>
                                <Badge variant="info">
                                  evidence submitted ({i.pendingEvidence})
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy === i.assignmentId}
                                  title={`Approve the ${i.pendingEvidence} pending evidence item${i.pendingEvidence === 1 ? "" : "s"} — the employee is notified`}
                                  onClick={() => doApproveEvidence(i.assignmentId)}
                                >
                                  <FileCheck2 className="h-4 w-4" /> Approve evidence
                                </Button>
                              </>
                            ) : (
                              <Badge variant="warning">evidence needed</Badge>
                            ))}
                          {!i.cadenceCompliant && (
                            <Badge variant="warning">submitted late</Badge>
                          )}
                          {i.scoringBlocked && (
                            <Badge variant="critical">
                              <Lock className="h-3 w-3" /> DQ blocked
                            </Badge>
                          )}
                          {canApprove && i.isProvisional !== false && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-critical"
                              disabled={busy === i.assignmentId}
                              title="Reject this submission — the reason is emailed to the employee"
                              onClick={() => doReject(i.assignmentId, i.periodKey)}
                            >
                              <XCircle className="h-4 w-4" /> Reject
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-critical"
                              disabled={busy === i.assignmentId}
                              title="Delete this submission and its attached evidence — removed for the employee too; they are notified with your reason (audited)"
                              onClick={() =>
                                doDelete(i.assignmentId, i.periodKey, i.objective)
                              }
                            >
                              <Trash2 className="h-4 w-4" /> Delete
                            </Button>
                          )}
                        </div>
                      </div>
                      {/* What the employee self-reported, before trusting the
                          computed number — expandable to the raw entries. */}
                      <details className="group">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
                          <span className="font-medium text-foreground/80">
                            Self-reported:
                          </span>
                          <span>{i.selfReported}</span>
                          <span>
                            · {i.entryCount} entr{i.entryCount === 1 ? "y" : "ies"}
                          </span>
                        </summary>
                        {i.entries.length > 0 && (
                          <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-4">
                            {i.entries.map((e) => (
                              <li
                                key={e.id}
                                className="flex flex-wrap items-baseline gap-x-2 text-xs"
                              >
                                <span className="tabular text-muted-foreground">
                                  {new Date(e.activityAt).toLocaleDateString("en-GB", {
                                    day: "2-digit",
                                    month: "short",
                                    timeZone: "Africa/Lagos",
                                  })}
                                </span>
                                <span className="max-w-sm truncate">{e.title}</span>
                                <span className="tabular font-medium">{e.values}</span>
                                <span className="text-muted-foreground">{e.status}</span>
                              </li>
                            ))}
                            {i.entryCount > i.entries.length && (
                              <li className="text-xs text-muted-foreground">
                                … {i.entryCount - i.entries.length} more — open the KPI
                                for the full list
                              </li>
                            )}
                          </ul>
                        )}
                      </details>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
