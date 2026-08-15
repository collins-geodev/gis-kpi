"use client";

import { useEffect, useState } from "react";

const R = 40;
const CIRC = 2 * Math.PI * R;
const ARC = CIRC * 0.75; // 270° gauge

/** Animated 270° radial gauge for a 0–100% value. */
export function RadialGauge({
  label,
  pct,
  colorVar = "--chart-1",
}: {
  label: string;
  /** 0–100 (already rounded), or null for no data. */
  pct: number | null;
  colorVar?: string;
}) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const value = pct ?? 0;
  const filled = drawn ? (Math.min(Math.max(value, 0), 100) / 100) * ARC : 0;

  return (
    <div
      className="flex flex-col items-center gap-1"
      role="img"
      aria-label={`${label}: ${pct === null ? "no data" : `${value}%`}`}
    >
      <div className="relative">
        <svg width="110" height="110" viewBox="0 0 100 100" aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${ARC} ${CIRC}`}
            transform="rotate(135 50 50)"
          />
          <circle
            className="donut-seg"
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={`hsl(var(${colorVar}))`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRC}`}
            transform="rotate(135 50 50)"
            style={{ filter: `drop-shadow(0 0 6px hsl(var(${colorVar}) / 0.5))` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tabular text-lg font-bold">
            {pct === null ? "—" : `${value}%`}
          </span>
        </div>
      </div>
      <span className="max-w-[9rem] text-center text-xs text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
