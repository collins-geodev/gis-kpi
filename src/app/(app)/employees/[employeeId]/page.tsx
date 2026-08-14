"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent, formatTargetValue } from "@convex/lib/format";
import { ArrowLeft, Lock } from "lucide-react";

export default function IndividualPage() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = params.employeeId as Id<"employees">;
  const data = useQuery(api.employees.getDetail, { employeeId });

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { employee, kpis, scorecard } = data;

  return (
    <div className="space-y-6">
      <Link
        href="/team"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Team
      </Link>

      <PageHeader
        title={`${employee.honorific ? employee.honorific + " " : ""}${employee.displayName}`}
        description={`${employee.jobRole} · ${employee.canonicalLocation} · ${employee.employeeId}`}
      />

      {/* Scorecard summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryStat
          label="Assigned-weight score"
          value={`${formatNumber(scorecard.assignedWeightScore)} / ${scorecard.configuredWeight}`}
          hint={`Configured max ${scorecard.configuredWeight} (not 100)`}
          tone="brand"
        />
        <SummaryStat
          label="Normalized (÷ configured)"
          value={formatPercent(scorecard.normalizedScore / 100, 1)}
          hint="Labelled; shown only as configured"
        />
        <SummaryStat
          label="Evidence completeness"
          value={formatPercent(scorecard.evidenceCompletionPct / 100)}
        />
        <SummaryStat
          label="KPIs with data"
          value={`${scorecard.itemsWithData} / ${scorecard.itemCount}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned KPIs ({kpis.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Objective</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Attainment</TableHead>
                <TableHead className="text-right">Contribution</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kpis.map((k) => (
                <TableRow key={k.assignmentId}>
                  <TableCell className="max-w-sm">
                    <Link
                      href={`/kpi/${k.assignmentId}` as never}
                      className="font-medium text-accent hover:underline"
                    >
                      {k.objective}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{k.measurementMode}</span>
                      <span>· {k.frequency}</span>
                      {k.scoringBlocked && (
                        <Badge variant="warning">
                          <Lock className="h-3 w-3" /> Scoring blocked
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular">
                    {formatTargetValue(k.target, k.targetType)}
                  </TableCell>
                  <TableCell className="tabular text-right">{k.weight}</TableCell>
                  <TableCell className="tabular text-right">
                    {k.cappedAttainment === null
                      ? "—"
                      : formatPercent(k.cappedAttainment)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(k.weightedContribution)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={k.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-brand/40">
        <CardHeader>
          <CardTitle className="text-base">
            Configured weight {scorecard.configuredWeight} / 100
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This employee&apos;s five KPIs total {scorecard.configuredWeight} weight points
          (not 100). The score is never rebased to 100 without an explicit, labelled
          normalization. Activity capture, evidence gallery, reviewer feedback and score
          history attach here as data is entered.
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "brand";
}) {
  return (
    <Card className={tone === "brand" ? "border-brand/40" : undefined}>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="tabular mt-1.5 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
