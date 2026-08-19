"use client";

import { errorMessage } from "@/lib/errors";
import { useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DIRECTIONS,
  FREQUENCIES,
  MEASUREMENT_MODES,
  TARGET_TYPES,
  type AppRole,
} from "@convex/lib/types";
import { CheckCircle2, Loader2, Lock, Save } from "lucide-react";

export default function KpiSettingsPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canManage = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));
  const settings = useQuery(api.kpiSettings.yearSettings, canManage ? {} : "skip");
  const [selected, setSelected] = useState<string | null>(null);

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canManage) {
    return <AccessDenied message="Only KPI / System Admins can edit KPI settings." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Settings"
        description="Edit the canonical layer — weights, targets, target types, cadence, caps and normalization. The verbatim source layer is preserved; every change is audit-logged."
      />
      <YearSettingsCard settings={settings} />
      <WeightCompletenessCard
        settings={settings}
        selected={selected}
        onSelect={setSelected}
      />
      {selected && <EmployeeKpiEditor employeeId={selected as Id<"employees">} />}
    </div>
  );
}

type Settings = {
  year: number;
  timezone: string;
  normalizationEnabled: boolean;
  officialAttainmentCap: number;
  stretchAttainmentCap: number;
  captureStartAt: number | null;
  employees: {
    id: string;
    employeeId: string;
    displayName: string;
    jobRole: string;
    kpiCount: number;
    weightTotal: number;
  }[];
};

