"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AccessDenied } from "@/components/access-denied";
import { StatusBadge } from "@/components/status-badge";
import { formatPercent, periodLabel } from "@convex/lib/format";
import { Activity, ClipboardList, Mail } from "lucide-react";
import type { AppRole } from "@convex/lib/types";

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos" });
}

export default function ActivityFeedPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) =>
    ["system_admin", "kpi_admin", "manager", "reviewer", "auditor"].includes(r),
  );
  const [month, setMonth] = useState("all");
  const data = useQuery(
    api.activities.listRecentAll,
    canView ? { limit: 50, ...(month !== "all" ? { monthKey: month } : {}) } : "skip",
  );
  const feed = data?.rows;

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canView) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Feed"
        description="Live backend view of every KPI update as it lands — who logged what, for which KPI, and the recomputed provisional attainment. Admins and the submitter are notified by email when configured."
      />

      <div className="flex items-center gap-2">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Filter by month logged"
        >
          <option value="all">All months</option>
          {(data?.availableMonths ?? []).map((m) => (
            <option key={m} value={m}>
              {periodLabel(m)}
            </option>
          ))}
        </select>
        {feed !== undefined && (
          <span className="text-xs text-muted-foreground">
            {feed.length} entr{feed.length === 1 ? "y" : "ies"}
            {month !== "all" ? ` · ${periodLabel(month)}` : " · latest"}
          </span>
        )}
      </div>

      {feed === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : feed.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No activity yet"
          description="KPI updates appear here in real time as team members capture activities."
        />
      ) : (
        <div className="stagger-children space-y-2.5">
          {feed.map((a) => (
            <Card key={a.id} className="card-lift">
              <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
                <span className="icon-chip shrink-0">
                  <Activity className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.employeeName}</span>
                    <span className="text-sm text-muted-foreground">·</span>
                    <Link
                      href={`/kpi/${a.kpiAssignmentId}` as never}
                      className="truncate text-sm text-accent hover:underline"
                    >
                      {a.title}
                    </Link>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.objective} · {periodLabel(a.periodKey)} · logged by {a.actorName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-sm font-semibold">
                    {a.cappedAttainment === null
                      ? "—"
                      : formatPercent(a.cappedAttainment)}
                  </span>
                  <StatusBadge status={a.measurementStatus as never} />
                  <Badge variant="muted">{a.status}</Badge>
                  <span
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                    title="Admins + submitter notified"
                  >
                    <Mail className="h-3 w-3" /> {timeAgo(a.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
