"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import type { AppRole } from "@convex/lib/types";

export default function AuditPage() {
  const me = useQuery(api.access.currentUser);
  const roles = (me?.roles ?? []) as AppRole[];
  const canView = roles.some((r) => ["auditor", "system_admin"].includes(r));
  const logs = usePaginatedQuery(api.audit.list, canView ? {} : "skip", {
    initialNumItems: 30,
  });

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!canView)
    return <AccessDenied message="Audit access is restricted to auditors and admins." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Immutable record of configuration, imports, submissions, reviews, approvals, overrides, report generation, downloads and deletions."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.results.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(l.at).toLocaleString("en-GB", {
                      timeZone: "Africa/Lagos",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">{l.actor ?? "system"}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{l.action}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {l.entityType}
                  </TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">
                    {l.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {logs.status === "LoadingFirstPage" && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          )}
          {logs.status === "CanLoadMore" && (
            <div className="p-4 text-center">
              <Button variant="outline" onClick={() => logs.loadMore(30)}>
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
