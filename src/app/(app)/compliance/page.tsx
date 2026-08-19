"use client";

import { errorMessage } from "@/lib/errors";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarClock, CheckCircle2, Lock, LockOpen, UserRoundX } from "lucide-react";
import type { AppRole } from "@convex/lib/types";

const PERIOD_STATUS_VARIANT: Record<
  string,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  open: "success",
  grace: "warning",
  closed: "critical",
  locked: "critical",
  upcoming: "muted",
};

export default function CompliancePage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) =>
    ["manager", "kpi_admin", "system_admin", "auditor"].includes(r),
  );
  const isAdmin = roles.some((r) => ["kpi_admin", "system_admin"].includes(r));

  const periods = useQuery(api.activities.periods, canView ? {} : "skip");
  const months = useMemo(
    () => (periods ?? []).filter((p) => p.grain === "month"),
    [periods],
  );
  const [periodKey, setPeriodKey] = useState("2026-M08");
  const [defaultersOnly, setDefaultersOnly] = useState(false);

  const data = useQuery(api.compliance.board, canView ? { periodKey } : "skip");
  const closePeriod = useMutation(api.compliance.closePeriod);
  const reopenPeriod = useMutation(api.compliance.reopenPeriod);
  const [actionError, setActionError] = useState<string | null>(null);

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canView)
    return (
      <AccessDenied message="Compliance tracking is for managers, admins and auditors." />
    );

  const rows = (data?.rows ?? []).filter(
    (r) => !defaultersOnly || r.missing.length > 0 || r.late > 0,
  );
  const stats = {
    complete: (data?.rows ?? []).filter((r) => r.missing.length === 0).length,
    partial: (data?.rows ?? []).filter(
      (r) => r.missing.length > 0 && r.onTime + r.late > 0,
    ).length,
    none: (data?.rows ?? []).filter((r) => r.onTime + r.late === 0).length,
    late: (data?.rows ?? []).reduce((s, r) => s + r.late, 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submission Compliance"
        description="Who has submitted their KPIs for the period — on time, late, or not at all. Reminders escalate automatically; closed periods block self-service capture."
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Reporting month"
        >
          {months.map((p) => (
            <option key={p.periodKey} value={p.periodKey}>
              {p.label}
            </option>
          ))}
        </select>
        {data?.period && (
          <Badge variant={PERIOD_STATUS_VARIANT[data.period.status] ?? "muted"}>
            {data.period.status}
          </Badge>
        )}
        {data?.period && (
          <span className="text-xs text-muted-foreground">
            due{" "}
            {new Date(data.period.dueAt).toLocaleDateString("en-GB", {
              timeZone: "Africa/Lagos",
            })}
          </span>
        )}
        <label className="ml-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={defaultersOnly}
            onChange={(e) => setDefaultersOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Defaulters only
        </label>
        {isAdmin && data?.period && (
          <div className="ml-auto flex gap-2">
            {["closed", "locked"].includes(data.period.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const reason = window.prompt(
                    "Reason for reopening this period (audited):",
                  );
                  if (!reason?.trim()) return;
                  setActionError(null);
                  void reopenPeriod({ periodKey, reason: reason.trim() }).catch((e) =>
                    setActionError(errorMessage(e, "Failed.")),
                  );
                }}
              >
                <LockOpen className="h-4 w-4" /> Reopen period
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-critical"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Close ${data.period!.label} for capture? Employees can no longer log entries until it is reopened.`,
                    )
                  )
                    return;
                  setActionError(null);
                  void closePeriod({ periodKey }).catch((e) =>
                    setActionError(errorMessage(e, "Failed.")),
                  );
                }}
              >
                <Lock className="h-4 w-4" /> Close period
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <p className="text-sm text-critical" role="alert">
          {actionError}
        </p>
      )}

      <div className="stagger-children grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Fully submitted"
          value={data ? stats.complete : null}
          tone="success"
        />
        <Tile
          icon={<CalendarClock className="h-4 w-4" />}
          label="Partial"
          value={data ? stats.partial : null}
          tone={stats.partial > 0 ? "warning" : "default"}
        />
        <Tile
          icon={<UserRoundX className="h-4 w-4" />}
          label="Nothing submitted"
          value={data ? stats.none : null}
          tone={stats.none > 0 ? "critical" : "default"}
        />
        <Tile
          icon={<CalendarClock className="h-4 w-4" />}
          label="Late entries"
          value={data ? stats.late : null}
          tone={stats.late > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {data === undefined ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>On time</TableHead>
                  <TableHead>Late</TableHead>
                  <TableHead>Missing KPIs</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const done = r.onTime + r.late;
                  const pct = r.expected === 0 ? 0 : (done / r.expected) * 100;
                  const status =
                    r.missing.length === 0 ? "complete" : done === 0 ? "none" : "partial";
                  return (
                    <TableRow key={r.employeeId}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.jobRole}</div>
                      </TableCell>
                      <TableCell className="min-w-[10rem]">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                status === "complete"
                                  ? "bg-success"
                                  : status === "none"
                                    ? "bg-critical"
                                    : "bg-warning"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="tabular text-xs text-muted-foreground">
                            {done}/{r.expected}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular">{r.onTime}</TableCell>
                      <TableCell>
                        {r.late > 0 ? (
                          <Badge variant="warning">{r.late}</Badge>
                        ) : (
                          <span className="tabular text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md text-xs text-muted-foreground">
                        {r.missing.length === 0
                          ? "—"
                          : r.missing
                              .map((m) => m.split(/[.;]/)[0])
                              .join(" · ")
                              .slice(0, 140)}
                      </TableCell>
                      <TableCell>
                        {status === "complete" ? (
                          <Badge variant="success">complete</Badge>
                        ) : status === "none" ? (
                          <Badge variant="critical">nothing</Badge>
                        ) : (
                          <Badge variant="warning">partial</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
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
        <div className="tabular mt-2 text-3xl font-semibold">{value ?? "…"}</div>
      </CardContent>
    </Card>
  );
}
