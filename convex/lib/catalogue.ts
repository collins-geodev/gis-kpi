/**
 * Canonical role KPI catalogue (spec §5) + the objective→canonical classifier
 * and the text/location normalizers.
 *
 * The workbook rows are the source of truth; this catalogue is the *canonical*
 * layer the application uses after validation and admin approval. Weights,
 * targets, cadence and target types below mirror the 2026 baseline exactly —
 * imports still snapshot the verbatim source values, and any divergence raises
 * a data-quality issue (see dataQuality.ts). Nothing here silently overrides
 * source data.
 */
import type {
  CanonicalKpiKey,
  Direction,
  Frequency,
  JobRole,
  MeasurementMode,
  TargetType,
} from "./types";

export interface CanonicalKpiTemplate {
  key: CanonicalKpiKey;
  title: string;
  /** Cleaned objective wording (typos corrected). */
  canonicalObjective: string;
  /** Cleaned metric wording. */
  canonicalMetric: string;
  measurementMode: MeasurementMode;
  direction: Direction;
  targetType: TargetType;
  /** Decimal for percentages (0.2 => 20%); plain number otherwise. */
  target: number;
  unit: string;
  frequency: Frequency;
  /** Weight points as configured in the 2026 baseline for this role. */
  weight: number;
  evidenceRequired: boolean;
  /** Human description of the inputs a submission must supply. */
  requiredInputs: string[];
  scoringNotes: string;
  /** Qualitative — requires an approved rubric before final scoring. */
  needsRubric?: boolean;
  /** Requires business clarification before final scoring (surfaced in Data Quality). */
  needsClarification?: boolean;
}

export const CANONICAL_KPI_TITLES: Record<CanonicalKpiKey, string> = {
  deliverable_accuracy: "GIS deliverable accuracy and quality",
  asset_integration: "Full GIS network-asset data integration",
  tech_innovation: "Technology innovation for network efficiency and reliability",
  mentorship_training: "Technical and mentorship training",
  on_time_projects: "On-time completion of GIS projects",
  gdb_integrity: "Enterprise geodatabase integrity, security & performance",
  commercial_maintenance_quality:
    "GIS data quality during the Commercial maintenance window",
  capture_integrate: "Capture, process & integrate spatial/non-spatial data",
  qa_data_quality: "GIS data quality assurance",
  issue_resolution_24h: "Resolution of GIS technical issues within 24 hours",
};

// --- Reusable template fragments -------------------------------------------

const innovation = (weight: number): CanonicalKpiTemplate => ({
  key: "tech_innovation",
  title: CANONICAL_KPI_TITLES.tech_innovation,
  canonicalObjective:
    "Identify and implement one outstanding new technology to improve network efficiency and reliability.",
  canonicalMetric:
    "Approved innovation delivered with quantified or rubric-scored business impact (cost savings, reliability, efficiency, adoption, sustainability).",
  measurementMode: "rubric",
  direction: "higherIsBetter",
  targetType: "number",
  target: 1,
  unit: "innovation",
  frequency: "Annually",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "Innovation description & acceptance criteria",
    "Quantified business impact (or rubric dimensions)",
    "Approval evidence",
  ],
  scoringNotes:
    "Qualitative KPI scored against an admin-approved rubric; the LLM may summarise but never sets the score.",
  needsRubric: true,
});

const mentorship = (weight: number): CanonicalKpiTemplate => ({
  key: "mentorship_training",
  title: CANONICAL_KPI_TITLES.mentorship_training,
  canonicalObjective:
    "Provide technical and mentorship training to GIS Specialists and Analysts.",
  canonicalMetric:
    "Approved technical training or knowledge-sharing sessions (interpreted as one per quarter / four per year, pending admin confirmation).",
  measurementMode: "count",
  direction: "higherIsBetter",
  targetType: "number",
  target: 4,
  unit: "sessions",
  frequency: "Quarterly",
  weight,
  evidenceRequired: true,
  requiredInputs: ["Session date", "Attendance record", "Topic / materials"],
  scoringNotes: "Count of approved sessions vs 4/year (1 per quarter).",
  needsClarification: true,
});

