"use client";

import { errorMessage } from "@/lib/errors";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@convex/lib/format";
import { Scale, Trash2 } from "lucide-react";
import type { AppRole } from "@convex/lib/types";

/**
 * Documented score adjustment (KPI/System Admin only) — for cases the engine
 * cannot judge fairly, e.g. a quota KPI in a month where demand fell short.
 */
export function ScoreOverridePanel({
  assignmentId,
}: {
  assignmentId: Id<"kpiAssignments">;
}) {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const isAdmin = roles.some((r) => ["kpi_admin", "system_admin"].includes(r));

  const overrides = useQuery(
    api.overrides.listForAssignment,
    isAdmin ? { kpiAssignmentId: assignmentId } : "skip",
  );
  const periods = useQuery(api.activities.periods, isAdmin ? {} : "skip");
  const apply = useMutation(api.overrides.apply);
  const remove = useMutation(api.overrides.remove);

  const [periodKey, setPeriodKey] = useState("2026-M08");
  const [pct, setPct] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) return null;

  async function doApply(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(pct);
    if (!Number.isFinite(value)) return;
    setBusy(true);
    setError(null);
    try {
      await apply({
        kpiAssignmentId: assignmentId,
        periodKey,
        overrideValue: value / 100,
        reason,
      });
      setPct("");
      setReason("");
    } catch (err) {
      setError(errorMessage(err, "Could not apply override."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-warning" /> Score adjustment (admin)
        </CardTitle>
        <CardDescription>
          For cases the deterministic engine cannot judge fairly — e.g. a quota KPI in a
          month where demand fell short. Requires a reason, notifies the employee, and is
          audit-logged. The adjustment persists until removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={doApply} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Period</span>
            <select
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {(periods ?? []).map((p) => (
                <option key={p.periodKey} value={p.periodKey}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Attainment %</span>
            <input
              type="number"
              required
              min={0}
              max={120}
              step="any"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="100"
              className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="min-w-[16rem] flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">
              Reason (required — emailed to the employee)
            </span>
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Only 10 projects arrived this month; all 10 captured — counted as target met."
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            Apply
          </Button>
        </form>
        {error && (
          <p className="text-sm text-critical" role="alert">
            {error}
          </p>
        )}

        {overrides && overrides.length > 0 && (
          <ul className="space-y-2">
            {overrides.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{o.periodKey}</Badge>
                    <span className="tabular text-muted-foreground">
                      {o.originalValue === null
                        ? "no data"
                        : formatPercent(o.originalValue)}
                    </span>
                    <span aria-hidden>→</span>
                    <span className="tabular font-semibold text-warning">
                      {formatPercent(o.overrideValue)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {o.reason} — {o.by},{" "}
                    {new Date(o.createdAt).toLocaleDateString("en-GB", {
                      timeZone: "Africa/Lagos",
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove override for ${o.periodKey}`}
                  title="Remove — the engine-computed value is restored"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-critical/10 hover:text-critical"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remove the ${o.periodKey} adjustment? The computed value returns.`,
                      )
                    )
                      return;
                    void remove({ overrideId: o.id as Id<"scoreOverrides"> });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
