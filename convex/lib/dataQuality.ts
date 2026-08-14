/**
 * Deterministic data-quality detection over the verbatim workbook rows.
 * Every normalization or anomaly named in the spec is surfaced here as an
 * admin-approvable issue — nothing is silently corrected. Seeding uses `code`
 * for idempotency so re-running the import never duplicates issues.
 */
import {
  canonicalizeLocation,
  canonicalizeText,
  classifyCanonicalKey,
} from "./catalogue";
import { normalizeWhitespace } from "./format";
import { SOURCE_ROWS, type WorkbookSourceRow } from "./sourceRows";
import {
  CONFIGURED_WEIGHT_TOTAL,
  FULL_WEIGHT_TOTAL,
  type CanonicalKpiKey,
  type DataQualityCategory,
  type DataQualitySeverity,
  type DataQualityStatus,
} from "./types";

export interface SeedDataQualityIssue {
  /** Stable identity for idempotent seeding. */
  code: string;
  category: DataQualityCategory;
  severity: DataQualitySeverity;
  initialStatus: DataQualityStatus;
  employeeId?: string;
  sourceRowNumber?: number;
  canonicalKey?: CanonicalKpiKey;
  field?: string;
  sourceValue?: string | number | null;
  proposedValue?: string | number | null;
  reason: string;
  /** True when this must be resolved before an official score can be approved. */
  blocksScoring: boolean;
}

function issueCode(parts: (string | number | undefined)[]): string {
  return parts.filter((p) => p !== undefined && p !== "").join(":");
}

