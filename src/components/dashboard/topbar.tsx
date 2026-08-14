"use client";

import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";

export function Topbar() {
  const me = useQuery(api.access.currentUser);
  const { signOut } = useAuthActions();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">
          GIS Unit · Technical Services
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">· FY2026</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-1 md:flex">
          {(me?.roles ?? []).slice(0, 3).map((r) => (
            <Badge key={r} variant="muted">
              {APP_ROLE_LABELS[r as AppRole]}
            </Badge>
          ))}
        </div>
        <ThemeToggle />
        {me?.email && (
          <span className="hidden text-sm text-muted-foreground lg:inline">
            {me.email}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
