"use client";

import { errorMessage } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { CountUp } from "@/components/count-up";
import { APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";
import {
  AlertTriangle,
  BookOpenCheck,
  ClipboardCheck,
  Hourglass,
  ShieldCheck,
  Trophy,
  Undo2,
  Users,
} from "lucide-react";

export default function OverviewPage() {
  const me = useQuery(api.access.currentUser);
  const summary = useQuery(api.overview.baselineSummary);
  const team = useQuery(api.employees.listScoped, {});
  const bootstrap = useMutation(api.access.bootstrapFirstAdmin);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const hasRoles = (me?.roles.length ?? 0) > 0;
  // Cards only link to pages the viewer can actually open; employees are
  // routed to their own Activity Capture for submission-state tiles.
  const canModerate = (me?.roles ?? []).some((r) =>
    ["manager", "reviewer", "kpi_admin", "system_admin"].includes(r),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Overview"
        description="Approved team performance, weight completeness, and data-quality posture for the 2026 GIS KPI baseline."
      />

      {me && !hasRoles && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-warning" /> Awaiting access
            </CardTitle>
            <CardDescription>
              Your account has no application role yet. Authentication is separate from
              authorization — an admin must grant your access.
            </CardDescription>
          </CardHeader>
          {!me.systemAdminExists && (
            <CardContent className="space-y-3">
              <p className="text-sm">
                No System Admin exists yet. As the first signed-in user you can claim the
                System Admin role to configure the platform.
              </p>
              {claimError && (
                <p className="text-sm text-critical" role="alert">
                  {claimError}
                </p>
              )}
              <Button
                variant="brand"
                disabled={claiming}
                onClick={async () => {
                  setClaiming(true);
                  setClaimError(null);
                  try {
                    await bootstrap({});
                  } catch (e) {
                    setClaimError(errorMessage(e, "Could not claim admin role."));
                  } finally {
                    setClaiming(false);
                  }
                }}
              >
                Claim System Admin
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {hasRoles && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Your roles:</span>
          {me!.roles.map((r) => (
            <span
              key={r}
              className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent"
            >
              {APP_ROLE_LABELS[r as AppRole]}
            </span>
          ))}
        </div>
      )}

      {summary === undefined ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !summary.seeded ? (
        <Card className="border-info/40 bg-info/5">
          <CardHeader>
            <CardTitle className="text-base">Baseline not seeded yet</CardTitle>
            <CardDescription>
              Run{" "}
              <code className="rounded bg-muted px-1">
                npx convex run seed:seedBaseline
              </code>{" "}
              to import the 15 employees and 75 KPI assignments from the 2026 workbook.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="stagger-children grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Employees"
              value={summary.employees}
              icon={<Users className="h-4 w-4" />}
              href="/team"
            />
            <StatCard
              label="KPI assignments"
              value={summary.assignments}
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <StatCard
              label="KPI definitions"
              value={summary.kpiDefinitions}
              icon={<BookOpenCheck className="h-4 w-4" />}
            />
            <StatCard
              label="Open data-quality issues"
              value={summary.openIssues}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={summary.blockers > 0 ? "warning" : "default"}
              href={canModerate ? "/data-quality" : undefined}
            />
            <StatCard
              label="Submissions awaiting review"
              value={summary.awaitingReview}
              icon={<Hourglass className="h-4 w-4" />}
              href={canModerate ? "/review" : "/activities"}
            />
            <StatCard
              label="Returned for changes"
              value={summary.returnedForChanges}
              icon={<Undo2 className="h-4 w-4" />}
              tone={summary.returnedForChanges > 0 ? "warning" : "default"}
              href={canModerate ? "/review" : "/activities"}
            />
          </div>

          {summary.weightsComplete ? (
            <Card className="border-success/40 bg-success/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-success" />
                  Configured weight: {summary.fullWeightTotal} / {summary.fullWeightTotal}
                </CardTitle>
                <CardDescription>
                  Every employee carries the full 100 points —{" "}
                  <strong>{summary.configuredWeightTotal} core</strong> +{" "}
                  <strong>
                    {summary.fullWeightTotal - summary.configuredWeightTotal} non-core
                  </strong>{" "}
                  (safety, compliance, customer satisfaction, training).{" "}
                  <strong>{summary.blockers}</strong> issue(s) currently block final
                  scoring.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="border-brand/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5 text-brand" />
                  Configured weight: {summary.configuredWeightTotal} /{" "}
                  {summary.fullWeightTotal}
                </CardTitle>
                <CardDescription>
                  Every employee&apos;s five KPIs total{" "}
                  <strong>{summary.configuredWeightTotal}</strong>, not{" "}
                  {summary.fullWeightTotal}. The missing 20 points are surfaced, not
                  invented. Resolve via the{" "}
                  <Link href="/data-quality" className="text-accent hover:underline">
                    Data Quality queue
                  </Link>{" "}
                  — add a KPI, change weights, or explicitly approve normalization.{" "}
                  <strong>{summary.blockers}</strong> issue(s) currently block final
                  scoring.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {/* Score leaderboard — same overall-points convention as Team
              Performance and Analytics, current month, best first. */}
          {team && team.rows.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="h-5 w-5 text-accent" />
                    Team leaderboard · {team.periodKey}
                  </CardTitle>
                  <CardDescription>
                    Overall score — points earned of the configured 100; unmeasured KPIs
                    count as 0.
                  </CardDescription>
                </div>
                <Link
                  href="/team"
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Team performance →
                </Link>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {[...team.rows]
                  .sort(
                    (a, b) =>
                      b.overallPct - a.overallPct || a.displayOrder - b.displayOrder,
                  )
                  .map((e, idx) => (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-1.5 text-sm"
                    >
                      <span className="tabular w-6 shrink-0 text-right text-xs text-muted-foreground">
                        {idx + 1}.
                      </span>
                      <Link
                        href={`/employees/${e.id}` as never}
                        className="min-w-0 flex-1 truncate font-medium text-accent hover:underline"
                      >
                        {e.displayName}
                        <span className="ml-2 hidden text-xs font-normal text-muted-foreground md:inline">
                          {e.jobRole}
                        </span>
                      </Link>
                      <div
                        className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:block"
                        aria-hidden
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(e.overallPct, 100)}%` }}
                        />
                      </div>
                      <span className="tabular font-medium">
                        {e.overallPct.toFixed(1)}%
                      </span>
                      <span className="tabular text-xs text-muted-foreground">
                        {e.pointsEarned.toFixed(1)} / {e.configuredWeight} pts
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = "default",
  href,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "default" | "warning";
  href?: string;
}) {
  const body = (
    <Card className={`card-lift sheen ${tone === "warning" ? "border-warning/40" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          {icon && (
            <span
              className={`icon-chip ${tone === "warning" ? "icon-chip--warning" : ""}`}
            >
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2 text-3xl font-semibold">
          <CountUp value={value} />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href as never}>{body}</Link> : body;
}
