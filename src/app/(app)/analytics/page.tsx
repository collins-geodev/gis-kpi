"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import { RadialGauge } from "@/components/charts/radial-gauge";
import { TrendChartCard } from "@/components/charts/trend-chart-card";
import { CountUp } from "@/components/count-up";
import { AlertTriangle, ClipboardCheck, Lightbulb, Lock, Users } from "lucide-react";
import { STATUS_BAND_LABELS, type StatusBand } from "@convex/lib/types";
import { EmployeeAnalytics } from "@/components/employee-analytics";

export default function AnalyticsPage() {
  // Selecting an employee in the Employee analytics card narrows EVERY chart
  // and insight below to that person; clearing it restores the team view.
  const [employeeId, setEmployeeId] = useState<string>("");
  const data = useQuery(
    api.analytics.dashboard,
    employeeId ? { employeeId: employeeId as Id<"employees"> } : {},
  );

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          description="Configuration, data-quality and score posture for the GIS Team."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  const cov = data.coverage;
  const pct = (n: number) =>
    cov.totalMeasurements === 0 ? null : Math.round((n / cov.totalMeasurements) * 100);

  const topRole = data.byRole[0];
  const topLocation = data.byLocation[0];
  const insights: string[] = [];
  if (topRole) {
    insights.push(
      `${topRole.label} is the largest role group — ${topRole.value} of ${data.totals.employees} employees (${Math.round((topRole.value / Math.max(data.totals.employees, 1)) * 100)}%).`,
    );
  }
  if (topLocation) {
    insights.push(
      `${topLocation.label} hosts the most team members (${topLocation.value}).`,
    );
  }
  insights.push(
    data.totals.dqBlockers > 0
      ? `${data.totals.dqBlockers} data-quality issue(s) still block official scoring on ${data.totals.scoringBlocked} KPI(s) — resolve them in the Data Quality queue.`
      : "No data-quality issues block scoring — every KPI can reach an official score.",
  );
  insights.push(
    cov.totalMeasurements === 0
      ? "No measurements captured yet — scores populate as activities are logged and approved."
      : `${cov.withData} of ${cov.totalMeasurements} measurements carry data; ${cov.approved} are approved (final).`,
  );

  const statusData = data.measurementStatus.map((s) => ({
    label: STATUS_BAND_LABELS[s.label as StatusBand] ?? s.label,
    value: s.value,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Rich, data-backed insight into configuration, data quality and score posture. Every chart has a table alternative."
      />

      {/* Headline stats */}
      <div className="stagger-children grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Employees"
          value={data.totals.employees}
          icon={<Users className="h-4 w-4" />}
        />
        <Stat
          label="KPI assignments"
          value={data.totals.assignments}
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <Stat
          label="Scoring-blocked KPIs"
          value={data.totals.scoringBlocked}
          icon={<Lock className="h-4 w-4" />}
          tone="warning"
        />
        <Stat
          label="Blocking DQ issues"
          value={data.totals.dqBlockers}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warning"
        />
      </div>

      {/* Coverage gauges */}
      <Card className="card-lift sheen">
        <CardHeader>
          <CardTitle className="text-base">Measurement coverage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start justify-around gap-6">
          <RadialGauge
            label="Measurements with data"
            pct={pct(cov.withData)}
            colorVar="--chart-1"
          />
          <RadialGauge
            label="Evidence complete"
            pct={pct(cov.evidenceComplete)}
            colorVar="--chart-3"
          />
          <RadialGauge
            label="Cadence compliant"
            pct={pct(cov.cadenceCompliant)}
            colorVar="--chart-2"
          />
          <RadialGauge
            label="Approved (final)"
            pct={pct(cov.approved)}
            colorVar="--chart-4"
          />
        </CardContent>
      </Card>

      {/* Approved-score trend from frozen snapshots (spec §12). */}
      <TrendChartCard
        title="Approved score trend"
        description="Average official (approved) score across employees per period — read from frozen snapshots, never provisional numbers. The dashed line tracks evidence completeness."
        data={data.scoreTrend}
      />

      {/* Per-employee analytics: moderators pick anyone; employees see
          themselves. The selection also scopes every chart on this page. */}
      <EmployeeAnalytics selectedId={employeeId} onSelect={setEmployeeId} />

      {employeeId && (
        <p className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
          Every chart, gauge, and insight on this page is filtered to the selected
          employee — choose “Team view” in the employee dropdown to see the whole team
          again.
        </p>
      )}

      {/* Insights */}
      <Card className="card-lift border-accent/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="icon-chip">
              <Lightbulb className="h-4 w-4" />
            </span>
            Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="stagger-children space-y-2 text-sm">
            {insights.map((i, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span
                  className="glow-pulse mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden
                />
                {i}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Donuts + bars */}
      <div className="stagger-children grid gap-4 lg:grid-cols-2">
        <DonutChartCard
          title="Weight completeness"
          description="Employees whose 5 KPIs total 80 vs 100"
          data={data.weightCompleteness}
          centerLabel="employees"
        />
        <DonutChartCard
          title="KPIs by measurement mode"
          data={data.byMode}
          centerLabel="KPIs"
        />
        {statusData.length > 0 && (
          <DonutChartCard
            title="Measurement status distribution"
            data={statusData}
            centerLabel="measurements"
          />
        )}
        <BarChartCard title="Employees by role" data={data.byRole} colorVar="--chart-2" />
        <BarChartCard
          title="Employees by location"
          data={data.byLocation}
          colorVar="--chart-1"
        />
        <BarChartCard
          title="Data-quality issues by category"
          description="Nothing silently corrected"
          data={data.dqByCategory}
          colorVar="--chart-4"
        />
        <BarChartCard
          title="KPIs by tracking cadence"
          data={data.byFrequency}
          colorVar="--chart-5"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
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
        <div className="mt-1.5 text-2xl font-semibold">
          <CountUp value={value} />
        </div>
      </CardContent>
    </Card>
  );
}