function YearSettingsCard({ settings }: { settings: Settings | null | undefined }) {
  const update = useMutation(api.kpiSettings.updateYearSettings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  if (settings === undefined) return <Skeleton className="h-40" />;
  if (settings === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance year {settings.year}</CardTitle>
        <CardDescription>
          Normalization and attainment caps. Timezone {settings.timezone}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setSaved(false);
            try {
              const captureDate = String(form.get("captureStart") ?? "");
              await update({
                normalizationEnabled: form.get("norm") === "on",
                officialAttainmentCap: Number(form.get("official")),
                stretchAttainmentCap: Number(form.get("stretch")),
                // Midnight Africa/Lagos on the chosen day; empty = open all year.
                captureStartAt: captureDate
                  ? Date.parse(`${captureDate}T00:00:00+01:00`)
                  : null,
              });
              setSaved(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="norm"
              defaultChecked={settings.normalizationEnabled}
              className="h-4 w-4"
            />
            Enable 80→100 normalization (labelled)
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              Official cap (1 = 100%)
            </span>
            <input
              type="number"
              step="0.05"
              name="official"
              defaultValue={settings.officialAttainmentCap}
              className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Stretch cap</span>
            <input
              type="number"
              step="0.05"
              name="stretch"
              defaultValue={settings.stretchAttainmentCap}
              className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              Capture opens (empty = all year)
            </span>
            <input
              type="date"
              name="captureStart"
              defaultValue={
                settings.captureStartAt
                  ? new Date(settings.captureStartAt + 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10)
                  : ""
              }
              className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function WeightCompletenessCard({
  settings,
  selected,
  onSelect,
}: {
  settings: Settings | null | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (settings === undefined) return <Skeleton className="h-64" />;
  if (settings === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Weight completeness — pick an employee to edit their KPIs
        </CardTitle>
        <CardDescription>
          Every employee totals 80 / 100 in the baseline. Adjust weights to reach 100, or
          leave 80 and enable normalization above.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">KPIs</TableHead>
              <TableHead className="text-right">Configured weight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.employees.map((e) => (
              <TableRow
                key={e.id}
                className={`cursor-pointer ${selected === e.id ? "bg-muted" : ""}`}
                onClick={() => onSelect(e.id)}
              >
                <TableCell className="font-medium">{e.displayName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {e.jobRole}
                </TableCell>
                <TableCell className="tabular text-right">{e.kpiCount}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={e.weightTotal === 100 ? "success" : "brand"}>
                    {e.weightTotal} / 100
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EmployeeKpiEditor({ employeeId }: { employeeId: Id<"employees"> }) {
  const assignments = useQuery(api.kpiSettings.assignmentsForEmployee, { employeeId });
  if (assignments === undefined) return <Skeleton className="h-96" />;

  const total = assignments.reduce((s, a) => s + a.weight, 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Editing 5 KPIs</span>
        <Badge variant={total === 100 ? "success" : "brand"}>
          weight total {total} / 100
        </Badge>
      </div>
      {assignments.map((a) => (
        <KpiEditorCard key={a.id} a={a} />
      ))}
    </div>
  );
}

type Assignment = {
  id: string;
  canonicalKey: string;
  objective: string;
  metric: string;
  weight: number;
  target: number;
  targetType: string;
  frequency: string;
  direction: string;
  measurementMode: string;
  scoreCap: number;
  stretchCap: number;
  evidenceRequired: boolean;
  pinnedBaseline: number | null;
  status: string;
  scoringBlocked: boolean;
  sourceRowNumber: number;
  sourceWeight: number;
  sourceTarget: number;
  sourceTargetType: string;
  sourceFrequency: string | null;
};

function KpiEditorCard({ a }: { a: Assignment }) {
  const update = useMutation(api.kpiSettings.updateAssignment);
  const [f, setF] = useState({
    objective: a.objective,
    metric: a.metric,
    weight: String(a.weight),
    targetType: a.targetType,
    // Percentage targets edited as a percent value for clarity.
    target:
      a.targetType === "percentage"
        ? String(Math.round(a.target * 1000) / 10)
        : String(a.target),
    frequency: a.frequency,
    direction: a.direction,
    measurementMode: a.measurementMode,
    scoreCap: String(a.scoreCap),
    stretchCap: String(a.stretchCap),
    evidenceRequired: a.evidenceRequired,
    pinnedBaseline: a.pinnedBaseline === null ? "" : String(a.pinnedBaseline),
    status: a.status,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof f, v: string | boolean) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const targetNum = Number(f.target);
      await update({
        assignmentId: a.id as Id<"kpiAssignments">,
        objective: f.objective,
        metric: f.metric,
        weight: Number(f.weight),
        targetType: f.targetType as never,
        target: f.targetType === "percentage" ? targetNum / 100 : targetNum,
        frequency: f.frequency as never,
        direction: f.direction as never,
        measurementMode: f.measurementMode as never,
        scoreCap: Number(f.scoreCap),
        stretchCap: Number(f.stretchCap),
        evidenceRequired: f.evidenceRequired,
        pinnedBaseline:
          f.measurementMode === "reduction" && f.pinnedBaseline.trim() !== ""
            ? Number(f.pinnedBaseline)
            : null,
        status: f.status as never,
        reason: "Edited in KPI Settings",
      });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, "Save failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm">
          <span className="text-muted-foreground">
            {a.canonicalKey.replace(/_/g, " ")}
          </span>{" "}
          — {a.objective.slice(0, 56)}
        </CardTitle>
        {a.scoringBlocked && (
          <Badge variant="warning">
            <Lock className="h-3 w-3" /> scoring blocked
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Text label="Objective">
          <textarea
            rows={2}
            value={f.objective}
            onChange={(e) => set("objective", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </Text>
        <Text label="Metric / formula">
          <textarea
            rows={2}
            value={f.metric}
            onChange={(e) => set("metric", e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </Text>

        {f.measurementMode === "reduction" && (
          <div className="rounded-md bg-info/10 px-3 py-2">
            <NumField
              label="Pinned baseline (blank = employee enters it)"
              value={f.pinnedBaseline}
              onChange={(v) => set("pinnedBaseline", v)}
            />
            <p className="mt-1 text-xs text-info">
              When set, employees only enter the current value — this reference figure is
              injected automatically and stays fixed for the year.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <NumField label="Weight" value={f.weight} onChange={(v) => set("weight", v)} />
          <SelectField
            label="Target type"
            value={f.targetType}
            onChange={(v) => set("targetType", v)}
            options={[...TARGET_TYPES]}
          />
          <NumField
            label={f.targetType === "percentage" ? "Target (%)" : "Target"}
            value={f.target}
            onChange={(v) => set("target", v)}
          />
          <SelectField
            label="Cadence"
            value={f.frequency}
            onChange={(v) => set("frequency", v)}
            options={[...FREQUENCIES]}
          />
          <SelectField
            label="Direction"
            value={f.direction}
            onChange={(v) => set("direction", v)}
            options={[...DIRECTIONS]}
          />
          <SelectField
            label="Measurement mode"
            value={f.measurementMode}
            onChange={(v) => set("measurementMode", v)}
            options={[...MEASUREMENT_MODES]}
          />
          <NumField
            label="Official cap"
            value={f.scoreCap}
            onChange={(v) => set("scoreCap", v)}
            step="0.05"
          />
          <NumField
            label="Stretch cap"
            value={f.stretchCap}
            onChange={(v) => set("stretchCap", v)}
            step="0.05"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.evidenceRequired}
              onChange={(e) => set("evidenceRequired", e.target.checked)}
              className="h-4 w-4"
            />
            Evidence required
          </label>
          <SelectField
            label="Status"
            value={f.status}
            onChange={(v) => set("status", v)}
            options={["draft", "active", "retired"]}
            inline
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Source row {a.sourceRowNumber}: weight {a.sourceWeight}, target{" "}
            {a.sourceTarget} {a.sourceTargetType},{" "}
            {a.sourceFrequency ?? "(blank cadence)"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save KPI
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
          {error && <span className="text-sm text-critical">{error}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Text({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <input
        type="number"
        step={step ?? "any"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  inline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  inline?: boolean;
}) {
  return (
    <label className={inline ? "flex items-center gap-2 text-sm" : "text-sm"}>
      <span
        className={inline ? "text-muted-foreground" : "mb-1 block text-muted-foreground"}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
