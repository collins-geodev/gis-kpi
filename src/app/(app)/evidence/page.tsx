"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import { EvidencePanel } from "@/components/evidence-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FolderCheck,
  Loader2,
  Paperclip,
  Trash2,
  XCircle,
} from "lucide-react";
import type { AppRole } from "@convex/lib/types";
import { errorMessage } from "@/lib/errors";

const REVIEW_VARIANT: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  submitted: "muted",
  verified: "info",
  approved: "success",
  rejected: "critical",
  needs_changes: "warning",
};

const STATUS_FILTERS = ["all", "submitted", "verified", "approved", "rejected"] as const;

function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

/** Upload timestamp → its Lagos month as a sortable "2026-M07" key. */
function uploadMonthKey(ts: number): string {
  const d = new Date(ts + 60 * 60 * 1000); // Africa/Lagos = UTC+1
  return `${d.getUTCFullYear()}-M${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-M07" → "Jul 2026". */
function uploadMonthLabel(key: string): string {
  const m = /^(\d{4})-M(\d{2})$/.exec(key);
  if (!m) return key;
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

/** Convex site URL (HTTP actions) derived from the deployment URL. */
const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(".convex.cloud", ".convex.site");

/** Opens an evidence file through the authenticated, audited streaming route. */
function DownloadButton({ evidenceId }: { evidenceId: Id<"evidenceFiles"> }) {
  const token = useAuthToken();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function open() {
    if (!token || !CONVEX_SITE_URL) {
      setFailure("Not signed in yet — wait a moment and try again.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`${CONVEX_SITE_URL}/evidence?id=${evidenceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `${res.status === 403 ? "No access" : "Download failed"} (HTTP ${res.status})`,
        );
      }
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        "evidence";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Popup blockers often kill window.open after an await — fall back to a
      // same-page download link, which keeps the real filename too.
      const tab = window.open(url, "_blank", "noopener");
      if (!tab) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setFailure(
        err instanceof TypeError
          ? "Network/CORS error — check your connection and retry."
          : errorMessage(err, "Download failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={failure ? `${failure} Click to try again.` : "Open file (audited)"}
      className={`inline-flex items-center gap-1 text-xs hover:underline ${
        failure ? "text-critical" : "text-accent"
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {failure ? "retry" : "open"}
    </button>
  );
}

export default function EvidenceCentrePage() {
  const me = useQuery(api.access.currentUser);
  const rows = useQuery(api.evidence.listCentre);
  const myAssignments = useQuery(api.activities.myAssignments);
  const removeEvidence = useMutation(api.evidence.removeEvidence);

  const [uploadFor, setUploadFor] = useState<string>("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [category, setCategory] = useState("all");
  const [month, setMonth] = useState("all");

  const roles = (me?.roles ?? []) as AppRole[];
  const seesOthers = roles.some((r) =>
    [
      "manager",
      "reviewer",
      "kpi_admin",
      "system_admin",
      "auditor",
      "executive_viewer",
    ].includes(r),
  );

  const categories = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.category))).sort(),
    [rows],
  );

  // Months that actually have uploads (Lagos wall-clock), newest first.
  const months = useMemo(
    () =>
      Array.from(new Set((rows ?? []).map((r) => uploadMonthKey(r.uploadedAt))))
        .sort()
        .reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (status !== "all" && r.reviewStatus !== status) return false;
      if (category !== "all" && r.category !== category) return false;
      if (month !== "all" && uploadMonthKey(r.uploadedAt) !== month) return false;
      if (!q) return true;
      return [r.title, r.originalFilename, r.objective ?? "", r.employeeName]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, status, category, month]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      pending: all.filter((r) => ["submitted", "verified"].includes(r.reviewStatus))
        .length,
      approved: all.filter((r) => r.reviewStatus === "approved").length,
      rejected: all.filter((r) => r.reviewStatus === "rejected").length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence Centre"
        description="Everything you've attached across your KPIs — searchable, reviewed, and streamed through an authenticated, audited path."
      />

      {/* Posture stats */}
      <div className="stagger-children grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={<Paperclip className="h-4 w-4" />}
          label="Total items"
          value={rows === undefined ? null : stats.total}
        />
        <StatTile
          icon={<Clock3 className="h-4 w-4" />}
          label="Awaiting review"
          value={rows === undefined ? null : stats.pending}
          tone={stats.pending > 0 ? "warning" : "default"}
        />
        <StatTile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Approved"
          value={rows === undefined ? null : stats.approved}
          tone="success"
        />
        <StatTile
          icon={<XCircle className="h-4 w-4" />}
          label="Rejected"
          value={rows === undefined ? null : stats.rejected}
          tone={stats.rejected > 0 ? "critical" : "default"}
        />
      </div>

      {/* Upload */}
      {(myAssignments?.length ?? 0) > 0 && (
        <Card className="card-lift">
          <CardHeader>
            <CardTitle className="text-base">Attach new evidence</CardTitle>
            <CardDescription>
              Pick the KPI the evidence supports, then upload a file (max 25 MB) or attach
              a link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <select
              value={uploadFor}
              onChange={(e) => setUploadFor(e.target.value)}
              className="h-9 w-full max-w-xl rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Select a KPI…</option>
              {(myAssignments ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.objective}
                </option>
              ))}
            </select>
            {uploadFor && (
              <EvidencePanel
                assignmentId={uploadFor as Id<"kpiAssignments">}
                kpi={(() => {
                  const a = (myAssignments ?? []).find((x) => x.id === uploadFor);
                  return a
                    ? { canonicalKey: a.canonicalKey, objective: a.objective }
                    : undefined;
                })()}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, file, KPI or person…"
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUS_FILTERS)[number])}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filter by review status"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filter by upload month"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {uploadMonthLabel(m)}
            </option>
          ))}
        </select>
        {rows !== undefined && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>

      {/* Evidence table */}
      <Card>
        <CardContent className="p-0">
          {rows === undefined ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<FolderCheck className="h-8 w-8" />}
                title={rows.length === 0 ? "No evidence yet" : "Nothing matches"}
                description={
                  rows.length === 0
                    ? "Attach files or links above — approved evidence is what turns provisional measurements into official scores."
                    : "Try clearing the search or filters."
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evidence</TableHead>
                  <TableHead>KPI</TableHead>
                  {seesOthers && <TableHead>Employee</TableHead>}
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="max-w-[16rem] truncate font-medium">{r.title}</div>
                      <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                        {r.originalFilename}
                        {r.periodKey ? ` · ${r.periodKey}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[18rem]">
                      {r.kpiAssignmentId ? (
                        <Link
                          href={`/kpi/${r.kpiAssignmentId}` as never}
                          className="line-clamp-2 text-sm text-accent hover:underline"
                        >
                          {r.objective ?? "View KPI"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {r.kpiAssignmentId && !r.activityLogged && (
                        <div className="mt-1 flex items-start gap-1 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            No work logged yet — evidence alone isn&apos;t scored.{" "}
                            <Link
                              href={"/activities" as never}
                              className="underline hover:no-underline"
                            >
                              Log it in Activity Capture
                            </Link>
                            .
                          </span>
                        </div>
                      )}
                    </TableCell>
                    {seesOthers && (
                      <TableCell className="whitespace-nowrap text-sm">
                        {r.employeeName}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant="muted">{r.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={REVIEW_VARIANT[r.reviewStatus] ?? "muted"}>
                        {r.reviewStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatSize(r.fileSize)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.uploadedAt).toLocaleDateString("en-GB", {
                        timeZone: "Africa/Lagos",
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {r.hasFile ? (
                          <DownloadButton evidenceId={r.id} />
                        ) : r.externalUrl ? (
                          <a
                            href={r.externalUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> link
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {r.canDelete && (
                          <button
                            type="button"
                            aria-label={`Delete evidence “${r.title}”`}
                            title="Delete this evidence (audited; the KPI's evidence gate recomputes)"
                            className="rounded-md p-1 text-muted-foreground hover:bg-critical/10 hover:text-critical"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Delete “${r.title}”? The file is removed and the KPI's evidence status recomputes.`,
                                )
                              )
                                return;
                              void removeEvidence({ evidenceId: r.id }).catch((err) =>
                                window.alert(
                                  errorMessage(err, "Could not delete evidence."),
                                ),
                              );
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  tone?: "default" | "success" | "warning" | "critical";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "critical"
          ? "text-critical"
          : "text-accent";
  return (
    <Card className="card-lift sheen">
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          <span className={`icon-chip !h-8 !w-8 ${toneClass}`}>{icon}</span>
        </div>
        <div className="tabular mt-2 text-3xl font-semibold">
          {value === null ? "…" : value}
        </div>
      </CardContent>
    </Card>
  );
}
