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
