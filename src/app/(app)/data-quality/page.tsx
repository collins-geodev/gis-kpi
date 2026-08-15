"use client";

import { useState } from "react";
import { usePaginatedQuery, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import { DQ_CATEGORIES, DQ_STATUSES, type AppRole } from "@convex/lib/types";
import { CheckCheck } from "lucide-react";

const SEVERITY_VARIANT = {
  info: "info",
  warning: "warning",
  blocker: "critical",
} as const;

export default function DataQualityPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) => ["system_admin", "kpi_admin", "auditor"].includes(r));
  const canResolve = roles.some((r) => ["system_admin", "kpi_admin"].includes(r));

  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");

  const summary = useQuery(api.dataQuality.summary, canView ? {} : "skip");
  const issues = usePaginatedQuery(
    api.dataQuality.listIssues,
    canView
      ? {
          status: status === "all" ? undefined : (status as never),
          category: category === "all" ? undefined : (category as never),
        }
      : "skip",
    { initialNumItems: 25 },
  );

  const resolve = useMutation(api.dataQuality.resolveIssue);
  const reopen = useMutation(api.dataQuality.reopenIssue);
  const bulkResolve = useMutation(api.dataQuality.bulkResolve);
  const [bulkBusy, setBulkBusy] = useState(false);

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canView) return <AccessDenied />;

  async function act(
    id: Id<"dataQualityIssues">,
    decision: "approve" | "reject" | "resolve",
  ) {
    let note: string | undefined;
    if (decision === "reject") {
      note = window.prompt("Reason for rejecting this proposal (required):") ?? undefined;
      if (!note) return;
    }
    await resolve({ issueId: id, decision, note });
  }

  async function approveAll() {
    const label = category === "all" ? "all categories" : category.replace(/_/g, " ");
    if (
      !window.confirm(
        `Approve every open proposal in ${label}? Each proposed canonical value is applied and affected KPIs are unblocked. Items without a proposal (e.g. weight completeness) are skipped.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await bulkResolve({
        category: category === "all" ? undefined : (category as never),
        decision: "approve",
        note: "Bulk approved from the Data Quality queue",
      });
      window.alert(
        `Approved ${res.resolved} issue(s)` +
          (res.skipped ? `; skipped ${res.skipped} without a proposed value.` : "."),
      );
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Quality & Imports"
        description="Every workbook normalization and anomaly is an admin-approvable issue. Nothing is silently corrected; resolving a blocking issue can unblock KPI scoring."
      />

      {summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total issues" value={summary.total} />
          <Stat label="Open / outstanding" value={summary.open} />
          <Stat label="Blocking scoring" value={summary.blockers} tone="warning" />
          <Stat
            label="Resolved"
            value={
              (summary.byStatus.approved ?? 0) +
              (summary.byStatus.rejected ?? 0) +
              (summary.byStatus.resolved ?? 0)
            }
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={[...DQ_STATUSES]}
          />
          <Select
            label="Category"
            value={category}
            onChange={setCategory}
            options={[...DQ_CATEGORIES]}
          />
        </div>
        {canResolve && (
          <Button variant="brand" onClick={approveAll} disabled={bulkBusy}>
            <CheckCheck className="h-4 w-4" />
            {category === "all"
              ? "Approve all proposals"
              : `Approve all ${category.replace(/_/g, " ")}`}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Row / Employee</TableHead>
                <TableHead>Proposal</TableHead>
                <TableHead>Status</TableHead>
                {canResolve && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.results.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[i.severity]}>{i.severity}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{i.category.replace(/_/g, " ")}</div>
                    <div className="max-w-md text-xs text-muted-foreground">
                      {i.reason}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.sourceRowNumber ? `Row ${i.sourceRowNumber}` : "—"}
                    {i.employeeName && (
                      <div className="text-xs text-muted-foreground">
                        {i.employeeName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-sm">
                    {i.proposedValue !== null ? (
                      <span className="text-success">→ {String(i.proposedValue)}</span>
                    ) : (
                      <span className="text-muted-foreground">needs decision</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.blocksScoring ? "critical" : "muted"}>
                      {i.status}
                    </Badge>
                  </TableCell>
                  {canResolve && (
                    <TableCell className="text-right">
                      {["approved", "rejected", "resolved"].includes(i.status) ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">done</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-warning"
                            title="Undo this decision — the issue returns to open (re-blocks scoring if it was a blocker)"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  "Reopen this issue? It returns to the open queue and re-blocks scoring if it was a blocker.",
                                )
                              )
                                return;
                              void reopen({ issueId: i.id });
                            }}
                          >
                            Reopen
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          {i.proposedValue !== null && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act(i.id, "approve")}
                            >
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => act(i.id, "resolve")}
                          >
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => act(i.id, "reject")}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {issues.status === "LoadingFirstPage" && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}
          {issues.status === "CanLoadMore" && (
            <div className="p-4 text-center">
              <Button variant="outline" onClick={() => issues.loadMore(25)}>
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={tone === "warning" ? "border-warning/40" : undefined}>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="tabular mt-1.5 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Select({
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
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
