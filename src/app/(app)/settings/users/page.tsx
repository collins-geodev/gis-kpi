"use client";

import { useQuery, useMutation } from "convex/react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import { APP_ROLES, APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";

export default function UsersPage() {
  const me = useQuery(api.access.currentUser);
  const isAdmin = (me?.roles ?? []).includes("system_admin");
  const users = useQuery(api.users.listAppUsers, isAdmin ? {} : "skip");
  const roster = useQuery(api.users.listRosterForLinking, isAdmin ? {} : "skip");
  const grantRole = useMutation(api.access.grantRole);
  const linkEmployee = useMutation(api.access.linkUserToEmployee);

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!isAdmin) return <AccessDenied message="Only a System Admin can manage users." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Organization"
        description="Application roles are separate from employee job roles. Grant access and link accounts to roster employees for self-service scope."
      />

      <Card>
        <CardContent className="p-0">
          {users === undefined ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>App roles</TableHead>
                  <TableHead>Linked employee</TableHead>
                  <TableHead>Grant role</TableHead>
                  <TableHead>Link employee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name ?? u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          u.roles.map((r) => (
                            <Badge key={r} variant="muted">
                              {APP_ROLE_LABELS[r as AppRole]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {u.employee ? (
                        <span>
                          {u.employee.displayName}
                          <span className="block text-xs text-muted-foreground">
                            {u.employee.jobRole}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <select
                        defaultValue=""
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        onChange={async (e) => {
                          const role = e.target.value as AppRole;
                          if (!role) return;
                          await grantRole({ userId: u.id as Id<"users">, role });
                          e.currentTarget.value = "";
                        }}
                      >
                        <option value="">+ role…</option>
                        {APP_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {APP_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <select
                        defaultValue={u.employee ? "linked" : ""}
                        className="h-8 max-w-[10rem] rounded-md border border-input bg-background px-2 text-xs"
                        onChange={async (e) => {
                          const empId = e.target.value;
                          if (!empId || empId === "linked") return;
                          await linkEmployee({
                            userId: u.id as Id<"users">,
                            employeeId: empId as Id<"employees">,
                          });
                        }}
                      >
                        <option value="">+ link…</option>
                        {(roster ?? []).map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.displayName} ({emp.employeeId})
                          </option>
                        ))}
                      </select>
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
