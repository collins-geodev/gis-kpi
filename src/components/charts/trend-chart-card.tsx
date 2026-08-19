"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Table2, TrendingUp } from "lucide-react";

export interface TrendChartPoint {
  periodKey: string;
  label: string;
  score: number;
  evidence: number;
  employees: number;
}

/**
 * Approved-score trend from frozen snapshots (average across employees, with
 * sample size). Renders a dormant explainer until at least two periods exist —
 * a single approved period is a number, not a trend.
 */
export function TrendChartCard({
  title,
  description,
  data,
}: {
  title: string;
  description?: string;
  data: TrendChartPoint[];
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <Card className="card-lift sheen">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="icon-chip">
              <TrendingUp className="h-4 w-4" />
            </span>
            {title}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {data.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTable((s) => !s)}
            aria-pressed={showTable}
          >
            <Table2 className="h-4 w-4" />
            {showTable ? "Chart" : "Data"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {data.length < 2 && !showTable ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {data.length === 0
              ? "The trend appears once periods are approved — approved scores are frozen as snapshots, and each approved period becomes a point on this line."
              : `One period approved so far (${data[0]!.label}: ${data[0]!.score}% across ${data[0]!.employees} employee${data[0]!.employees === 1 ? "" : "s"}). A second approved period starts the trend line.`}
          </p>
        ) : showTable ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Avg score</TableHead>
                <TableHead className="text-right">Evidence</TableHead>
                <TableHead className="text-right">Employees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.periodKey}>
                  <TableCell>{d.label}</TableCell>
                  <TableCell className="tabular text-right">{d.score}%</TableCell>
                  <TableCell className="tabular text-right">{d.evidence}%</TableCell>
                  <TableCell className="tabular text-right">{d.employees}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div
            role="img"
            aria-label={`${title}: ${data.map((d) => `${d.label} ${d.score}% (${d.employees} employees)`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="trendScoreFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--cat-1))" stopOpacity={0.32} />
                    <stop
                      offset="100%"
                      stopColor="hsl(var(--cat-1))"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  unit="%"
                  width={44}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{
                    stroke: "hsl(var(--muted-foreground))",
                    strokeDasharray: "3 3",
                  }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                  formatter={(value, name) => [
                    `${value}%`,
                    name === "score" ? "Avg approved score" : "Evidence completeness",
                  ]}
                  labelFormatter={(label, payload) => {
                    const first = payload?.[0]?.payload as TrendChartPoint | undefined;
                    const n = first?.employees;
                    return n
                      ? `${label} · ${n} employee${n === 1 ? "" : "s"}`
                      : String(label);
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--cat-1))"
                  strokeWidth={2.5}
                  fill="url(#trendScoreFill)"
                  dot={{ r: 3, fill: "hsl(var(--cat-1))" }}
                  activeDot={{ r: 5 }}
                  isAnimationActive
                />
                <Area
                  type="monotone"
                  dataKey="evidence"
                  stroke="hsl(var(--cat-3))"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  fill="transparent"
                  dot={false}
                  isAnimationActive
                />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-1 flex justify-center gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded"
                  style={{ background: "hsl(var(--cat-1))" }}
                  aria-hidden
                />
                Avg approved score
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0 w-4 border-t-2 border-dashed"
                  style={{ borderColor: "hsl(var(--cat-3))" }}
                  aria-hidden
                />
                Evidence completeness
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
