"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, visibleTo } from "./nav-config";
import type { AppRole } from "@convex/lib/types";

export function Sidebar() {
  const pathname = usePathname();
  const me = useQuery(api.access.currentUser);
  const roles: AppRole[] = (me?.roles ?? []) as AppRole[];

  return (
    <aside className="bg-geo-grid sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <MapPinned className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">GIS KPI</p>
          <p className="text-xs text-muted-foreground">Performance Dashboard</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {NAV.map((group) => {
          const items = group.items.filter((i) => visibleTo(i, roles));
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="mb-5">
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href as never}
                        className={cn(
                          "hover-wiggle flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all",
                          active
                            ? "bg-accent/15 font-medium text-accent shadow-[inset_2px_0_0_hsl(var(--accent))]"
                            : "text-muted-foreground hover:translate-x-0.5 hover:bg-muted hover:text-foreground",
                        )}
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
