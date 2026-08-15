"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/dashboard/notifications-bell";
import { APP_ROLE_LABELS, type AppRole } from "@convex/lib/types";
import { initials } from "@convex/lib/format";

export function Topbar() {
  const me = useQuery(api.access.currentUser);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const display = me?.name ?? me?.email ?? "";

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true); // instant feedback — spinner appears on click
    try {
      await signOut();
    } finally {
      // Navigate immediately instead of waiting for the reactive teardown.
      router.push("/signin");
    }
  }

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
        <NotificationsBell />
        <ThemeToggle />
        <Link
          href={"/profile" as never}
          className="glow-pulse flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-accent/40 bg-accent/15 text-xs font-semibold text-accent transition-transform hover:scale-110"
          title="My profile"
          aria-label="Open my profile"
        >
          {me?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(display || "?")
          )}
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="hover-wiggle"
          disabled={signingOut}
          onClick={handleSignOut}
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {signingOut ? "Signing out…" : "Sign out"}
          </span>
        </Button>
      </div>
    </header>
  );
}
