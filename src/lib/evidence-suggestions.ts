/**
 * Deterministic evidence title/category suggestions per canonical KPI — so the
 * attach form starts with a meaningful description of what the evidence should
 * show, instead of a blank box. Always editable by the user.
 */
export interface EvidenceSuggestion {
  title: string;
  category: string;
}

const BY_KEY: Record<string, EvidenceSuggestion> = {
  asset_integration: {
    title: "Asset integration batch report",
    category: "batch_report",
  },
  deliverable_accuracy: {
    title: "Deliverable accuracy QA check",
    category: "qa_report",
  },
  tech_innovation: {
    title: "New technology implementation evidence",
    category: "innovation_evidence",
  },
  mentorship_training: {
    title: "Training attendance sheet & materials",
    category: "training_record",
  },
  on_time_projects: {
    title: "Project completion summary (timelines)",
    category: "project_report",
  },
  gdb_integrity: {
    title: "Geodatabase integrity check output",
    category: "system_report",
  },
  commercial_maintenance_quality: {
    title: "Commercial maintenance quality report",
    category: "maintenance_report",
  },
  capture_integrate: {
    title: "Capture & integration log",
    category: "batch_report",
  },
  qa_data_quality: {
    title: "Data quality audit report",
    category: "qa_report",
  },
  issue_resolution_24h: {
    title: "Issue resolution ticket log (24h SLA)",
    category: "ticket_log",
  },
};

const ACTIVITY_TITLES: Record<string, string> = {
  asset_integration: "Asset integration batch",
  deliverable_accuracy: "Deliverable accuracy QA",
  tech_innovation: "New technology implementation",
  mentorship_training: "Training session delivered",
  on_time_projects: "Projects delivered on time",
  gdb_integrity: "Geodatabase integrity check",
  commercial_maintenance_quality: "Commercial maintenance QA",
  capture_integrate: "Data capture & integration",
  qa_data_quality: "Data quality audit",
  issue_resolution_24h: "Issue resolution log",
};

/** Auto title for an activity capture, e.g. "Asset integration batch — August 2026". */
export function suggestActivityTitle(
  canonicalKey: string | undefined,
  objective: string | undefined,
  periodLabel: string,
): string {
  const stem =
    (canonicalKey && ACTIVITY_TITLES[canonicalKey]) ||
    (objective ?? "").split(/[.;]/)[0]?.trim().slice(0, 60) ||
    "KPI activity";
  return `${stem} — ${periodLabel}`;
}

export function suggestEvidence(
  canonicalKey?: string,
  objective?: string,
): EvidenceSuggestion {
  if (canonicalKey && BY_KEY[canonicalKey]) return BY_KEY[canonicalKey]!;
  const stem = (objective ?? "").split(/[.;]/)[0]?.trim().slice(0, 80);
  return {
    title: stem ? `Evidence — ${stem}` : "",
    category: "supporting_document",
  };
}
