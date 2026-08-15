"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Table2 } from "lucide-react";
import type { ChartDatum } from "./bar-chart-card";

const R = 42;
const CIRC = 2 * Math.PI * R;
const COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
];

/** Animated SVG donut with legend + accessible table alternative. */
export function DonutChartCard({
  title,
  description,
  data,
  centerLabel,
}: {
  title: string;
  description?: string;
  data: ChartDatum[];
  centerLabel?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = data.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  const segments = data.map((d, i) => {
    const frac = total === 0 ? 0 : d.value / total;
    const seg = {
      ...d,
      frac,
      start: offset,
      colorVar: COLOR_VARS[i % COLOR_VARS.length]!,
    };
    offset += frac;
    return seg;
  });

  return (
    <Card className="card-lift sheen">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
        >
          <Table2 className="h-4 w-4" />
          {showTable ? "Chart" : "Data"}
        </Button>
      </CardHeader>
      <CardContent>
        {showTable ? (
          <Table>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.label}>
                  <TableCell className="text-sm">{d.label}</TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {d.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div
            className="flex flex-wrap items-center justify-center gap-6"
            role="img"
            aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
          >
            <div className="relative">
              <svg width="150" height="150" viewBox="0 0 110 110" aria-hidden>
                <circle
                  cx="55"
                  cy="55"
                  r={R}
                  fill="none"
                  stroke="hsl(var(--muted))"
                  strokeWidth="13"
                />
                {segments.map((s) => (
                  <circle
                    key={s.label}
                    className="donut-seg"
                    cx="55"
                    cy="55"
                    r={R}
                    fill="none"
                    stroke={`hsl(var(${s.colorVar}))`}
                    strokeWidth="13"
                    strokeLinecap="butt"
                    strokeDasharray={
                      drawn ? `${Math.max(s.frac * CIRC - 1.5, 0)} ${CIRC}` : `0 ${CIRC}`
                    }
                    strokeDashoffset={-s.start * CIRC}
                    transform="rotate(-90 55 55)"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-2xl font-bold">{total}</span>
                {centerLabel && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {centerLabel}
                  </span>
                )}
              </div>
            </div>
            <ul className="space-y-1.5 text-sm">
              {segments.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: `hsl(var(${s.colorVar}))` }}
                    aria-hidden
                  />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="tabular font-medium">
                    {s.value}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({Math.round(s.frac * 100)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
