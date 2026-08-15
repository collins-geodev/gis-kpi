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
import { ArrowLeft, History, Lock } from "lucide-react";

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

      {/* Official score history — frozen approved snapshots, newest first. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-accent" /> Score history (
            {data.history.length})
          </CardTitle>
        </CardHeader>
        <CardContent className={data.history.length === 0 ? undefined : "p-0"}>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No approved periods yet. When a manager approves a period from Review &amp;
              Approval, the official score is frozen here as an auditable snapshot.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Official score</TableHead>
                  <TableHead>Normalized</TableHead>
                  <TableHead className="hidden md:table-cell">Trend</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Approved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <Badge variant="muted">{h.periodKey}</Badge>
                    </TableCell>
                    <TableCell className="tabular font-semibold">
                      {formatNumber(h.assignedWeightScore)} / {h.configuredWeight}
                    </TableCell>
                    <TableCell className="tabular">
                      {formatPercent(h.normalizedScore / 100, 1)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className="grad-signature h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, h.normalizedScore))}%`,
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-sm">
                      {formatPercent(h.evidenceCompletionPct / 100)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {h.approvedBy ?? "—"}
                      <span className="block">
                        {new Date(h.createdAt).toLocaleDateString("en-GB", {
                          timeZone: "Africa/Lagos",
                        })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
