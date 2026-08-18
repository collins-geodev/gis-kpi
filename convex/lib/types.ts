/**
 * Shared domain vocabulary for the GIS KPI Dashboard.
 * Pure types + literal unions — no Convex imports — so this module is safe to
 * import from Convex functions, the Next.js UI, and the Vitest test suite alike.
 */

/** How a KPI's raw inputs are turned into an attainment ratio. */
export const MEASUREMENT_MODES = [
  "ratio", // numerator / denominator
  "count", // actual count vs target count
  "reduction", // (baseline - current) / baseline
  "durationSla", // items completed within a time threshold / eligible items
  "milestone", // approved milestones / planned milestones
  "binary", // pass/fail
  "rubric", // reviewer-approved qualitative dimensions
  "composite", // weighted blend of validated sub-measures
] as const;
export type MeasurementMode = (typeof MEASUREMENT_MODES)[number];

/** Direction of improvement — stored on the definition, never inferred at runtime. */
export const DIRECTIONS = ["higherIsBetter", "lowerIsBetter"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Canonical target type (percentages stored as decimals: 0.2 => 20%). */
export const TARGET_TYPES = ["percentage", "number"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** Source-workbook target-type spelling (preserved verbatim). */
export type SourceTargetTypeLabel = "Percentage" | "Number";

/** Tracking cadence. */
export const FREQUENCIES = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Annually",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** KPI definition / assignment lifecycle. */
export const KPI_STATUSES = ["draft", "active", "retired"] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];

/** Application permission roles — kept strictly separate from employee job roles. */
export const APP_ROLES = [
  "system_admin",
  "kpi_admin",
  "manager",
  "reviewer",
  "employee",
  "executive_viewer",
  "auditor",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  system_admin: "System Admin",
  kpi_admin: "GIS Team Admin / KPI Admin",
  manager: "GIS Lead / Manager",
  reviewer: "Reviewer",
  employee: "Employee",
  executive_viewer: "Executive Viewer",
  auditor: "Auditor",
};

/** The four job-role categories present in the 2026 baseline. */
export const JOB_ROLES = [
  "Geographic Information Systems Lead",
  "Geo Database Specialist",
  "Geographic Information Systems Specialist",
  "Geographic Information Systems Analyst",
] as const;
export type JobRole = (typeof JOB_ROLES)[number];

/** Stable canonical KPI identity, independent of role and row order. */
export const CANONICAL_KPI_KEYS = [
  "deliverable_accuracy",
  "asset_integration",
  "tech_innovation",
  "mentorship_training",
  "on_time_projects",
  "gdb_integrity",
  "commercial_maintenance_quality",
  "capture_integrate",
  "qa_data_quality",
  "issue_resolution_24h",
  // Non-core (the 20 points shared by every role in the 2025 workbook).
  "safety_hazard_reporting",
  "compliance_recertification",
  "internal_customer_satisfaction",
  "training_hours",
] as const;
export type CanonicalKpiKey = (typeof CANONICAL_KPI_KEYS)[number];

/**
 * Core KPIs carry the role's 80 configured points; non-core KPIs carry the
 * shared 20 corporate points that complete the 100.
 */
export const KPI_CATEGORIES = ["core", "non_core"] as const;
export type KpiCategory = (typeof KPI_CATEGORIES)[number];

/** Activity / evidence / period workflow states. */
export const WORKFLOW_STATES = [
  "draft",
  "submitted",
  "needs_changes",
  "verified",
  "approved",
  "rejected",
  "locked",
  "reopened",
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** Status band for a computed score/attainment (admin-editable thresholds). */
export const STATUS_BANDS = [
  "on_target",
  "watch",
  "at_risk",
  "critical",
  "no_data",
] as const;
export type StatusBand = (typeof STATUS_BANDS)[number];

export const STATUS_BAND_LABELS: Record<StatusBand, string> = {
  on_target: "On/Above Target",
  watch: "Watch",
  at_risk: "At Risk",
  critical: "Critical",
  no_data: "No Data",
};

/** Data-quality issue lifecycle + severity. */
export const DQ_SEVERITIES = ["info", "warning", "blocker"] as const;
export type DataQualitySeverity = (typeof DQ_SEVERITIES)[number];

export const DQ_STATUSES = [
  "open", // needs admin review
  "proposed", // a canonical value is proposed, awaiting approval
  "approved", // proposal accepted
  "rejected", // proposal declined, source retained
  "resolved", // otherwise handled
] as const;
export type DataQualityStatus = (typeof DQ_STATUSES)[number];

export const DQ_CATEGORIES = [
  "weight_incomplete", // employee weights total 80, not 100
  "missing_frequency", // blank cadence
  "typo_normalization", // canonical text differs from source
  "location_variant", // Akowonjo BU vs Akowonjo B/U
  "percentage_encoding", // decimal <-> percentage display
  "metric_ambiguous", // GDB Folders, GIS Project Dashboard, etc.
  "metric_mismatch", // wrong metric copied onto an objective
  "metric_truncated", // truncated text
  "unit_mismatch", // "reduce by 20%" typed as Number 20
  "rubric_required", // qualitative innovation needs an approval rubric
] as const;
export type DataQualityCategory = (typeof DQ_CATEGORIES)[number];

/** Report generation job lifecycle. */
export const JOB_STATES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const REPORT_SCOPES = ["individual", "team", "role", "location"] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export const PERIOD_GRAINS = ["day", "week", "month", "quarter", "year"] as const;
export type PeriodGrain = (typeof PERIOD_GRAINS)[number];

/** Confidentiality classification for evidence. */
export const CONFIDENTIALITY_LEVELS = ["internal", "restricted", "confidential"] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];

export const PERFORMANCE_TIMEZONE = "Africa/Lagos" as const;
export const BASELINE_PERFORMANCE_YEAR = 2026 as const;
export const CONFIGURED_WEIGHT_TOTAL = 80 as const;
export const FULL_WEIGHT_TOTAL = 100 as const;
