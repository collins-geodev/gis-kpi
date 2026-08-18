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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/access-denied";
import { APP_ROLES, APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";
import { Link2Off, RotateCcw, Trash2, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { useState } from "react";

export default function UsersPage() {
  const me = useQuery(api.access.currentUser);
  const isAdmin = (me?.roles ?? []).includes("system_admin");
  const users = useQuery(api.users.listAppUsers, isAdmin ? {} : "skip");
  const roster = useQuery(api.users.listRosterForLinking, isAdmin ? {} : "skip");
  const grantRole = useMutation(api.access.grantRole);
  const linkEmployee = useMutation(api.access.linkUserToEmployee);
  const unlinkEmployee = useMutation(api.access.unlinkUserFromEmployee);
  const revokeRole = useMutation(api.access.revokeRole);
  const setUserActive = useMutation(api.access.setUserActive);
  const resetUserData = useMutation(api.access.resetUserData);
  const deleteUser = useMutation(api.access.deleteUser);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed.");
    }
  };

  if (me === undefined) return <Skeleton className="h-64" />;
  if (!isAdmin) return <AccessDenied message="Only a System Admin can manage users." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Organization"
        description="Application roles are separate from employee job roles. Grant access and link accounts to roster employees for self-service scope."
      />

      {actionError && (
        <p
          className="rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-sm text-critical"
          role="alert"
        >
          {actionError}
        </p>
      )}

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
                  <TableHead>Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className={u.isActive ? undefined : "opacity-60"}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {u.name ?? u.email}
                        {!u.isActive && <Badge variant="muted">deactivated</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          u.roles.map((r) => (
                            <Badge key={r} variant="muted" className="gap-1 pr-1">
                              {APP_ROLE_LABELS[r as AppRole]}
                              <button
                                type="button"
                                aria-label={`Revoke ${APP_ROLE_LABELS[r as AppRole]} from ${u.name ?? u.email}`}
                                title="Revoke role"
                                className="rounded-full p-0.5 hover:bg-critical/15 hover:text-critical"
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Revoke "${APP_ROLE_LABELS[r as AppRole]}" from ${u.name ?? u.email}?`,
                                    )
                                  )
                                    return;
                                  void run(() =>
                                    revokeRole({
                                      userId: u.id as Id<"users">,
                                      role: r as AppRole,
                                    }),
                                  );
                                }}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {u.employee ? (
                        <span className="flex items-center gap-1.5">
                          <span>
                            {u.employee.displayName}
                            <span className="block text-xs text-muted-foreground">
                              {u.employee.jobRole}
                            </span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Unlink ${u.employee.displayName} from ${u.name ?? u.email}`}
                            title="Unlink employee"
                            className="rounded-md p-1 text-muted-foreground hover:bg-critical/15 hover:text-critical"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Unlink ${u.employee!.displayName} from ${u.name ?? u.email}?\n\nAll of ${u.employee!.displayName}'s captured data — submissions, evidence files, measurements and score snapshots — is deleted from the records and dashboards. The account keeps its roles; KPI configuration and the audit trail are untouched.`,
                                )
                              )
                                return;
                              void run(() =>
                                unlinkEmployee({ userId: u.id as Id<"users"> }),
                              );
                            }}
                          >
                            <Link2Off className="h-3.5 w-3.5" />
                          </button>
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
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={
                          u.isActive
                            ? "text-muted-foreground hover:text-critical"
                            : "text-muted-foreground hover:text-success"
                        }
                        disabled={u.id === me?.userId && u.isActive}
                        title={
                          u.id === me?.userId && u.isActive
                            ? "You cannot deactivate your own account"
                            : u.isActive
                              ? "Deactivate account"
                              : "Reactivate account"
                        }
                        onClick={() => {
                          const verb = u.isActive ? "Deactivate" : "Reactivate";
                          if (!window.confirm(`${verb} ${u.name ?? u.email}?`)) return;
                          void run(() =>
                            setUserActive({
                              userId: u.id as Id<"users">,
                              isActive: !u.isActive,
                            }),
                          );
                        }}
                      >
                        {u.isActive ? (
                          <>
                            <UserRoundX className="h-4 w-4" /> Deactivate
                          </>
                        ) : (
                          <>
                            <UserRoundCheck className="h-4 w-4" /> Reactivate
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-warning"
                        title="Delete every KPI activity, evidence item, measurement and score this account's employee has captured — KPI configuration stays"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Reset all captured data for ${u.name ?? u.email}? Their activities, evidence, measurements and scores are permanently deleted (KPI configuration is kept). This cannot be undone.`,
                            )
                          )
                            return;
                          void run(() => resetUserData({ userId: u.id as Id<"users"> }));
                        }}
                      >
                        <RotateCcw className="h-4 w-4" /> Reset data
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-critical"
                        disabled={u.id === me?.userId}
                        title={
                          u.id === me?.userId
                            ? "You cannot delete your own account"
                            : "Permanently delete this account"
                        }
                        onClick={() => {
                          const typed = window.prompt(
                            `Permanently delete the account ${u.email ?? u.name}?\n\nType DELETE to confirm. (Their captured KPI data will ALSO be wiped.)`,
                          );
                          if (typed !== "DELETE") return;
                          void run(() =>
                            deleteUser({
                              userId: u.id as Id<"users">,
                              alsoResetData: true,
                            }),
                          );
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
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
