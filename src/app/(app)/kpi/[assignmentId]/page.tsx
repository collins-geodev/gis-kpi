"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatKpiTarget, formatNumber, formatPercent } from "@convex/lib/format";
import { EvidencePanel } from "@/components/evidence-panel";
import { ScoreOverridePanel } from "@/components/score-override-panel";
import { ArrowLeft, GaugeCircle, Lock } from "lucide-react";

function formatSource(value: number, type: string) {
  return type === "Percentage" ? formatPercent(value) : formatNumber(value);
}

const SEVERITY_VARIANT = {
  info: "info",
  warning: "warning",
  blocker: "critical",
} as const;

export default function KpiDetailPage() {
  const params = useParams<{ assignmentId: string }>();
  const assignmentId = params.assignmentId as Id<"kpiAssignments">;
  const data = useQuery(api.kpis.getAssignment, { assignmentId });

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const { assignment, employee, definition, issues, measurements } = data;

  return (
    <div className="space-y-6">
      {employee && (
        <Link
          href={`/employees/${employee.id}` as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {employee.displayName}
        </Link>
      )}

      <PageHeader
        title={assignment.objective}
        description={
          definition
            ? `${definition.title} · ${employee?.jobRole ?? ""}`
            : employee?.jobRole
        }
      />

      {assignment.scoringBlocked && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Lock className="mt-0.5 h-5 w-5 text-warning" />
            <div className="text-sm">
              <p className="font-medium">Final scoring is blocked for this KPI.</p>
              <p className="text-muted-foreground">
                One or more blocking data-quality issues must be resolved before an
                official score can be approved (see below).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Canonical vs Source */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canonical (application)</CardTitle>
            <CardDescription>Used for scoring after validation/approval</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Objective">{assignment.objective}</Field>
            <Field label="Metric / formula">{assignment.metric}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight">{assignment.weight}</Field>
              <Field label="Target">
                {formatKpiTarget(
                  assignment.target,
                  assignment.targetType,
                  assignment.measurementMode,
                )}
              </Field>
              <Field label="Cadence">{assignment.frequency}</Field>
              <Field label="Measurement">
                <span className="capitalize">{assignment.measurementMode}</span> ·{" "}
                {assignment.direction === "higherIsBetter"
                  ? "higher better"
                  : "lower better"}
              </Field>
              <Field label="Official cap">{formatPercent(assignment.scoreCap)}</Field>
              <Field label="Stretch cap">{formatPercent(assignment.stretchCap)}</Field>
            </div>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Source (workbook, verbatim)</CardTitle>
            <CardDescription>
              Row {assignment.sourceRowNumber} · never overwritten
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Objective">
              <span className="text-muted-foreground">{assignment.sourceObjective}</span>
            </Field>
            <Field label="Metric">
              <span className="text-muted-foreground">{assignment.sourceMetric}</span>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight">{assignment.sourceWeight}</Field>
              <Field label="Target">
                {formatSource(assignment.sourceTarget, assignment.sourceTargetType)}{" "}
                <span className="text-xs text-muted-foreground">
                  ({assignment.sourceTargetType})
                </span>
              </Field>
              <Field label="Cadence">
                {assignment.sourceFrequency ?? (
                  <span className="text-warning">(blank)</span>
                )}
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      {definition && (definition.needsRubric || definition.needsClarification) && (
        <Card className="border-info/40 bg-info/5">
          <CardContent className="p-4 text-sm">
            {definition.needsRubric && (
              <p>• Qualitative KPI — requires an admin-approved rubric before scoring.</p>
            )}
            {definition.needsClarification && (
              <p>• Requires business clarification (see data-quality issues).</p>
            )}
            <p className="mt-1 text-muted-foreground">{definition.scoringNotes}</p>
          </CardContent>
        </Card>
      )}

      {/* Data-quality issues attached to this KPI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Data-quality issues ({issues.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues on this row.</p>
          ) : (
            issues.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5 text-sm"
              >
                <Badge variant={SEVERITY_VARIANT[i.severity]}>{i.severity}</Badge>
                <span className="font-medium">{i.category.replace(/_/g, " ")}</span>
                <Badge variant="muted">{i.status}</Badge>
                {i.blocksScoring && <Badge variant="critical">blocks scoring</Badge>}
                <span className="w-full text-muted-foreground">{i.reason}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Evidence attach + review */}
      <EvidencePanel
        assignmentId={assignment.id as Id<"kpiAssignments">}
        kpi={{ canonicalKey: assignment.canonicalKey, objective: assignment.objective }}
      />

      <ScoreOverridePanel assignmentId={assignment.id as Id<"kpiAssignments">} />

      {/* Measurements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Measurements & lineage</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {measurements.length === 0 ? (
            <EmptyState
              icon={<GaugeCircle className="h-8 w-8" />}
              title="No measurements yet"
              description="Measurements are computed deterministically from captured activities and approved evidence."
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Attainment</TableHead>
                  <TableHead className="text-right">Contribution</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {measurements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.periodKey}</TableCell>
                    <TableCell className="tabular text-right">
                      {m.rawActual === null ? "—" : formatNumber(m.rawActual, 2)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {m.cappedAttainment === null
                        ? "—"
                        : formatPercent(m.cappedAttainment)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(m.weightedContribution)}
                    </TableCell>
                    <TableCell>{m.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
