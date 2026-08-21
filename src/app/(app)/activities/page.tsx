"use client";

import { errorMessage } from "@/lib/errors";
import { useEffect, useMemo, useState } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { EvidencePanel } from "@/components/evidence-panel";
import { StatusBadge } from "@/components/status-badge";
import { aggregateActivityInputs } from "@convex/lib/measure";
import { computeAttainment } from "@convex/lib/scoring";
import { formatPercent, normalizeReductionTarget } from "@convex/lib/format";
import type { Direction, Frequency, MeasurementMode } from "@convex/lib/types";
import { LAGOS_OFFSET_MS, captureGrainForFrequency } from "@convex/lib/periods";
import { suggestActivityTitle } from "@/lib/evidence-suggestions";

/** Lagos calendar date ("2026-08-18") of an epoch instant. */
function lagosDateString(epochMs: number): string {
  return new Date(epochMs + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
/** Noon-Lagos epoch for a yyyy-mm-dd date (avoids timezone edge flips). */
function epochFromLagosDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, 12) - LAGOS_OFFSET_MS;
}
const clampTs = (ts: number, min?: number, max?: number) =>
  Math.min(Math.max(ts, min ?? ts), max ?? ts);

/** Cadences where the exact work-date matters enough to ask for it. */
const DATED_FREQUENCIES = ["Daily", "Weekly"];
/** Modes whose entries add up across the period (period-so-far is meaningful). */
const ACCUMULATING_MODES = ["count", "durationSla", "milestone", "composite"];
/** Ratio KPIs captured as incremental batch logs (mirrors the server list). */
const ACCUMULATING_RATIO_KEYS = ["qa_data_quality"];
const accumulates = (a: Assignment) =>
  ACCUMULATING_MODES.includes(a.measurementMode) ||
  ACCUMULATING_RATIO_KEYS.includes(a.canonicalKey);

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
  pinnedBaseline: number | null;
  scoringBlocked: boolean;
  kpiCategory: string;
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Human label for any period key: "2026-M07" → "Jul 2026", "2026-Q3" → "Q3 2026". */
function periodLabel(pk: string): string {
  const m = /^(\d{4})-M(\d{2})$/.exec(pk);
  if (m) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  const q = /^(\d{4})-Q([1-4])$/.exec(pk);
  if (q) return `Q${q[2]} ${q[1]}`;
  return pk;
}

