import { ComingSoon } from "@/components/coming-soon";

export default function KpiSettingsPage() {
  return (
    <ComingSoon
      title="KPI Settings"
      description="Versioned KPI definitions and assignments, thresholds, the reporting calendar and evidence rules."
      planned={[
        "Role templates, per-employee/location overrides, effective dates",
        "Targets, weights, scoring formulas, score/stretch caps, direction",
        "Weight-completeness workflow to resolve the missing 20 points",
        "Admin-editable status threshold table (On-target/Watch/At-risk/Critical)",
        "Copy a role template to a new performance year; version history",
      ]}
    />
  );
}
