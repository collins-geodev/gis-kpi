/**
 * Deterministic formatting + text helpers shared by UI, exports and reports.
 * No locale-dependent surprises: percentages come from decimals, identifiers
 * are preserved as text (leading zeros intact).
 */
import type { TargetType } from "./types";

/** Format a decimal ratio (0.2) as a percentage string ("20%"). */
export function formatPercent(
  decimal: number | null | undefined,
  fractionDigits = 0,
): string {
  if (decimal === null || decimal === undefined || Number.isNaN(decimal)) {
    return "—";
  }
  return `${(decimal * 100).toFixed(fractionDigits)}%`;
}

/** Format a plain number target/actual ("1", "4", "20"). */
export function formatNumber(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a target/actual value according to its canonical target type. */
export function formatTargetValue(
  value: number | null | undefined,
  targetType: TargetType,
  fractionDigits = 0,
): string {
  return targetType === "percentage"
    ? formatPercent(value, fractionDigits)
    : formatNumber(value, fractionDigits);
}

/** Split an honorific from a person's display name, if practical. */
const HONORIFICS = ["Mr.", "Mr", "Mrs.", "Mrs", "Ms.", "Ms", "Dr.", "Dr", "Miss"];

export function splitName(fullName: string): {
  honorific: string | null;
  displayName: string;
} {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  for (const h of HONORIFICS) {
    if (trimmed.startsWith(h + " ")) {
      return {
        honorific: h,
        displayName: trimmed.slice(h.length + 1).trim(),
      };
    }
  }
  return { honorific: null, displayName: trimmed };
}

/** Initials for avatars, from the searchable display name (no honorific). */
export function initials(fullName: string): string {
  const { displayName } = splitName(fullName);
  const parts = displayName.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Round to N decimal places deterministically (avoids fp display drift). */
export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Escape a value destined for a spreadsheet cell to defuse formula injection.
 * Any cell beginning with = + - @ (or tab/CR) is prefixed with a single quote.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

/** Collapse and trim user-authored whitespace without altering meaning. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