const assetIntegration = (weight: number): CanonicalKpiTemplate => ({
  key: "asset_integration",
  title: CANONICAL_KPI_TITLES.asset_integration,
  canonicalObjective:
    "Full integration of GIS data to ensure 100% accuracy in capturing all IE network assets.",
  canonicalMetric: "Verified integrated assets / planned (eligible) assets.",
  measurementMode: "ratio",
  direction: "higherIsBetter",
  targetType: "percentage",
  target: 1,
  unit: "assets",
  frequency: "Monthly",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "Verified integrated asset count (numerator)",
    "Planned/eligible asset count (denominator)",
    "Integration evidence",
  ],
  scoringNotes:
    "Ratio numerator/denominator; aggregate counts, never average percentages.",
});

const onTimeProjects = (weight: number): CanonicalKpiTemplate => ({
  key: "on_time_projects",
  title: CANONICAL_KPI_TITLES.on_time_projects,
  canonicalObjective:
    "Complete 100% of GIS projects within agreed timelines to support organizational objectives.",
  canonicalMetric: "Projects completed on time / Total projects due × 100.",
  measurementMode: "ratio",
  direction: "higherIsBetter",
  targetType: "percentage",
  target: 1,
  unit: "projects",
  frequency: "Monthly",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "On-time completed projects (numerator)",
    "Total projects due (denominator)",
    "Project completion evidence",
  ],
  scoringNotes: "Ratio of on-time projects to total due.",
});

const issueResolution = (weight: number): CanonicalKpiTemplate => ({
  key: "issue_resolution_24h",
  title: CANONICAL_KPI_TITLES.issue_resolution_24h,
  canonicalObjective: "Resolve 100% of GIS technical issues within 24 hours.",
  canonicalMetric: "Issues resolved within 24 hours / Total eligible issues × 100.",
  measurementMode: "durationSla",
  direction: "higherIsBetter",
  targetType: "percentage",
  target: 1,
  unit: "issues",
  frequency: "Daily",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "Issues resolved within 24h (numerator)",
    "Total eligible issues (denominator)",
    "Ticket references",
  ],
  scoringNotes:
    "SLA ratio; aggregate eligible/within-threshold counts across the period.",
});

const qaDataQuality = (weight: number): CanonicalKpiTemplate => ({
  key: "qa_data_quality",
  title: CANONICAL_KPI_TITLES.qa_data_quality,
  canonicalObjective:
    "Perform quality assurance checks on all incoming and existing GIS data to ensure accuracy and completeness.",
  canonicalMetric:
    "Correct 100% of the data errors and inconsistencies identified during QA — errors corrected ÷ errors identified, at whatever volume the month brings.",
  measurementMode: "ratio",
  direction: "higherIsBetter",
  targetType: "percentage",
  target: 1,
  unit: "errors",
  frequency: "Monthly",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "Errors corrected (numerator)",
    "Errors identified (denominator)",
    "QA log evidence",
  ],
  scoringNotes:
    "Coverage ratio (corrected ÷ identified), target 100%. Replaces the workbook's fixed 20/month count so light and heavy months both score fairly — the month's actual volume is the denominator.",
});

const captureIntegrate = (weight: number): CanonicalKpiTemplate => ({
  key: "capture_integrate",
  title: CANONICAL_KPI_TITLES.capture_integrate,
  canonicalObjective:
    "Capture, process, and integrate spatial and non-spatial data from various sources into the GIS database.",
  canonicalMetric:
    "New validated data integrated within 2 business days / total new validated data received × 100.",
  measurementMode: "durationSla",
  direction: "higherIsBetter",
  targetType: "percentage",
  target: 1,
  unit: "datasets",
  frequency: "Weekly",
  weight,
  evidenceRequired: true,
  requiredInputs: [
    "Datasets integrated within 2 business days (numerator)",
    "Total new validated datasets received (denominator)",
    "Integration log",
  ],
  scoringNotes: "SLA ratio on a 2-business-day threshold (Africa/Lagos business days).",
});

