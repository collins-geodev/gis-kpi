"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";

type Assignment = {
  id: string;
  objective: string;
  metric: string;
  canonicalKey: string;
  measurementMode: string;
  direction: string;
  targetType: string;
  target: number;
  frequency: string;
  weight: number;
  evidenceRequired: boolean;
  scoringBlocked: boolean;
};

const MODE_FIELDS: Record<
  string,
  { name: string; label: string; kind: "number" | "bool" }[]
> = {
  ratio: [
    { name: "numerator", label: "Numerator (achieved)", kind: "number" },
    { name: "denominator", label: "Denominator (planned/total)", kind: "number" },
  ],
  durationSla: [
    { name: "withinThreshold", label: "Resolved within threshold", kind: "number" },
    { name: "eligible", label: "Total eligible items", kind: "number" },
  ],
  count: [{ name: "quantity", label: "Count achieved", kind: "number" }],
  reduction: [
    { name: "baseline", label: "Prior-year baseline", kind: "number" },
    { name: "currentValue", label: "Current value", kind: "number" },
  ],
  milestone: [
    { name: "completed", label: "Milestones completed", kind: "number" },
    { name: "planned", label: "Milestones planned", kind: "number" },
  ],
  binary: [{ name: "pass", label: "Condition met?", kind: "bool" }],
  rubric: [
    { name: "score", label: "Rubric score", kind: "number" },
    { name: "maxScore", label: "Rubric max", kind: "number" },
  ],
  composite: [
    { name: "numerator", label: "Health checks completed", kind: "number" },
    { name: "denominator", label: "Health checks scheduled", kind: "number" },
    { name: "quantity", label: "Unscheduled downtime incidents", kind: "number" },
  ],
};

export default function ActivitiesPage() {
  const assignments = useQuery(api.activities.myAssignments);
  const periods = useQuery(api.activities.periods);
  const recent = useQuery(api.activities.listMine, { limit: 15 });
  const create = useMutation(api.activities.create);

  const [assignmentId, setAssignmentId] = useState<string>("");
  const [periodKey, setPeriodKey] = useState<string>("2026-M08");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, number | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected: Assignment | undefined = useMemo(
    () => (assignments ?? []).find((a) => a.id === assignmentId),
    [assignments, assignmentId],
  );
  const fields = selected ? (MODE_FIELDS[selected.measurementMode] ?? []) : [];

  if (assignments === undefined) return <Skeleton className="h-64" />;

  if (assignments.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Activity Capture"
          description="Record the work that supports your KPI results."
        />
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No KPIs linked to your account"
          description="Your login isn't linked to a roster employee yet. Ask a System Admin to link your account (Users & Organization) so your five KPIs appear here."
        />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      await create({
        kpiAssignmentId: selected.id as Id<"kpiAssignments">,
        periodKey,
        activityAt: Date.now(),
        title,
        description,
        numerator: num(values.numerator),
        denominator: num(values.denominator),
        withinThreshold: num(values.withinThreshold),
        eligible: num(values.eligible),
        quantity: num(values.quantity),
        baseline: num(values.baseline),
        currentValue: num(values.currentValue),
        completed: num(values.completed),
        planned: num(values.planned),
        score: num(values.score),
        maxScore: num(values.maxScore),
        pass: typeof values.pass === "boolean" ? values.pass : undefined,
      });
      setDone(true);
      setTitle("");
      setDescription("");
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save activity.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Capture"
        description="Log the raw inputs behind a KPI result. Measurements recompute deterministically; required evidence must be approved before a score becomes official."
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New activity</CardTitle>
            <CardDescription>
              Choose a KPI, then enter its measurement inputs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Row label="KPI">
                <select
                  required
                  value={assignmentId}
                  onChange={(e) => {
                    setAssignmentId(e.target.value);
                    setValues({});
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Select a KPI…</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.objective.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </Row>

              {selected && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="muted">{selected.measurementMode}</Badge>
                  <Badge variant="muted">{selected.frequency}</Badge>
                  <Badge variant="muted">weight {selected.weight}</Badge>
                  {selected.evidenceRequired && (
                    <Badge variant="warning">evidence required</Badge>
                  )}
                  {selected.scoringBlocked && (
                    <Badge variant="critical">scoring blocked</Badge>
                  )}
                </div>
              )}

              <Row label="Period">
                <select
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {(periods ?? []).map((p) => (
                    <option key={p.periodKey} value={p.periodKey}>
                      {p.label} ({p.grain})
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Title">
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="e.g. Integrated Ikorodu feeder assets"
                />
              </Row>

              {fields.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {fields.map((f) =>
                    f.kind === "bool" ? (
                      <label
                        key={f.name}
                        className="col-span-2 flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(values[f.name])}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [f.name]: e.target.checked }))
                          }
                          className="h-4 w-4"
                        />
                        {f.label}
                      </label>
                    ) : (
                      <label key={f.name} className="text-sm">
                        <span className="text-muted-foreground">{f.label}</span>
                        <input
                          type="number"
                          step="any"
                          value={
                            values[f.name] === undefined ? "" : String(values[f.name])
                          }
                          onChange={(e) =>
                            setValues((v) => ({
                              ...v,
                              [f.name]:
                                e.target.value === ""
                                  ? undefined!
                                  : Number(e.target.value),
                            }))
                          }
                          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </label>
                    ),
                  )}
                </div>
              )}

              <Row label="Notes">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Context, references, ticket / project IDs…"
                />
              </Row>

              {error && (
                <p className="text-sm text-critical" role="alert">
                  {error}
                </p>
              )}
              {done && (
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> Activity saved — measurement
                  recomputed.
                </p>
              )}

              <Button type="submit" disabled={submitting || !selected}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save activity
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent === undefined ? (
              <Skeleton className="h-24" />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activities yet.</p>
            ) : (
              recent.map((a) => (
                <Link
                  key={a.id}
                  href={`/kpi/${a.kpiAssignmentId}` as never}
                  className="block rounded-md border border-border p-2.5 text-sm hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.title}</span>
                    <Badge variant="muted">{a.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.periodKey} ·{" "}
                    {new Date(a.activityAt).toLocaleDateString("en-GB", {
                      timeZone: "Africa/Lagos",
                    })}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function num(v: number | boolean | undefined): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}
