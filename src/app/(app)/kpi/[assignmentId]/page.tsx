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
import { aggregateActivityInputs } from "@convex/lib/measure";
import { computeAttainment } from "@convex/lib/scoring";
import type { Direction, MeasurementMode } from "@convex/lib/types";
import {
  lagosDayKeyOf,
  lagosWeekKeyOf,
  lagosWeekLabelOf,
} from "@convex/lib/periods";
import { StatusBadge } from "@/components/status-badge";
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

  const { assignment, employee, definition, issues, measurements, activities } = data;

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

      {/* Day/week trend for daily & weekly cadences — informational only; the
          official score stays the period aggregate. */}
      {["Daily", "Weekly"].includes(assignment.frequency) && activities.length > 0 && (
        <CadenceBreakdown
          frequency={assignment.frequency}
          measurementMode={assignment.measurementMode}
          direction={assignment.direction}
          target={assignment.target}
          activities={activities}
        />
      )}

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

type BreakdownActivity = {
  id: string;
  activityAt: number;
  quantity: number | null;
  numerator: number | null;
  denominator: number | null;
  baseline: number | null;
  currentValue: number | null;
  withinThreshold: number | null;
  eligible: number | null;
  completed: number | null;
  planned: number | null;
  pass: boolean | null;
  score: number | null;
  maxScore: number | null;
};

/**
 * Groups counted entries by Lagos day (Daily KPIs) or ISO week (Weekly KPIs)
 * and scores each group through the same deterministic engine — a trend view
 * of what was actually done, while the official score stays the period total.
 */
function CadenceBreakdown({
  frequency,
  measurementMode,
  direction,
  target,
  activities,
}: {
  frequency: string;
  measurementMode: string;
  direction: string;
  target: number;
  activities: BreakdownActivity[];
}) {
  const byGroup = new Map<string, { label: string; entries: BreakdownActivity[] }>();
  for (const a of activities) {
    const key =
      frequency === "Daily" ? lagosDayKeyOf(a.activityAt) : lagosWeekKeyOf(a.activityAt);
    const label =
      frequency === "Daily"
        ? new Date(a.activityAt).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "Africa/Lagos",
          })
        : `${lagosWeekKeyOf(a.activityAt).split("-")[1]} · ${lagosWeekLabelOf(a.activityAt)}`;
    const group = byGroup.get(key) ?? { label, entries: [] };
    group.entries.push(a);
    byGroup.set(key, group);
  }

  const rows = [...byGroup.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([key, g]) => {
      try {
        const input = aggregateActivityInputs(
          measurementMode as MeasurementMode,
          direction as Direction,
          target,
          g.entries.map((e) => ({
            activityAt: e.activityAt,
            quantity: e.quantity ?? undefined,
            numerator: e.numerator ?? undefined,
            denominator: e.denominator ?? undefined,
            baseline: e.baseline ?? undefined,
            currentValue: e.currentValue ?? undefined,
            withinThreshold: e.withinThreshold ?? undefined,
            eligible: e.eligible ?? undefined,
            completed: e.completed ?? undefined,
            planned: e.planned ?? undefined,
            pass: e.pass ?? undefined,
            score: e.score ?? undefined,
            maxScore: e.maxScore ?? undefined,
          })),
        );
        const r = computeAttainment(input);
        return { key, label: g.label, entries: g.entries.length, result: r };
      } catch {
        return { key, label: g.label, entries: g.entries.length, result: null };
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {frequency === "Daily" ? "Daily" : "Weekly"} breakdown
        </CardTitle>
        <CardDescription>
          Each {frequency === "Daily" ? "day" : "week"} scored by the same engine —
          informational trend; the official score is the period total above.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{frequency === "Daily" ? "Day" : "Week"}</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="text-right">Computes to</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="tabular text-right">{r.entries}</TableCell>
                <TableCell className="tabular text-right">
                  {r.result?.cappedAttainment != null
                    ? formatPercent(r.result.cappedAttainment)
                    : "—"}
                </TableCell>
                <TableCell>
                  {r.result ? <StatusBadge status={r.result.status as never} /> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
