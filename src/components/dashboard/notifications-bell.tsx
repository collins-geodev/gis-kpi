"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Topbar bell: unread badge with a soft pulse, dropdown feed, mark-read. */
export function NotificationsBell() {
  const data = useQuery(api.notifications.listMine);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const dismiss = useMutation(api.notifications.dismiss);
  const clearAll = useMutation(api.notifications.clearAll);
  const [open, setOpen] = useState(false);

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="glow-pulse absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-brand-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div
            className="fixed inset-0 z-30"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="shadow-lift absolute right-0 z-40 mt-2 w-80 animate-fade-in-up overflow-hidden rounded-xl border border-border bg-popover">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    onClick={() => void markAllRead({})}
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
                {(data?.items.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-critical hover:underline"
                    onClick={() => {
                      if (!window.confirm("Clear all notifications?")) return;
                      void clearAll({});
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear all
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data === undefined ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : data.items.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nothing yet — KPI updates, review decisions and approvals will appear
                  here.
                </p>
              ) : (
                <ul>
                  {data.items.map((n) => {
                    const inner = (
                      <>
                        <div className="flex items-start gap-2">
                          {n.readAt === null && (
                            <span
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                              aria-label="unread"
                            />
                          )}
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm ${n.readAt === null ? "font-semibold" : "font-medium"}`}
                            >
                              {n.title}
                            </div>
                            <div className="line-clamp-2 text-xs text-muted-foreground">
                              {n.body}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {new Date(n.createdAt).toLocaleString("en-GB", {
                                timeZone: "Africa/Lagos",
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </div>
                          </div>
                        </div>
                      </>
                    );
                    const onOpen = () => {
                      if (n.readAt === null) {
                        void markRead({
                          notificationId: n.id as Id<"notifications">,
                        });
                      }
                      setOpen(false);
                    };
                    return (
                      <li
                        key={n.id}
                        className="flex items-stretch border-b border-border/60 last:border-0"
                      >
                        {n.href ? (
                          <Link
                            href={n.href as never}
                            onClick={onOpen}
                            className="block min-w-0 flex-1 px-3 py-2.5 transition-colors hover:bg-muted/60"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={onOpen}
                            className="block min-w-0 flex-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                          >
                            {inner}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Dismiss notification “${n.title}”`}
                          title="Dismiss"
                          className="flex items-center px-2 text-muted-foreground transition-colors hover:bg-critical/10 hover:text-critical"
                          onClick={() =>
                            void dismiss({
                              notificationId: n.id as Id<"notifications">,
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
