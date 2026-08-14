"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Table2 } from "lucide-react";

export interface ChartDatum {
  label: string;
  value: number;
}

/** Horizontal bar chart with a keyboard-accessible table alternative. */
export function BarChartCard({
  title,
  description,
  data,
  colorVar = "--chart-1",
}: {
  title: string;
  description?: string;
  data: ChartDatum[];
  colorVar?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const color = `hsl(var(${colorVar}))`;
  const height = Math.max(120, data.length * 34 + 24);

  return (
    <Card>
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
        ) : data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <div
            role="img"
            aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height={height}>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={180}
                  tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "hsl(var(--popover-foreground))",
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
                  {data.map((_, i) => (
                    <Cell key={i} fill={color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
