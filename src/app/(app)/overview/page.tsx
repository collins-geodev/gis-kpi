"use client";

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
import { APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";
import {
  AlertTriangle,
  BookOpenCheck,
  ClipboardCheck,
  ShieldCheck,
  Users,
} from "lucide-react";

export default function OverviewPage() {
  const me = useQuery(api.access.currentUser);
  const summary = useQuery(api.overview.baselineSummary);
  const bootstrap = useMutation(api.access.bootstrapFirstAdmin);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const hasRoles = (me?.roles.length ?? 0) > 0;

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
                    setClaimError(
                      e instanceof Error ? e.message : "Could not claim admin role.",
                    );
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
              href="/data-quality"
            />
          </div>

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
    <Card
      className={
        tone === "warning"
          ? "border-warning/40 transition-colors hover:border-warning"
          : "transition-colors hover:border-accent/50"
      }
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <div className="tabular mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href as never}>{body}</Link> : body;
}
