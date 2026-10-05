"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDeadline } from "@convex/lib/format";
import { cn } from "@/lib/utils";

export interface PeriodDeadlineInfo {
  periodKey: string;
  label: string;
  startAt: number;
  dueAt: number;
  evidenceDueAt: number;
  cadenceGrace: boolean;
}

function Deadline({ label, at, now }: { label: string; at: number; now: number }) {
  const passed = now > at;
  return (
    <span className={cn("whitespace-nowrap", passed && "text-warning")}>
      {label} <strong className="font-medium">{formatDeadline(at)}</strong>
      {passed && " (passed)"}
    </span>
  );
}

/** "Entries due 4 Oct 2026, 23:59 · Evidence due 5 Oct 2026, 23:59" for one period. */
export function PeriodDeadlines({
  period,
  className,
}: {
  period: PeriodDeadlineInfo;
  className?: string;
}) {
  const now = Date.now();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <Deadline label="Entries due" at={period.dueAt} now={now} />
      <span aria-hidden>·</span>
      <Deadline label="Evidence due" at={period.evidenceDueAt} now={now} />
      {period.cadenceGrace && <span>· grace period: nothing is marked late</span>}
    </div>
  );
}

/**
 * The deadlines that still matter right now: every started period with an
 * entry or evidence deadline not yet passed, soonest first.
 */
export function UpcomingDeadlines({ max = 4 }: { max?: number }) {
  const periods = useQuery(api.activities.periods);
  if (!periods) return null;
  const now = Date.now();
  const open = periods
    .filter((p) => p.startAt <= now && Math.max(p.dueAt, p.evidenceDueAt) >= now)
    .sort(
      (a, b) =>
        Math.min(...[a.dueAt, a.evidenceDueAt].filter((t) => t >= now)) -
        Math.min(...[b.dueAt, b.evidenceDueAt].filter((t) => t >= now)),
    )
    .slice(0, max);
  if (open.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" /> Submission deadlines
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.map((p) => (
          <div key={p.periodKey} className="flex flex-wrap items-baseline gap-x-3">
            <span className="w-28 shrink-0 text-sm font-medium">{p.label}</span>
            <PeriodDeadlines period={p} />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Evidence only counts for the period it is tagged with. Late uploads still count
          but are flagged to your reviewer. All times are Lagos time.
        </p>
      </CardContent>
    </Card>
  );
}
