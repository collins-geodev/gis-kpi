"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
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
import { CheckCircle2, Inbox, Lock } from "lucide-react";
import type { AppRole } from "@convex/lib/types";

export default function ReviewPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) =>
    ["manager", "reviewer", "kpi_admin", "system_admin"].includes(r),
  );
  const canApprove = roles.some((r) =>
    ["manager", "kpi_admin", "system_admin"].includes(r),
  );

  const queue = useQuery(api.approvals.reviewQueue, canView ? {} : "skip");
  const approve = useMutation(api.approvals.approveEmployeePeriod);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
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

      {error && (
        <Card className="border-critical/50 bg-critical/5">
          <CardContent className="p-3 text-sm text-critical">{error}</CardContent>
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
                      <span className="text-muted-foreground">· {g.periodKey}</span>
                    </CardTitle>
                  </div>
                  {canApprove && (
                    <Button
                      size="sm"
                      variant={allReady ? "default" : "outline"}
                      disabled={!allReady || busy === gk}
                      onClick={() => doApprove(g.employeeId, g.periodKey)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {allReady ? "Approve period" : "Blocked"}
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.items.map((i) => (
                    <div
                      key={i.measurementId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
                    >
                      <Link
                        href={`/kpi/${i.assignmentId}` as never}
                        className="max-w-md font-medium text-accent hover:underline"
                      >
                        {i.objective}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-muted-foreground">
                          {i.cappedAttainment === null
                            ? "—"
                            : formatPercent(i.cappedAttainment)}
                        </span>
                        <StatusBadge status={i.status as never} />
                        {i.evidenceRequired &&
                          (i.evidenceComplete ? (
                            <Badge variant="success">evidence ✓</Badge>
                          ) : (
                            <Badge variant="warning">evidence needed</Badge>
                          ))}
                        {i.scoringBlocked && (
                          <Badge variant="critical">
                            <Lock className="h-3 w-3" /> DQ blocked
                          </Badge>
                        )}
                      </div>
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
