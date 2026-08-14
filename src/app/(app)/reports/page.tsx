"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
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
import { FileSpreadsheet, FileText } from "lucide-react";

export default function ReportsPage() {
  const periods = useQuery(api.activities.periods);
  const [periodKey, setPeriodKey] = useState("2026");
  const [withAi, setWithAi] = useState(false);

  const q = encodeURIComponent(periodKey);
  const xlsxHref = `/api/reports/xlsx?scope=team&periodKey=${q}`;
  const pdfHref = `/api/reports/pdf?scope=team&periodKey=${q}${withAi ? "&ai=1" : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Exports"
        description="Generate management-grade exports. Numbers always come from the scoring engine — the AI narrative only explains them, with a disclaimer and human-approval status."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team report</CardTitle>
          <CardDescription>
            Multi-sheet workbook: Executive Summary, Team Scorecard, Individual KPI
            Detail, Activity &amp; Evidence Registers, Data Quality Issues, and KPI
            Definitions &amp; Methodology — with a visible 80/100 weight note.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Period</span>
            <select
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {(periods ?? [{ periodKey: "2026", label: "2026", grain: "year" }]).map(
                (p) => (
                  <option key={p.periodKey} value={p.periodKey}>
                    {p.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withAi}
              onChange={(e) => setWithAi(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              Include AI narrative in PDF{" "}
              <Badge variant="muted">requires AI_GATEWAY_API_KEY</Badge>
            </span>
          </label>

          <div className="flex flex-wrap gap-3">
            <Button asChild variant="brand">
              <a href={xlsxHref} download>
                <FileSpreadsheet className="h-4 w-4" /> Export Excel (.xlsx)
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={pdfHref} download>
                <FileText className="h-4 w-4" /> Export PDF
              </a>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Exports are scope-checked server-side (Node runtime) and reflect your
            authorized employees only. Identifiers are preserved as text and cells are
            formula-injection safe.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
