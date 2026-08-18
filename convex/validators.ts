/**
 * Reusable Convex validators for the domain literal unions.
 * Kept in sync with convex/lib/types.ts. Every public function validates its
 * args and return shapes against these.
 */
import { v } from "convex/values";

export const vAppRole = v.union(
  v.literal("system_admin"),
  v.literal("kpi_admin"),
  v.literal("manager"),
  v.literal("reviewer"),
  v.literal("employee"),
  v.literal("executive_viewer"),
  v.literal("auditor"),
);

export const vMeasurementMode = v.union(
  v.literal("ratio"),
  v.literal("count"),
  v.literal("reduction"),
  v.literal("durationSla"),
  v.literal("milestone"),
  v.literal("binary"),
  v.literal("rubric"),
  v.literal("composite"),
);

export const vDirection = v.union(
  v.literal("higherIsBetter"),
  v.literal("lowerIsBetter"),
);

export const vTargetType = v.union(v.literal("percentage"), v.literal("number"));

export const vFrequency = v.union(
  v.literal("Daily"),
  v.literal("Weekly"),
  v.literal("Monthly"),
  v.literal("Quarterly"),
  v.literal("Annually"),
);

export const vKpiStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("retired"),
);

export const vWorkflowState = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("needs_changes"),
  v.literal("verified"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("locked"),
  v.literal("reopened"),
);

export const vStatusBand = v.union(
  v.literal("on_target"),
  v.literal("watch"),
  v.literal("at_risk"),
  v.literal("critical"),
  v.literal("no_data"),
);

export const vDqSeverity = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("blocker"),
);

export const vDqStatus = v.union(
  v.literal("open"),
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("resolved"),
);

export const vDqCategory = v.union(
  v.literal("weight_incomplete"),
  v.literal("missing_frequency"),
  v.literal("typo_normalization"),
  v.literal("location_variant"),
  v.literal("percentage_encoding"),
  v.literal("metric_ambiguous"),
  v.literal("metric_mismatch"),
  v.literal("metric_truncated"),
  v.literal("unit_mismatch"),
  v.literal("rubric_required"),
);

export const vJobState = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const vReportScope = v.union(
  v.literal("individual"),
  v.literal("team"),
  v.literal("role"),
  v.literal("location"),
);

export const vPeriodGrain = v.union(
  v.literal("day"),
  v.literal("week"),
  v.literal("month"),
  v.literal("quarter"),
  v.literal("year"),
);

export const vConfidentiality = v.union(
  v.literal("internal"),
  v.literal("restricted"),
  v.literal("confidential"),
);

export const vCanonicalKpiKey = v.union(
  v.literal("deliverable_accuracy"),
  v.literal("asset_integration"),
  v.literal("tech_innovation"),
  v.literal("mentorship_training"),
  v.literal("on_time_projects"),
  v.literal("gdb_integrity"),
  v.literal("commercial_maintenance_quality"),
  v.literal("capture_integrate"),
  v.literal("qa_data_quality"),
  v.literal("issue_resolution_24h"),
  v.literal("safety_hazard_reporting"),
  v.literal("compliance_recertification"),
  v.literal("internal_customer_satisfaction"),
  v.literal("training_hours"),
);

export const vKpiCategory = v.union(v.literal("core"), v.literal("non_core"));
