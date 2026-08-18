"use client";

/**
 * Per-employee analytics: scorecard tiles, per-KPI attainment vs same-role
 * peers, monthly trend, and the activity log. Moderators pick any employee;
 * everyone else sees exactly their own linked employee.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { formatPercent } from "@convex/lib/format";
import { UserRoundSearch } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BAR_TONE: Record<string, string> = {
  on_target: "bg-success",
  watch: "bg-warning",
  at_risk: "bg-warning",
  critical: "bg-critical",
  no_data: "bg-muted-foreground/30",
};

export function EmployeeAnalytics() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [kpiFilter, setKpiFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const data = useQuery(
    api.analytics.employeeAnalytics,
    selectedId ? { employeeId: selectedId as Id<"employees"> } : {},
  );

  const filteredActivities = useMemo(
    () =>
      (data?.employee ? data.activities : []).filter(
        (a) =>
          (kpiFilter === "all" || a.canonicalKey === kpiFilter) &&
          (statusFilter === "all" || a.status === statusFilter),
      ),
    [data, kpiFilter, statusFilter],
  );

  if (data === undefined) return <Skeleton className="h-64" />;

  const activityStatuses = data.employee
    ? Array.from(new Set(data.activities.map((a) => a.status)))
    : [];
  const activityKpis = data.employee
    ? Array.from(
        new Map(data.activities.map((a) => [a.canonicalKey, a.objective])).entries(),
      )
    : [];

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRoundSearch className="h-5 w-5 text-accent" />
            {data.canSelect ? "Employee analytics" : "My analytics"}
          </CardTitle>
          <CardDescription>
            {data.canSelect
              ? "One person's KPIs in context — attainment vs same-role peers, monthly trend, and their activity record."
              : "Your KPIs in context — current attainment, monthly trend, and your activity record."}
          </CardDescription>
        </div>
        {data.canSelect && (
          <select
            value={selectedId || (data.employee?.id ?? "")}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Select an employee"
          >
            {!data.employee && <option value="">Select an employee…</option>}
            {data.roster.map((r: { id: string; displayName: string; jobRole: string }) => (
              <option key={r.id} value={r.id}>
                {r.displayName} — {r.jobRole}
              </option>
            ))}
          </select>
        )}
      </CardHeader>

      {!data.employee ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data.canSelect
              ? "Pick an employee to see their analytics."
              : "Your account isn't linked to a roster employee yet — ask a System Admin to link it."}
          </p>
        </CardContent>
      ) : (
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{data.employee.displayName}</span>
            <Badge variant="muted">{data.employee.jobRole}</Badge>
            <Badge variant="muted">{data.employee.location}</Badge>
            <span className="text-muted-foreground">· {data.currentPeriodKey}</span>
            {data.canSelect && (
              <Link
                href={`/employees/${data.employee.id}` as never}
                className="text-accent hover:underline"
              >
                full profile →
              </Link>
            )}
          </div>

          {/* Tiles */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat
              label="Score (measured KPIs)"
              value={
                data.tiles.scoreOnMeasured === null
                  ? "—"
                  : `${data.tiles.scoreOnMeasured.toFixed(1)}%`
              }
              hint={`${data.tiles.kpisWithData} of ${data.tiles.kpiCount} KPIs measured`}
            />
            <MiniStat
              label="Evidence complete"
              value={formatPercent(data.tiles.evidenceCompletionPct / 100)}
            />
            <MiniStat
              label="Cadence compliant"
              value={formatPercent(data.tiles.cadenceCompliancePct / 100)}
            />
            <MiniStat
              label="Entries this month"
              value={String(data.tiles.activitiesThisMonth)}
            />
          </div>

          {/* Per-KPI attainment vs peers */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Attainment by KPI{" "}
              <span className="font-normal text-muted-foreground">
                — ◆ marks the same-role peer average
              </span>
            </h3>
            {data.kpis.map((k) => {
              const pct = k.attainment === null ? 0 : Math.min(k.attainment, 1) * 100;
              return (
                <div key={k.assignmentId} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/kpi/${k.assignmentId}` as never}
                      className="max-w-xl truncate text-accent hover:underline"
                    >
                      {k.objective}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular font-medium">
                        {k.attainment === null ? "no data" : formatPercent(k.attainment)}
                      </span>
                      <StatusBadge status={k.status as never} />
                      {k.isProvisional === false && (
                        <Badge variant="success">official</Badge>
                      )}
                    </span>
                  </div>
                  <div
                    className="relative h-3 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${k.objective}: ${k.attainment === null ? "no data" : formatPercent(k.attainment)}${k.peerAvg !== null ? `, peer average ${formatPercent(k.peerAvg)}` : ""}`}
                  >
                    <div
                      className={`h-full rounded-full ${BAR_TONE[k.status] ?? "bg-accent"}`}
                      style={{ width: `${pct}%` }}
                    />
                    {k.peerAvg !== null && (
                      <div
                        className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-foreground/70"
                        style={{ left: `${Math.min(k.peerAvg, 1) * 100}%` }}
                        title={`Peer average (${k.peerCount} ${k.peerCount === 1 ? "peer" : "peers"}): ${formatPercent(k.peerAvg)}`}
                      />
                    )}
                  </div>
                  {k.peerAvg !== null && (
                    <p className="text-xs text-muted-foreground">
                      peers ({k.peerCount}): {formatPercent(k.peerAvg)} · weight{" "}
                      {k.weight} · {k.periodKey}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Monthly trend */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Monthly score trend{" "}
              <span className="font-normal text-muted-foreground">
                — weighted score across monthly-tracked KPIs
              </span>
            </h3>
            <div className="flex items-end gap-1.5" role="img" aria-label="Monthly score trend">
              {data.trend.map((t) => (
                <div key={t.periodKey} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="flex w-full items-end justify-center rounded-t bg-muted"
                    style={{ height: 72 }}
                    title={
                      t.scoreOnMeasured === null
                        ? `${t.periodKey}: no data`
                        : `${t.periodKey}: ${formatPercent(t.scoreOnMeasured)} (${t.kpisWithData} KPIs)`
                    }
                  >
                    {t.scoreOnMeasured !== null && (
                      <div
                        className="w-full rounded-t bg-accent"
                        style={{ height: `${Math.min(t.scoreOnMeasured, 1) * 72}px` }}
                      />
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {MONTHS[t.monthIndex]}
                  </span>
                  <span className="tabular text-[10px] text-muted-foreground">
                    {t.scoreOnMeasured === null
                      ? "·"
                      : `${Math.round(t.scoreOnMeasured * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity log */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Activity log</h3>
              <select
                value={kpiFilter}
                onChange={(e) => setKpiFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Filter activities by KPI"
              >
                <option value="all">All KPIs</option>
                {activityKpis.map(([key, objective]) => (
                  <option key={key} value={key}>
                    {objective.slice(0, 60)}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Filter activities by status"
              >
                <option value="all">All statuses</option>
                {activityStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredActivities.length} of {data.activities.length} latest entries
              </span>
            </div>
            {filteredActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activities match — entries appear here as work is captured.
              </p>
            ) : (
              <div className="space-y-1.5">
                {filteredActivities.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(a.activityAt).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          timeZone: "Africa/Lagos",
                        })}
                      </span>
                      <span className="max-w-md truncate font-medium">{a.title}</span>
                      <span className="tabular text-muted-foreground">{a.detail}</span>
                    </div>
                    <Badge
                      variant={
                        a.status === "approved" || a.status === "locked"
                          ? "success"
                          : a.status === "needs_changes" || a.status === "rejected"
                            ? "warning"
                            : "muted"
                      }
                    >
                      {a.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