// --- Role templates (weights mirror the 2026 baseline) ---------------------

export const ROLE_TEMPLATES: Record<JobRole, CanonicalKpiTemplate[]> = {
  "Geographic Information Systems Lead": [
    {
      key: "deliverable_accuracy",
      title: CANONICAL_KPI_TITLES.deliverable_accuracy,
      canonicalObjective:
        "Ensure the accuracy and quality of all GIS data and map products delivered by the team.",
      canonicalMetric:
        "Reduce identified errors in GIS deliverables by 20% versus the previous-year baseline.",
      measurementMode: "reduction",
      direction: "lowerIsBetter",
      targetType: "percentage",
      target: 0.2,
      unit: "errors",
      frequency: "Monthly",
      weight: 10,
      evidenceRequired: true,
      requiredInputs: [
        "Prior-year baseline error count",
        "Current error count",
        "Inspected deliverable count",
        "Approved QA evidence",
      ],
      scoringNotes:
        "Reduction = (baseline - current) / baseline; attainment vs 20% reduction target.",
    },
    assetIntegration(20),
    innovation(20),
    { ...mentorship(15) },
    onTimeProjects(15),
  ],

  "Geo Database Specialist": [
    {
      key: "gdb_integrity",
      title: CANONICAL_KPI_TITLES.gdb_integrity,
      canonicalObjective:
        "Ensure the integrity, security, and optimal performance of the enterprise geodatabase.",
      canonicalMetric:
        "Documented weekly database health checks completed, with zero unscheduled downtime due to database issues.",
      measurementMode: "composite",
      direction: "higherIsBetter",
      targetType: "percentage",
      target: 1,
      unit: "composite",
      frequency: "Weekly",
      weight: 20,
      evidenceRequired: true,
      requiredInputs: [
        "Health checks completed (numerator)",
        "Health checks scheduled (denominator)",
        "Unscheduled DB-caused downtime incidents (count)",
        "Health-check logs",
      ],
      scoringNotes:
        "Composite of health-check completion ratio and a zero-downtime condition, per an admin-approved composite rule.",
      needsClarification: true,
    },
    {
      ...mentorship(10),
      canonicalObjective: "Provide technical and mentorship training to GIS Analysts.",
    },
    {
      key: "commercial_maintenance_quality",
      title: CANONICAL_KPI_TITLES.commercial_maintenance_quality,
      canonicalObjective:
        "Ensure the accuracy and quality of all GIS data during the maintenance window with the Commercial department.",
      canonicalMetric:
        "Keep identified errors within a monthly error budget set 20% below the prior-year monthly baseline.",
      measurementMode: "count",
      direction: "lowerIsBetter",
      targetType: "number",
      target: 24,
      unit: "errors",
      frequency: "Monthly",
      weight: 10,
      evidenceRequired: true,
      requiredInputs: [
        "Errors found this month",
        "Maintenance-window QA evidence",
      ],
      scoringNotes:
        "Monthly error budget = prior-year monthly error baseline × 0.8 (the workbook's 'reduce by 20%' intent; source typed it Number/20). Attainment = budget ÷ errors found, capped at 100% — a smooth gradient instead of the reduction cliff. Admins set the real budget per assignment in KPI settings once the prior-year count is agreed.",
    },
    {
      ...assetIntegration(20),
      canonicalMetric:
        "Verified integrated assets / planned assets — source metric 'GDB Folders' requires a defined numerator, denominator, scope and evidence standard.",
      needsClarification: true,
    },
    {
      ...innovation(20),
      canonicalMetric:
        "Approved innovation (source metric 'GIS Project Dashboard') with acceptance criteria and a business-impact rubric.",
      needsClarification: true,
    },
  ],

  "Geographic Information Systems Specialist": [
    onTimeProjects(15),
    issueResolution(10),
    {
      ...mentorship(15),
      canonicalObjective: "Provide technical and mentorship training to GIS Analysts.",
    },
    assetIntegration(20),
    innovation(20),
  ],

  "Geographic Information Systems Analyst": [
    captureIntegrate(20),
    qaDataQuality(15),
    assetIntegration(10),
    issueResolution(15),
    innovation(20),
  ],
};

