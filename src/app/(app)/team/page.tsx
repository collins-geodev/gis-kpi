"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";
import { periodLabel } from "@convex/lib/format";

export default function TeamPage() {
  const [period, setPeriod] = useState<string>("");
  const data = useQuery(api.employees.listScoped, period ? { periodKey: period } : {});
  const [role, setRole] = useState<string>("all");
  const [location, setLocation] = useState<string>("all");

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const roles = useMemo(
    () => Array.from(new Set(rows.map((e) => e.jobRole))).sort(),
    [rows],
  );
  const locations = useMemo(
    () => Array.from(new Set(rows.map((e) => e.canonicalLocation))).sort(),
    [rows],
  );

  const filtered = rows
    .filter(
      (e) =>
        (role === "all" || e.jobRole === role) &&
        (location === "all" || e.canonicalLocation === location),
    )
    // Highest due-to-date score first; ties fall back to the roster order.
    .sort((a, b) => b.duePct - a.duePct || a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Performance"
        description="Role-based scorecards for the GIS Team. The headline is the due-to-date score: points earned against only the weight due by the selected month (quarterly/annual KPIs join at their deadline or as soon as they're measured). Year position shows the same points against the full 100."
      />

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Month</span>
          <select
            value={period || (data?.periodKey ?? "")}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Select a month"
          >
            {(data?.availableMonths ?? []).map((k) => (
              <option key={k} value={k}>
                {periodLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <FilterSelect label="Role" value={role} onChange={setRole} options={roles} />
        <FilterSelect
          label="Location"
          value={location}
          onChange={setLocation}
          options={locations}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {data === undefined ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No employees in scope"
              description="You may not have access to any employees, or none match the current filters."
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Job role</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Score · due to date</TableHead>
                  <TableHead className="text-right">Year position</TableHead>
                  <TableHead className="text-right">On measured</TableHead>
                  <TableHead className="text-right">Configured weight</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/employees/${e.id}` as never}
                        className="font-medium text-accent hover:underline"
                      >
                        {e.honorific ? `${e.honorific} ` : ""}
                        {e.displayName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{e.employeeId}</div>
                    </TableCell>
                    <TableCell className="text-sm">{e.jobRole}</TableCell>
                    <TableCell className="text-sm">{e.canonicalLocation}</TableCell>
                    <TableCell className="tabular text-right">
                      <span className="font-medium">{e.duePct.toFixed(1)}%</span>
                      <div className="text-xs text-muted-foreground">
                        {e.dueEarned.toFixed(1)} / {e.dueWeight} pts due
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {e.overallPct.toFixed(1)}%
                      <div className="text-xs text-muted-foreground">
                        {e.pointsEarned.toFixed(1)} / {e.configuredWeight} pts
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {e.scoreOnMeasured === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${e.scoreOnMeasured.toFixed(1)}%`
                      )}
                      <div className="text-xs text-muted-foreground">
                        {e.itemsWithData} of {e.kpiCount} KPIs
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={e.configuredWeight === 100 ? "success" : "brand"}>
                        {e.configuredWeight} / 100
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.itemsWithData > 0 ? "watch" : "no_data"} />
                    </TableCell>
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="all">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