/** KPI-specific overrides for the generic mode field labels. */
const KEY_FIELD_LABELS: Record<string, Record<string, string>> = {
  qa_data_quality: {
    numerator: "Errors corrected (this batch)",
    denominator: "Errors identified (this batch)",
  },
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
  const updateActivity = useMutation(api.activities.update);
  const removeActivity = useMutation(api.activities.remove);

  const [assignmentId, setAssignmentId] = useState<string>("");
  const [periodKey, setPeriodKey] = useState<string>("2026-M08");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, number | boolean>>({});
  const [activityDate, setActivityDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id<"activities"> | null>(null);
  const editing = useQuery(
    api.activities.getForEdit,
    editingId ? { activityId: editingId } : "skip",
  );

  // When an activity is opened for editing, load its payload into the form.
  useEffect(() => {
    if (!editing) return;
    setAssignmentId(editing.kpiAssignmentId);
    setPeriodKey(editing.periodKey);
    setTitle(editing.title);
    setDescription(editing.description);
    const inputs: Record<string, number | boolean> = {};
    for (const key of [
      "quantity",
      "numerator",
      "denominator",
      "baseline",
      "currentValue",
      "withinThreshold",
      "eligible",
      "completed",
      "planned",
      "pass",
      "score",
      "maxScore",
    ] as const) {
      const v = editing[key];
      if (v !== undefined) inputs[key] = v;
    }
    setValues(inputs);
    setActivityDate(lagosDateString(editing.activityAt));
    setDone(false);
    setError(null);
  }, [editing]);

  function resetForm() {
    setEditingId(null);
    setAssignmentId("");
    setPeriodKey("2026-M08");
    setTitle("");
    setDescription("");
    setValues({});
    setActivityDate("");
    setError(null);
  }

  const selected: Assignment | undefined = useMemo(
    () => (assignments ?? []).find((a) => a.id === assignmentId),
    [assignments, assignmentId],
  );
  const baselinePinned =
    selected?.measurementMode === "reduction" && selected.pinnedBaseline !== null;
  const fields = (selected ? (MODE_FIELDS[selected.measurementMode] ?? []) : [])
    .filter((fld) => !(baselinePinned && fld.name === "baseline"))
    .map((fld) =>
      // Budget-style counts (lower is better) count occurrences, not achievements.
      selected?.measurementMode === "count" &&
      selected.direction === "lowerIsBetter" &&
      fld.name === "quantity"
        ? { ...fld, label: "Count found this period (e.g. errors)" }
        : fld,
    )
    .map((fld) => {
      const override = selected && KEY_FIELD_LABELS[selected.canonicalKey]?.[fld.name];
      return override ? { ...fld, label: override } : fld;
    });

  // The title is fully auto-generated from the KPI + period (read-only field).
  useEffect(() => {
    if (editingId || !selected) return;
    const label =
      (periods ?? []).find((p) => p.periodKey === periodKey)?.label ?? periodKey;
    setTitle(suggestActivityTitle(selected.canonicalKey, selected.objective, label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, periodKey, editingId]);

  // What's already captured for this (KPI, period) — powers the duplicate
  // guard and the "period so far" preview (also needed while editing).
  const existing = useQuery(
    api.activities.existingForPeriod,
    selected
      ? { kpiAssignmentId: selected.id as Id<"kpiAssignments">, periodKey }
      : "skip",
  );
  const duplicateBlocked = Boolean(
    !editingId && existing && existing.singleEntry && existing.count > 0,
  );

  // Evidence-first rule (mirrors the server): an evidence-required KPI can't
  // be captured until proof is attached. Reactive — Save unlocks on attach.
  const evidenceForSelected = useQuery(
    api.evidence.listForAssignment,
    selected && !editingId
      ? { kpiAssignmentId: selected.id as Id<"kpiAssignments"> }
      : "skip",
  );
  const evidenceMissing = Boolean(
    !editingId &&
    selected?.evidenceRequired &&
    evidenceForSelected !== undefined &&
    evidenceForSelected.length === 0,
  );

  /**
   * A KPI accumulates in its native cadence bucket: quarterly KPIs offer
   * Q1–Q4 (entries add up across the quarter against the full target),
   * annual KPIs the year, monthly/daily KPIs the months.
   */
  const availablePeriods = useMemo(() => {
    if (!selected) return periods ?? [];
    const grain = captureGrainForFrequency(selected.frequency as Frequency);
    return (periods ?? []).filter((p) => p.grain === grain);
  }, [periods, selected]);

  // When the KPI changes, snap the period to the current bucket of its cadence.
  useEffect(() => {
    if (!selected || availablePeriods.length === 0) return;
    if (availablePeriods.some((p) => p.periodKey === periodKey)) return;
    const now = Date.now();
    const current =
      [...availablePeriods].reverse().find((p) => p.startAt <= now) ??
      availablePeriods[0]!;
    setPeriodKey(current.periodKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, availablePeriods]);

  const selectedPeriod = useMemo(
    () => (periods ?? []).find((p) => p.periodKey === periodKey),
    [periods, periodKey],
  );
  // Daily/weekly KPIs ask for the exact work-date (accurate backfill + the
  // day/week breakdown); other cadences stamp save-time clamped to the period.
  const showDateField = Boolean(
    selected && DATED_FREQUENCIES.includes(selected.frequency),
  );
  const dateMin = selectedPeriod ? lagosDateString(selectedPeriod.startAt) : undefined;
  const dateMax = lagosDateString(
    selectedPeriod ? Math.min(selectedPeriod.endAt, Date.now()) : Date.now(),
  );

  // Default the activity date to today, clamped into the selected period.
  useEffect(() => {
    if (editingId) return;
    const bounded = selectedPeriod
      ? clampTs(
          Date.now(),
          selectedPeriod.startAt,
          Math.min(selectedPeriod.endAt, Date.now()),
        )
      : Date.now();
    setActivityDate(lagosDateString(bounded));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, periodKey, editingId]);

  /**
   * Live preview through the REAL scoring engine — what this entry alone
   * computes to, so the consequence is visible before saving.
   */
  const preview = useMemo(() => {
    if (!selected) return null;
    try {
      const input = aggregateActivityInputs(
        selected.measurementMode as MeasurementMode,
        selected.direction as Direction,
        selected.target,
        [
          {
            activityAt: 1,
            quantity: num(values.quantity),
            numerator: num(values.numerator),
            denominator: num(values.denominator),
            baseline:
              selected.measurementMode === "reduction" && selected.pinnedBaseline !== null
                ? selected.pinnedBaseline
                : num(values.baseline),
            currentValue: num(values.currentValue),
            withinThreshold: num(values.withinThreshold),
            eligible: num(values.eligible),
            completed: num(values.completed),
            planned: num(values.planned),
            pass:
              selected.measurementMode === "binary" ? Boolean(values.pass) : undefined,
            score: num(values.score),
            maxScore: num(values.maxScore),
          },
        ],
      );
      const r = computeAttainment(input);
      return r.hasData ? r : null;
    } catch {
      return null; // required inputs not filled in yet
    }
  }, [selected, values]);

  /**
   * "Period so far" — this entry PLUS the already-counted entries of the same
   * (KPI, period), through the same engine. Only shown for accumulating modes,
   * so daily/weekly logging visibly builds the period's running score.
   */
  const soFar = useMemo(() => {
    if (!selected || !preview) return null;
    if (!accumulates(selected)) return null;
    const others = (existing?.countedInputs ?? []).filter((e) => e.id !== editingId);
    if (others.length === 0) return null;
    try {
      const input = aggregateActivityInputs(
        selected.measurementMode as MeasurementMode,
        selected.direction as Direction,
        selected.target,
        [
          ...others.map((e) => ({
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
          {
            activityAt: Number.MAX_SAFE_INTEGER,
            quantity: num(values.quantity),
            numerator: num(values.numerator),
            denominator: num(values.denominator),
            withinThreshold: num(values.withinThreshold),
            eligible: num(values.eligible),
            completed: num(values.completed),
            planned: num(values.planned),
          },
        ],
      );
      const r = computeAttainment(input);
      return r.hasData ? r : null;
    } catch {
      return null;
    }
  }, [selected, preview, existing, editingId, values]);

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
    const payload = {
      periodKey,
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
      // Binary KPIs: an untouched checkbox is an explicit "not met".
      pass:
        selected.measurementMode === "binary"
          ? Boolean(values.pass)
          : typeof values.pass === "boolean"
            ? values.pass
            : undefined,
    };
    // Dated cadences use the chosen work-date (noon Lagos); the rest stamp
    // save-time clamped into the period so late logging stays inside it.
    const activityAt =
      showDateField && activityDate
        ? epochFromLagosDate(activityDate)
        : clampTs(Date.now(), selectedPeriod?.startAt, selectedPeriod?.endAt);
    try {
      if (editingId) {
        await updateActivity({
          activityId: editingId,
          ...(showDateField ? { activityAt } : {}),
          ...payload,
        });
        resetForm();
      } else {
        await create({
          kpiAssignmentId: selected.id as Id<"kpiAssignments">,
          activityAt,
          ...payload,
        });
        setTitle("");
        setDescription("");
        setValues({});
      }
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Could not save activity."));
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
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">
                {editingId ? "Edit activity" : "New activity"}
              </CardTitle>
              <CardDescription>
                {editingId
                  ? "Correct the entry — its measurement recomputes on save."
                  : "Choose a KPI, then enter its measurement inputs. All fields are required."}
              </CardDescription>
            </div>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm}>
                <X className="h-4 w-4" /> Cancel edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Row label="KPI" required>
                <select
                  required
                  disabled={editingId !== null}
                  value={assignmentId}
                  onChange={(e) => {
                    setAssignmentId(e.target.value);
                    setValues({});
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70"
                >
                  <option value="">Select a KPI…</option>
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.objective}
                    </option>
                  ))}
                </select>
              </Row>

              {selected && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {selected.kpiCategory === "non_core" && (
                    <Badge variant="info">non-core</Badge>
                  )}
                  <Badge variant="muted">{selected.measurementMode}</Badge>
                  <Badge variant="muted">{selected.frequency}</Badge>
                  <Badge variant="muted">weight {selected.weight}</Badge>
                  <Badge variant="info">
                    target{" "}
                    {selected.measurementMode === "reduction"
                      ? formatPercent(normalizeReductionTarget(selected.target))
                      : selected.targetType === "percentage"
                        ? formatPercent(selected.target)
                        : selected.measurementMode === "count" &&
                            selected.direction === "lowerIsBetter"
                          ? `≤ ${selected.target}`
                          : selected.target}
                  </Badge>
                  {selected.evidenceRequired && (
                    <Badge variant="warning">evidence required</Badge>
                  )}
                  {selected.scoringBlocked && (
                    <Badge variant="critical">scoring blocked</Badge>
                  )}
                </div>
              )}

              <Row label="Period" required>
                <select
                  required
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {availablePeriods.map((p) => (
                    <option key={p.periodKey} value={p.periodKey}>
                      {p.label} ({p.grain})
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Title (auto-generated)" required>
                <input
                  required
                  readOnly
                  value={title}
                  tabIndex={-1}
                  aria-label="Title — generated automatically from the KPI and period"
                  className="h-9 w-full cursor-default rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground"
                  placeholder="Select a KPI to generate the title"
                />
              </Row>

              {showDateField && (
                <Row label="Activity date" required>
                  <input
                    type="date"
                    required
                    value={activityDate}
                    min={dateMin}
                    max={dateMax}
                    onChange={(e) => setActivityDate(e.target.value)}
                    aria-label="The day the work actually happened (within the selected period)"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    The day the work actually happened — backfilling is fine, it just has
                    to stay inside the selected period.
                  </p>
                </Row>
              )}

              {baselinePinned && (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Baseline (pinned by admin):{" "}
                  <strong className="tabular text-foreground">
                    {selected!.pinnedBaseline}
                  </strong>{" "}
                  — you only enter the current value.
                </p>
              )}

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
                        <RequiredMark />
                      </label>
                    ) : (
                      <label key={f.name} className="text-sm">
                        <span className="text-muted-foreground">
                          {f.label}
                          <RequiredMark />
                        </span>
                        <input
                          type="number"
                          step="any"
                          required
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

              {selected && (
                <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-info">
                  {modeHint(selected)}
                </p>
              )}

              {!editingId && existing && existing.count > 0 && (
                <div
                  role="alert"
                  className={`space-y-2 rounded-md border px-3 py-2.5 text-sm ${
                    duplicateBlocked
                      ? "border-critical/40 bg-critical/10 text-critical"
                      : "border-warning/40 bg-warning/10 text-warning"
                  }`}
                >
                  {duplicateBlocked ? (
                    <p>
                      This KPI has <strong>already been captured</strong> for this{" "}
                      {selected?.frequency.toLowerCase()} period (&ldquo;
                      {existing.entries[0]?.title}&rdquo;). One entry is the period&apos;s
                      summary — edit it instead of logging it again.
                    </p>
                  ) : (
                    <p>
                      Already logged <strong>{existing.count}</strong>{" "}
                      {existing.count === 1 ? "entry" : "entries"} for this period (
                      {existing.entries
                        .map((e) => `“${e.title.slice(0, 40)}”`)
                        .join(", ")}
                      ) — entries add up, so only add this if it is{" "}
                      <strong>new work</strong>, not a re-log.
                    </p>
                  )}
                  {duplicateBlocked && existing.entries[0] && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(existing.entries[0]!.id as Id<"activities">);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit the existing entry
                    </Button>
                  )}
                </div>
              )}

              {preview && (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                  aria-live="polite"
                >
                  <span className="text-muted-foreground">
                    {soFar ? "This entry:" : "Computes to:"}
                  </span>
                  <span className="tabular font-semibold">
                    {preview.cappedAttainment !== null
                      ? formatPercent(preview.cappedAttainment)
                      : "—"}
                  </span>
                  {!soFar && <StatusBadge status={preview.status as never} />}
                  {preview.attainment !== null &&
                    preview.cappedAttainment !== null &&
                    preview.attainment > preview.cappedAttainment && (
                      <span className="text-xs text-muted-foreground">
                        (raw {formatPercent(preview.attainment)}, capped)
                      </span>
                    )}
                  {soFar && (
                    <>
                      <span className="text-muted-foreground">
                        · {selectedPeriod?.label ?? "Period"} so far:
                      </span>
                      <span className="tabular font-semibold">
                        {soFar.cappedAttainment !== null
                          ? formatPercent(soFar.cappedAttainment)
                          : "—"}
                      </span>
                      <StatusBadge status={soFar.status as never} />
                    </>
                  )}
                </div>
              )}

              <Row label="Notes" required>
                <textarea
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Context, references, ticket / project IDs…"
                />
              </Row>

              {evidenceMissing && selected && (
                <div className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-3">
                  <p
                    className="flex items-start gap-1.5 text-sm font-medium text-warning"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    This KPI requires evidence — a submission needs both the work numbers
                    and the proof behind them. Attach a file or link below; Save unlocks
                    the moment it&apos;s attached. Attachments stay quietly with this KPI
                    and go for review together with the activity when you save it.
                  </p>
                  <EvidencePanel
                    assignmentId={selected.id as Id<"kpiAssignments">}
                    kpi={{
                      canonicalKey: selected.canonicalKey,
                      objective: selected.objective,
                    }}
                    deferNotice
                    periodKey={periodKey}
                  />
                </div>
              )}

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

              <Button
                type="submit"
                disabled={submitting || !selected || duplicateBlocked || evidenceMissing}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {duplicateBlocked
                  ? "Already captured — edit it instead"
                  : evidenceMissing
                    ? "Attach evidence to unlock"
                    : editingId
                      ? "Save changes"
                      : "Save activity"}
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
              recent.map((a) => {
                const deletable = ["draft", "submitted", "needs_changes"].includes(
                  a.status,
                );
                return (
                  <div
                    key={a.id}
                    className="flex items-stretch gap-1 rounded-md border border-border text-sm transition-colors hover:bg-muted/50"
                  >
                    <Link
                      href={`/kpi/${a.kpiAssignmentId}` as never}
                      className="min-w-0 flex-1 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{a.title}</span>
                        <Badge variant="muted">{a.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {periodLabel(a.periodKey)} ·{" "}
                        {new Date(a.activityAt).toLocaleDateString("en-GB", {
                          timeZone: "Africa/Lagos",
                        })}
                      </div>
                    </Link>
                    {deletable && (
                      <button
                        type="button"
                        aria-label={`Edit activity “${a.title}”`}
                        title="Edit this activity"
                        className="flex items-center px-2 text-muted-foreground hover:bg-accent/10 hover:text-accent"
                        onClick={() => {
                          setEditingId(a.id as Id<"activities">);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {deletable && (
                      <button
                        type="button"
                        aria-label={`Delete activity “${a.title}”`}
                        title="Delete this activity (its measurement is recomputed)"
                        className="flex items-center rounded-r-md px-2 text-muted-foreground hover:bg-critical/10 hover:text-critical"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete “${a.title}” (${periodLabel(a.periodKey)})? The KPI measurement will be recomputed without it.`,
                            )
                          )
                            return;
                          if (editingId === (a.id as Id<"activities">)) resetForm();
                          void removeActivity({ activityId: a.id as Id<"activities"> });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })
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

/** Plain-language guidance for each measurement mode's inputs. */
function modeHint(a: Assignment): React.ReactNode {
  switch (a.measurementMode) {
    case "ratio":
      if (ACCUMULATING_RATIO_KEYS.includes(a.canonicalKey)) {
        return (
          <>
            Log each QA batch as it happens — <strong>corrected / identified</strong> in
            that batch. Entries add up across the month (6/8 this week + 9/9 next week =
            15/17 so far), and the score always reflects the real volume, whether the
            month brings fewer or more than usual.
          </>
        );
      }
      return (
        <>
          The denominator is the number of eligible items that{" "}
          <strong>actually existed</strong> this period (e.g. items that came in) — not an
          aspirational quota. If 10 came and you handled all 10, enter 10 / 10; fewer or
          more than usual is fine — the score adjusts to the real volume. One entry
          summarizes the period: as the numbers grow, <strong>edit it</strong> (pencil
          icon under Recent activities) and the score recomputes.
        </>
      );
    case "count":
      if (a.direction === "lowerIsBetter") {
        return (
          <>
            Enter how many were <strong>found</strong> this period (e.g. QA errors) — it
            is scored against a budget of <strong>at most {a.target}</strong>. At or below
            budget = 100%; going over degrades gradually (budget ÷ found), and zero is
            perfect. Multiple entries in the same period add up, so log each batch as it
            happens.
          </>
        );
      }
      return (
        <>
          Enter the number <strong>actually achieved</strong> this period — it is scored
          against the target of <strong>{a.target}</strong>. Multiple entries in the same
          period add up (log each one as it happens).
        </>
      );
    case "durationSla":
      return (
        <>
          <strong>Resolved within threshold</strong> = items closed inside the agreed time
          window; <strong>total eligible</strong> = everything that came in this period.
          If 8 of 9 issues were resolved within 24 hours, enter 8 / 9. Entries add up
          across the period.
        </>
      );
    case "reduction":
      return (
        <>
          Count the <strong>same thing</strong> in both boxes — e.g. QA errors found.{" "}
          <strong>Baseline</strong> = how many there were in the agreed reference period
          (e.g. same month last year); <strong>current</strong> = how many this period.
          Worked example with the {formatPercent(normalizeReductionTarget(a.target))}{" "}
          reduction target: baseline 50 → current 40 is a 20% drop ={" "}
          <strong>target met (100%)</strong>; current 45 is only a 10% drop = 50%
          attainment. Use whole counts, keep the baseline fixed all year, and state both
          numbers in your notes.
        </>
      );
    case "milestone":
      return (
        <>
          Milestones <strong>completed vs planned</strong> for this period — if 3 of 4
          planned milestones were approved, enter 3 / 4. Entries add up across the period.
        </>
      );
    case "binary":
      return (
        <>
          Tick the box when the condition was <strong>met</strong> this period; leaving it
          unticked records an explicit &ldquo;not met&rdquo;. The most recent entry
          counts.
        </>
      );
    case "rubric":
      return (
        <>
          <strong>Rubric score</strong> = points earned against the rubric agreed with
          your reviewer; <strong>rubric max</strong> = its total points (e.g. 3 / 4). The
          most recent entry counts — attach evidence of what was delivered.
        </>
      );
    case "composite":
      return (
        <>
          Health checks <strong>completed vs scheduled</strong>, plus unscheduled downtime
          incidents. Zero downtime is a gate — any incident caps the period score at 50%.
        </>
      );
    default:
      return <>Enter this period&apos;s measurement inputs; all fields are required.</>;
  }
}

function Row({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">
        {label}
        {required && <RequiredMark />}
      </span>
      {children}
    </label>
  );
}

/** Visible required indicator; screen readers rely on the input's `required`. */
function RequiredMark() {
  return (
    <span className="ml-0.5 text-critical" aria-hidden>
      *
    </span>
  );
}
