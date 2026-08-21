/**
 * Report dataset — the frozen, scope-checked payload the deterministic PDF and
 * Excel builders render. Numbers come from the scoring engine; the AI narrative
 * (when present) only explains them. Percentages are decimals (0.2 = 20%).
 */
export interface ReportMeta {
  title: string;
  scope: "individual" | "team" | "role" | "location";
  scopeRef: string;
  scopeLabel: string;
  periodKey: string;
  periodLabel: string;
  year: number;
  timezone: string;
  configuredWeightTotal: number;
  fullWeightTotal: number;
  normalizationEnabled: boolean;
  reportVersion: number;
}

export interface ReportEmployeeRow {
  employeeId: string;
  name: string;
  jobRole: string;
  location: string;
  configuredWeight: number;
  assignedWeightScore: number;
  normalizedScore: number;
  /** Score against only the weight due by the report period. */
  duePct: number;
  dueEarned: number;
  dueWeight: number;
  itemsWithData: number;
  kpiCount: number;
}

export interface ReportKpiRow {
  employeeId: string;
  employeeName: string;
  objective: string;
  metric: string;
  weight: number;
  target: number;
  targetType: "percentage" | "number";
  frequency: string;
  measurementMode: string;
  cappedAttainment: number | null;
  weightedContribution: number;
  status: string;
  scoringBlocked: boolean;
  sourceRowNumber: number;
}

export interface ReportDqRow {
  category: string;
  severity: string;
  status: string;
  sourceRowNumber: number | null;
  employeeName: string | null;
  field: string | null;
  sourceValue: string | null;
  proposedValue: string | null;
  reason: string;
  blocksScoring: boolean;
}

export interface ReportActivityRow {
  employeeName: string;
  objective: string;
  periodKey: string;
  title: string;
  activityAt: number;
  status: string;
}

export interface ReportEvidenceRow {
  employeeName: string;
  objective: string;
  title: string;
  category: string;
  reviewStatus: string;
  confidentiality: string;
  uploadedAt: number;
}

export interface ReportDefinitionRow {
  role: string;
  title: string;
  canonicalObjective: string;
  canonicalMetric: string;
  measurementMode: string;
  direction: string;
  targetType: string;
  defaultTarget: number;
  frequency: string;
  defaultWeight: number;
  scoringNotes: string;
}

export interface ReportDataset {
  meta: ReportMeta;
  executiveSummary: {
    employees: number;
    assignments: number;
    scoringBlocked: number;
    dqOpen: number;
    dqBlockers: number;
    weightWarning: string;
  };
  employees: ReportEmployeeRow[];
  kpis: ReportKpiRow[];
  activities: ReportActivityRow[];
  evidence: ReportEvidenceRow[];
  dataQualityIssues: ReportDqRow[];
  definitions: ReportDefinitionRow[];
}
