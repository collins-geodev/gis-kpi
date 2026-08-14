"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { formatPercent } from "@convex/lib/format";

export default function AnalyticsPage() {
  const data = useQuery(api.analytics.dashboard);

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          description="Configuration, data-quality and score posture for the GIS Unit."
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
    cov.totalMeasurements === 0 ? "—" : formatPercent(n / cov.totalMeasurements);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Charts answer management questions and each has a table alternative. With a fresh baseline, configuration & data-quality views populate immediately; score views fill as measurements are approved."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Employees" value={String(data.totals.employees)} />
        <Stat label="KPI assignments" value={String(data.totals.assignments)} />
        <Stat
          label="Scoring-blocked KPIs"
          value={String(data.totals.scoringBlocked)}
          tone="warning"
        />
        <Stat
          label="Blocking DQ issues"
          value={String(data.totals.dqBlockers)}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChartCard
          title="Weight completeness"
          description="Employees whose 5 KPIs total 80 vs 100"
          data={data.weightCompleteness}
          colorVar="--chart-6"
        />
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
          title="KPIs by measurement mode"
          data={data.byMode}
          colorVar="--chart-3"
        />
        <BarChartCard
          title="KPIs by tracking cadence"
          data={data.byFrequency}
          colorVar="--chart-5"
        />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <MiniStat label="Measurements with data" value={pct(cov.withData)} />
          <MiniStat label="Evidence complete" value={pct(cov.evidenceComplete)} />
          <MiniStat label="Cadence compliant" value={pct(cov.cadenceCompliant)} />
          <MiniStat label="Approved (final)" value={pct(cov.approved)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={tone === "warning" ? "border-warning/40" : undefined}>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="tabular mt-1.5 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