/** Weight distribution per role (mirrors the workbook; each totals 80). */
export const ROLE_WEIGHT_TOTALS: Record<JobRole, number> = Object.fromEntries(
  (Object.keys(ROLE_TEMPLATES) as JobRole[]).map((role) => [
    role,
    ROLE_TEMPLATES[role].reduce((sum, t) => sum + t.weight, 0),
  ]),
) as Record<JobRole, number>;

/**
 * Classify a source objective to its canonical KPI key.
 * Order matters — the geodatabase and commercial-maintenance objectives both
 * begin with "Ensure the accuracy and quality…", so the more specific matches
 * are checked first. Classification is driven by the OBJECTIVE, never the metric
 * (so a mis-copied metric, e.g. row 54, still maps to the right KPI while the
 * metric mismatch is raised separately).
 */
export function classifyCanonicalKey(objective: string): CanonicalKpiKey {
  const o = objective.toLowerCase();
  const has = (s: string) => o.includes(s);

  if (has("enterprise geodatabase") || has("integrity, security")) return "gdb_integrity";
  if (has("maitenance window") || has("maintenance window"))
    return "commercial_maintenance_quality";
  if (has("map products delivered")) return "deliverable_accuracy";
  if (has("capture, process, and integrate spatial")) return "capture_integrate";
  if (has("quality assurance checks on all incoming")) return "qa_data_quality";
  if (has("full integration of gis data")) return "asset_integration";
  if (has("resolve 100% of gis technical issues within 24"))
    return "issue_resolution_24h";
  if (has("identifies and implement one") || has("new technolog"))
    return "tech_innovation";
  if (has("technical and mentorship training")) return "mentorship_training";
  if (has("complete 100% of gis projects")) return "on_time_projects";

  throw new Error(`Unclassifiable objective: ${JSON.stringify(objective)}`);
}

/** Fetch the canonical template for a (role, key) pair, if defined. */
export function getTemplate(
  role: JobRole,
  key: CanonicalKpiKey,
): CanonicalKpiTemplate | undefined {
  return ROLE_TEMPLATES[role]?.find((t) => t.key === key);
}

// --- Canonicalisation of free text + locations -----------------------------

/**
 * Correct only the obvious typographical variants named in the spec, in the
 * CANONICAL text layer. The source text is preserved verbatim elsewhere; every
 * change surfaces as an admin-approvable data-quality proposal.
 */
export function canonicalizeText(input: string): string {
  let t = input;
  t = t.replace(/ /g, " "); // nbsp -> space
  t = t.replace(/"{2,}/g, '"'); // collapse doubled quotes
  t = t.replace(/^["']+|["']+$/g, ""); // strip surrounding stray quotes
  t = t.replace(/oustanding/gi, "outstanding");
  t = t.replace(/Archieved/gi, "Achieved");
  t = t.replace(/maitenance/gi, "maintenance");
  t = t.replace(/time timelines/gi, "timelines");
  t = t.replace(/assets\.ts/gi, "assets");
  // Unify inconsistent "within 24" / "24 hrs" / "24hrs" / "24 hours" wording.
  t = t.replace(/within\s+24(\s*(hours|hrs|hr))?/gi, "within 24 hours");
  t = t.replace(/24\s*hrs\b/gi, "24 hours");
  t = t.replace(/\.{2,}/g, "."); // duplicated periods
  t = t.replace(/\s+([.,;:])/g, "$1"); // space before punctuation
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

const LOCATION_CANONICAL: Record<string, string> = {
  "Akowonjo BU": "Akowonjo B/U",
};

/** Propose a canonical location label (preserve source elsewhere). */
export function canonicalizeLocation(input: string): string {
  const trimmed = input.replace(/\s+/g, " ").trim();
  return LOCATION_CANONICAL[trimmed] ?? trimmed;
}