/** Compute the exact data-quality issue set for the 2026 baseline. */
export function detectDataQualityIssues(
  rows: readonly WorkbookSourceRow[] = SOURCE_ROWS,
): SeedDataQualityIssue[] {
  const issues: SeedDataQualityIssue[] = [];

  // --- Per-employee weight completeness (80 / 100) -------------------------
  const weightByEmp = new Map<string, number>();
  const nameByEmp = new Map<string, string>();
  for (const r of rows) {
    weightByEmp.set(
      r.sourceEmployeeId,
      (weightByEmp.get(r.sourceEmployeeId) ?? 0) + r.sourceWeight,
    );
    nameByEmp.set(r.sourceEmployeeId, r.sourceEmployeeName);
  }
  for (const [employeeId, total] of weightByEmp) {
    if (total !== FULL_WEIGHT_TOTAL) {
      issues.push({
        code: issueCode(["weight_incomplete", employeeId]),
        category: "weight_incomplete",
        severity: "warning",
        initialStatus: "open",
        employeeId,
        field: "weight",
        sourceValue: total,
        proposedValue: null,
        reason: `Configured weights total ${total} / ${FULL_WEIGHT_TOTAL} for ${nameByEmp.get(
          employeeId,
        )}. Resolve by adding a KPI, changing weights, or explicitly approving normalization.`,
        blocksScoring: false,
      });
    }
  }

  // --- Per-row anomalies ---------------------------------------------------
  for (const r of rows) {
    const key = classifyCanonicalKey(r.sourceObjective);
    const rn = r.sourceRowNumber;

    // Missing frequency (row 32).
    if (r.sourceFrequency === null || r.sourceFrequency === undefined) {
      issues.push({
        code: issueCode(["missing_frequency", rn]),
        category: "missing_frequency",
        severity: "blocker",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "frequency",
        sourceValue: null,
        proposedValue: "Monthly",
        reason:
          "Frequency of Tracking is blank. Proposed 'Monthly' based on the matching analyst QA template — requires admin approval.",
        blocksScoring: true,
      });
    }

    // Location variant (Akowonjo BU -> Akowonjo B/U).
    const canonLoc = canonicalizeLocation(r.sourceLocation);
    if (canonLoc !== normalizeWhitespace(r.sourceLocation)) {
      issues.push({
        code: issueCode(["location_variant", rn]),
        category: "location_variant",
        severity: "info",
        initialStatus: "proposed",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        field: "location",
        sourceValue: r.sourceLocation,
        proposedValue: canonLoc,
        reason: `Location '${r.sourceLocation}' normalized to canonical '${canonLoc}'.`,
        blocksScoring: false,
      });
    }

    // Typographical normalization (objective / metric).
    for (const field of ["objective", "metric"] as const) {
      const raw = field === "objective" ? r.sourceObjective : r.sourceMetric;
      const canon = canonicalizeText(raw);
      if (canon !== normalizeWhitespace(raw)) {
        issues.push({
          code: issueCode(["typo_normalization", rn, field]),
          category: "typo_normalization",
          severity: "info",
          initialStatus: "proposed",
          employeeId: r.sourceEmployeeId,
          sourceRowNumber: rn,
          canonicalKey: key,
          field,
          sourceValue: raw,
          proposedValue: canon,
          reason: `Proposed canonical ${field} text (typo/quote/wording normalization).`,
          blocksScoring: false,
        });
      }
    }

    // Ambiguous metrics needing business clarification.
    const metricTrim = normalizeWhitespace(r.sourceMetric);
    if (metricTrim === "GDB Folders" || metricTrim === "GIS Project Dashboard") {
      issues.push({
        code: issueCode(["metric_ambiguous", rn]),
        category: "metric_ambiguous",
        severity: "warning",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "metric",
        sourceValue: r.sourceMetric,
        proposedValue: null,
        reason: `Metric '${metricTrim}' is underspecified. Define numerator, denominator, scope and evidence standard before scoring.`,
        blocksScoring: true,
      });
    }

    // Composite rule needs definition (Geo DB integrity).
    if (key === "gdb_integrity") {
      issues.push({
        code: issueCode(["metric_ambiguous", rn, "composite"]),
        category: "metric_ambiguous",
        severity: "warning",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "metric",
        sourceValue: r.sourceMetric,
        proposedValue: null,
        reason:
          "Composite KPI: model weekly health-check completion and zero unscheduled downtime as separate inputs under an admin-approved composite rule.",
        blocksScoring: true,
      });
    }

    // Metric mismatch — wrong metric copied onto an innovation objective (row 54).
    if (
      key === "tech_innovation" &&
      /2 business days|integrate 100% of new data/i.test(r.sourceMetric)
    ) {
      issues.push({
        code: issueCode(["metric_mismatch", rn]),
        category: "metric_mismatch",
        severity: "warning",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "metric",
        sourceValue: r.sourceMetric,
        proposedValue:
          "Approved innovation delivered with quantified or rubric-scored business impact.",
        reason:
          "Innovation objective carries the two-business-day integration metric by mistake. Replace with the correct innovation metric.",
        blocksScoring: true,
      });
    }

    // Metric truncated (row 30 innovation).
    if (
      key === "tech_innovation" &&
      /enhancing the overall$/i.test(normalizeWhitespace(r.sourceMetric))
    ) {
      issues.push({
        code: issueCode(["metric_truncated", rn]),
        category: "metric_truncated",
        severity: "warning",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "metric",
        sourceValue: r.sourceMetric,
        proposedValue:
          "The contribution influences both quantitative and qualitative value, leading to cost savings and enhancing the overall impact on the business.",
        reason: "Metric text is truncated. Restore the full intended wording.",
        blocksScoring: true,
      });
    }

    // Unit mismatch — "reduce by 20%" typed as Number/20 (row 16).
    if (key === "commercial_maintenance_quality" && r.sourceTargetType === "Number") {
      issues.push({
        code: issueCode(["unit_mismatch", rn]),
        category: "unit_mismatch",
        severity: "blocker",
        initialStatus: "open",
        employeeId: r.sourceEmployeeId,
        sourceRowNumber: rn,
        canonicalKey: key,
        field: "targetType",
        sourceValue: `Number / ${r.sourceTarget}`,
        proposedValue: "Percentage / 0.2 (20% reduction)",
        reason:
          "Metric reads 'reduce errors by 20%' but is typed Number with target 20. Resolve the target type before final scoring.",
        blocksScoring: true,
      });
    }
  }

  // --- Rubric requirement for qualitative innovation (KPI-definition level) --
  issues.push({
    code: issueCode(["rubric_required", "tech_innovation"]),
    category: "rubric_required",
    severity: "info",
    initialStatus: "open",
    canonicalKey: "tech_innovation",
    reason:
      "Technology-innovation KPIs are qualitative. Define and approve a business-impact rubric (cost savings, reliability, efficiency, adoption, sustainability) before final scoring.",
    blocksScoring: true,
  });

  return issues;
}

/** Summary counts for the reconciliation screen. */
export function dataQualitySummary(rows: readonly WorkbookSourceRow[] = SOURCE_ROWS) {
  const issues = detectDataQualityIssues(rows);
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const i of issues) {
    byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }
  return {
    total: issues.length,
    byCategory,
    bySeverity,
    blockers: issues.filter((i) => i.blocksScoring).length,
    configuredWeightTotal: CONFIGURED_WEIGHT_TOTAL,
    fullWeightTotal: FULL_WEIGHT_TOTAL,
  };
}
