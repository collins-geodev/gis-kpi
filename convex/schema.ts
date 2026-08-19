import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  vAppRole,
  vCanonicalKpiKey,
  vConfidentiality,
  vDirection,
  vDqCategory,
  vDqSeverity,
  vDqStatus,
  vFrequency,
  vJobState,
  vKpiCategory,
  vKpiStatus,
  vMeasurementMode,
  vPeriodGrain,
  vReportScope,
  vStatusBand,
  vTargetType,
  vWorkflowState,
} from "./validators";

/**
 * Convex schema for the GIS KPI Dashboard.
 *
 * Design notes:
 *  - Application permissions (userRoleAssignments) are strictly separate from
 *    employee job roles (employees.jobRole).
 *  - kpiAssignments store immutable *snapshots* of the objective/metric/weight/
 *    target/frequency/scoring rules plus the verbatim source values for audit.
 *  - Percentages are stored as decimals everywhere (0.2 == 20%).
 *  - Every large table is indexed for its common access path; queries paginate.
 */
export default defineSchema({
  // Convex Auth tables (authAccounts, authSessions, etc.).
  ...authTables,

  // Auth user — overrides authTables.users to add app-specific fields.
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** Links this login to a roster employee (self-service scope). */
    employeeId: v.optional(v.id("employees")),
    /** Profile photo captured/uploaded in-app (Convex storage). */
    avatarStorageId: v.optional(v.id("_storage")),
    isActive: v.optional(v.boolean()),
    lastSeenAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("by_employee", ["employeeId"]),

  // --- Organization structure ---------------------------------------------
  organizations: defineTable({
    name: v.string(),
    shortName: v.optional(v.string()),
  }).index("by_name", ["name"]),

  departments: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(), // "Technical Services"
  }).index("by_org", ["organizationId"]),

  units: defineTable({
    departmentId: v.id("departments"),
    name: v.string(), // "Technical Services"
  }).index("by_department", ["departmentId"]),

  teams: defineTable({
    unitId: v.id("units"),
    name: v.string(), // "GIS Unit" / "GIS Team" — modelled separately from labels
    slug: v.string(),
  }).index("by_unit", ["unitId"]),

  locations: defineTable({
    /** Canonical label, e.g. "Akowonjo B/U". */
    name: v.string(),
    /** Distinct source spellings observed (e.g. ["Akowonjo BU", "Akowonjo B/U"]). */
    sourceVariants: v.array(v.string()),
    isActive: v.boolean(),
  }).index("by_name", ["name"]),

  // --- People --------------------------------------------------------------
  jobRoles: defineTable({
    title: v.string(), // exact workbook job title
    /** Editable HR augmentations — NOT invented grades; default null. */
    grade: v.optional(v.string()),
    roleLevel: v.optional(v.number()),
    displayOrder: v.number(),
  }).index("by_title", ["title"]),

  employees: defineTable({
    employeeId: v.string(), // "IKD030835" business key (kept as text)
    fullName: v.string(), // "Mr Timothy Olutayo Olugbenro"
    honorific: v.optional(v.string()),
    displayName: v.string(), // searchable name without honorific
    jobRole: v.string(), // exact title
    jobRoleId: v.optional(v.id("jobRoles")),
    teamId: v.optional(v.id("teams")),
    /** Canonical location + verbatim source location. */
    locationId: v.optional(v.id("locations")),
    sourceLocation: v.string(),
    canonicalLocation: v.string(),
    managerId: v.optional(v.id("employees")),
    displayOrder: v.number(),
    isActive: v.boolean(),
    deactivatedAt: v.optional(v.number()),
  })
    .index("by_employeeId", ["employeeId"])
    .index("by_jobRole", ["jobRole"])
    .index("by_location", ["canonicalLocation"])
    .index("by_manager", ["managerId"]),

  // --- Access control ------------------------------------------------------
  userRoleAssignments: defineTable({
    userId: v.id("users"),
    role: vAppRole,
    /** Optional scope narrowing for reviewers/managers. */
    scopeLocationId: v.optional(v.id("locations")),
    scopeJobRole: v.optional(v.string()),
    scopeEmployeeIds: v.optional(v.array(v.id("employees"))),
    grantedByUserId: v.optional(v.id("users")),
    grantedAt: v.number(),
    isActive: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_role", ["role"]),

  // --- Calendar ------------------------------------------------------------
  performanceYears: defineTable({
    year: v.number(), // 2026
    timezone: v.string(), // "Africa/Lagos"
    status: v.union(v.literal("open"), v.literal("closed")),
    /** Whether 80->100 normalization display is explicitly enabled. */
    normalizationEnabled: v.boolean(),
    officialAttainmentCap: v.number(), // decimal, default 1.0
    /**
     * Epoch ms (Africa/Lagos) from which KPI capture is open. Periods that end
     * before this moment — and activity dates before it — are read-only.
     * Unset = capture open for the whole year.
     */
    captureStartAt: v.optional(v.number()),
    stretchAttainmentCap: v.number(), // decimal, default 1.2
  }).index("by_year", ["year"]),

  trackingPeriods: defineTable({
    performanceYearId: v.id("performanceYears"),
    grain: vPeriodGrain,
    /** Canonical key e.g. "2026-M03", "2026-Q1", "2026-W12", "2026-01-15", "2026". */
    periodKey: v.string(),
    label: v.string(),
    startAt: v.number(), // epoch ms, Africa/Lagos-aware boundaries
    endAt: v.number(),
    dueAt: v.number(),
    status: v.union(
      v.literal("upcoming"),
      v.literal("open"),
      v.literal("grace"),
      v.literal("closed"),
      v.literal("locked"),
    ),
  })
    .index("by_year_grain", ["performanceYearId", "grain"])
    .index("by_periodKey", ["periodKey"])
    .index("by_status_due", ["status", "dueAt"]),

  // --- KPI configuration ---------------------------------------------------
  kpiDefinitions: defineTable({
    canonicalKey: vCanonicalKpiKey,
    jobRole: v.string(), // role template this definition belongs to
    title: v.string(),
    canonicalObjective: v.string(),
    canonicalMetric: v.string(),
    measurementMode: vMeasurementMode,
    direction: vDirection,
    targetType: vTargetType,
    defaultTarget: v.number(),
    unit: v.string(),
    frequency: vFrequency,
    defaultWeight: v.number(),
    evidenceRequired: v.boolean(),
    needsRubric: v.boolean(),
    needsClarification: v.boolean(),
    scoringNotes: v.string(),
    /** core carries the role's 80 points; non_core the shared corporate 20. */
    kpiCategory: v.optional(vKpiCategory),
    status: vKpiStatus,
    currentVersion: v.number(),
    ownerUserId: v.optional(v.id("users")),
  })
    .index("by_role_key", ["jobRole", "canonicalKey"])
    .index("by_status", ["status"]),

  kpiDefinitionVersions: defineTable({
    kpiDefinitionId: v.id("kpiDefinitions"),
    version: v.number(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    snapshot: v.any(), // frozen definition payload
    changedByUserId: v.optional(v.id("users")),
    changeReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_definition", ["kpiDefinitionId", "version"]),

  kpiAssignments: defineTable({
    performanceYearId: v.id("performanceYears"),
    employeeId: v.id("employees"),
    kpiDefinitionId: v.optional(v.id("kpiDefinitions")),
    canonicalKey: vCanonicalKpiKey,

    // Immutable snapshot (canonical layer) at assignment time.
    objective: v.string(),
    metric: v.string(),
    weight: v.number(),
    target: v.number(), // decimal for %
    targetType: vTargetType,
    frequency: vFrequency,
    measurementMode: vMeasurementMode,
    direction: vDirection,
    scoreCap: v.number(),
    stretchCap: v.number(),
    evidenceRequired: v.boolean(),
    /**
     * Admin-pinned baseline for reduction-mode KPIs: when set, employees only
     * enter the current value — the server injects this reference figure.
     */
    pinnedBaseline: v.optional(v.number()),

    // Verbatim source layer (audit).
    sourceRowNumber: v.number(),
    sourceObjective: v.string(),
    sourceMetric: v.string(),
    sourceWeight: v.number(),
    sourceTarget: v.number(),
    sourceTargetType: v.string(),
    sourceFrequency: v.union(v.string(), v.null()),

    status: vKpiStatus,
    /** core carries the role's 80 points; non_core the shared corporate 20. */
    kpiCategory: v.optional(vKpiCategory),
    /** True until every blocking data-quality issue for this row is resolved. */
    scoringBlocked: v.boolean(),
    displayOrder: v.number(),
    reviewerUserId: v.optional(v.id("users")),
    approverUserId: v.optional(v.id("users")),
    importBatchId: v.optional(v.id("importBatches")),
    createdAt: v.number(),
  })
    .index("by_employee_year", ["employeeId", "performanceYearId"])
    .index("by_year_key", ["performanceYearId", "canonicalKey"])
    .index("by_reviewer", ["reviewerUserId"])
    .index("by_importBatch_row", ["importBatchId", "sourceRowNumber"]),

  // --- Activities & measurements ------------------------------------------
  activities: defineTable({
    employeeId: v.id("employees"),
    kpiAssignmentId: v.id("kpiAssignments"),
    trackingPeriodId: v.optional(v.id("trackingPeriods")),
    periodKey: v.string(),
    activityAt: v.number(),
    title: v.string(),
    description: v.string(),
    // Raw measurement inputs (mode-dependent; unused fields omitted).
    quantity: v.optional(v.number()),
    numerator: v.optional(v.number()),
    denominator: v.optional(v.number()),
    baseline: v.optional(v.number()),
    currentValue: v.optional(v.number()),
    withinThreshold: v.optional(v.number()),
    eligible: v.optional(v.number()),
    completed: v.optional(v.number()),
    planned: v.optional(v.number()),
    pass: v.optional(v.boolean()),
    score: v.optional(v.number()),
    maxScore: v.optional(v.number()),
    durationHours: v.optional(v.number()),
    projectRef: v.optional(v.string()),
    ticketRef: v.optional(v.string()),
    assetRef: v.optional(v.string()),
    sourceSystem: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    status: vWorkflowState,
    createdByUserId: v.id("users"),
    updatedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employee_period", ["employeeId", "periodKey"])
    .index("by_assignment_period", ["kpiAssignmentId", "periodKey"])
    .index("by_status", ["status"]),

  kpiMeasurements: defineTable({
    kpiAssignmentId: v.id("kpiAssignments"),
    employeeId: v.id("employees"),
    trackingPeriodId: v.optional(v.id("trackingPeriods")),
    periodKey: v.string(),
    measurementMode: vMeasurementMode,
    // Aggregated inputs and computed results (deterministic engine output).
    inputs: v.any(),
    rawActual: v.union(v.number(), v.null()),
    target: v.number(),
    attainment: v.union(v.number(), v.null()),
    cappedAttainment: v.union(v.number(), v.null()),
    weightedContribution: v.number(),
    status: vStatusBand,
    hasData: v.boolean(),
    evidenceComplete: v.boolean(),
    cadenceCompliant: v.boolean(),
    isProvisional: v.boolean(),
    computedAt: v.number(),
    calcVersion: v.string(),
  })
    .index("by_assignment_period", ["kpiAssignmentId", "periodKey"])
    .index("by_employee_period", ["employeeId", "periodKey"]),

  // --- Evidence ------------------------------------------------------------
  evidenceFiles: defineTable({
    employeeId: v.id("employees"),
    kpiAssignmentId: v.optional(v.id("kpiAssignments")),
    activityId: v.optional(v.id("activities")),
    periodKey: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    externalUrl: v.optional(v.string()),
    originalFilename: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
    checksum: v.optional(v.string()),
    category: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    activityAt: v.optional(v.number()),
    projectRef: v.optional(v.string()),
    ticketRef: v.optional(v.string()),
    assetRef: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    uploadedByUserId: v.id("users"),
    uploadedAt: v.number(),
    version: v.number(),
    confidentiality: vConfidentiality,
    reviewStatus: vWorkflowState,
    reviewerComments: v.optional(v.string()),
    retentionState: v.union(
      v.literal("active"),
      v.literal("legal_hold"),
      v.literal("scheduled_deletion"),
      v.literal("deleted"),
    ),
    scanStatus: v.optional(
      v.union(v.literal("pending"), v.literal("clean"), v.literal("flagged")),
    ),
  })
    .index("by_assignment", ["kpiAssignmentId"])
    .index("by_activity", ["activityId"])
    .index("by_employee_period", ["employeeId", "periodKey"])
    .index("by_reviewStatus", ["reviewStatus"]),

  evidenceLinks: defineTable({
    evidenceFileId: v.id("evidenceFiles"),
    kpiAssignmentId: v.id("kpiAssignments"),
    activityId: v.optional(v.id("activities")),
    linkedByUserId: v.id("users"),
    linkedAt: v.number(),
  })
    .index("by_evidence", ["evidenceFileId"])
    .index("by_assignment", ["kpiAssignmentId"]),

  // --- Review, approval, comments, overrides ------------------------------
  reviews: defineTable({
    subjectType: v.union(
      v.literal("activity"),
      v.literal("evidence"),
      v.literal("measurement"),
      v.literal("period"),
    ),
    subjectId: v.string(),
    kpiAssignmentId: v.optional(v.id("kpiAssignments")),
    employeeId: v.id("employees"),
    periodKey: v.optional(v.string()),
    reviewerUserId: v.id("users"),
    decision: v.union(
      v.literal("verify"),
      v.literal("request_changes"),
      v.literal("reject"),
      v.literal("recommend"),
    ),
    recommendation: v.optional(v.number()),
    comment: v.string(),
    createdAt: v.number(),
  })
    .index("by_reviewer_status", ["reviewerUserId", "decision"])
    .index("by_employee_period", ["employeeId", "periodKey"]),

  approvals: defineTable({
    employeeId: v.id("employees"),
    performanceYearId: v.id("performanceYears"),
    periodKey: v.string(),
    approverUserId: v.id("users"),
    state: vWorkflowState,
    reason: v.optional(v.string()),
    priorScoreSnapshotId: v.optional(v.id("scoreSnapshots")),
    createdAt: v.number(),
  }).index("by_employee_period", ["employeeId", "periodKey"]),

  comments: defineTable({
    subjectType: v.string(),
    subjectId: v.string(),
    authorUserId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  }).index("by_subject", ["subjectType", "subjectId"]),

  scoreOverrides: defineTable({
    kpiMeasurementId: v.optional(v.id("kpiMeasurements")),
    employeeId: v.id("employees"),
    kpiAssignmentId: v.id("kpiAssignments"),
    periodKey: v.string(),
    originalValue: v.union(v.number(), v.null()),
    overrideValue: v.number(),
    reason: v.string(),
    overriddenByUserId: v.id("users"),
    createdAt: v.number(),
  }).index("by_assignment_period", ["kpiAssignmentId", "periodKey"]),

  // --- Frozen reporting snapshots -----------------------------------------
  scoreSnapshots: defineTable({
    scope: vReportScope,
    scopeRef: v.string(), // employeeId / role / location / "team"
    performanceYearId: v.id("performanceYears"),
    periodKey: v.string(),
    calcVersion: v.string(),
    /** Frozen, reproducible payload (per-KPI + scorecard totals). */
    payload: v.any(),
    configuredWeight: v.number(),
    assignedWeightScore: v.number(),
    normalizedScore: v.number(),
    normalizationEnabled: v.boolean(),
    evidenceCompletionPct: v.number(),
    cadenceCompliancePct: v.number(),
    approvalState: vWorkflowState,
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_scope_period", ["scope", "scopeRef", "periodKey"])
    .index("by_year_period", ["performanceYearId", "periodKey"]),

  // --- Notifications & reminders ------------------------------------------
  notifications: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    href: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user_unread", ["userId", "readAt"]),

  reminderJobs: defineTable({
    kind: v.string(), // "period_due", "overdue_flag", "review_backlog"
    periodKey: v.optional(v.string()),
    targetUserId: v.optional(v.id("users")),
    scheduledFor: v.number(),
    state: vJobState,
    lastRunAt: v.optional(v.number()),
    attempts: v.number(),
    /** Idempotency key so retries never double-fire. */
    dedupeKey: v.string(),
  })
    .index("by_state_scheduled", ["state", "scheduledFor"])
    .index("by_dedupeKey", ["dedupeKey"]),

  // --- Reports -------------------------------------------------------------
  reportJobs: defineTable({
    scope: vReportScope,
    scopeRef: v.string(),
    periodKey: v.string(),
    format: v.union(v.literal("pdf"), v.literal("xlsx")),
    state: vJobState,
    requestedByUserId: v.id("users"),
    /** Idempotency key — identical requests reuse the completed artifact. */
    idempotencyKey: v.string(),
    scoreSnapshotId: v.optional(v.id("scoreSnapshots")),
    generatedReportId: v.optional(v.id("generatedReports")),
    error: v.optional(v.string()),
    progress: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_requester", ["requestedByUserId"]),

  generatedReports: defineTable({
    reportJobId: v.id("reportJobs"),
    scope: vReportScope,
    scopeRef: v.string(),
    periodKey: v.string(),
    format: v.union(v.literal("pdf"), v.literal("xlsx")),
    storageId: v.id("_storage"),
    filename: v.string(),
    version: v.number(),
    // AI provenance (null for pure-deterministic exports).
    aiModelProvider: v.optional(v.string()),
    aiModelId: v.optional(v.string()),
    aiPromptVersion: v.optional(v.string()),
    aiSchemaVersion: v.optional(v.string()),
    aiUsage: v.optional(v.any()),
    aiApprovalState: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_job", ["reportJobId"])
    .index("by_scope_period", ["scope", "scopeRef", "periodKey"]),

  reportAccessLogs: defineTable({
    generatedReportId: v.id("generatedReports"),
    userId: v.id("users"),
    action: v.union(v.literal("view"), v.literal("download")),
    at: v.number(),
  }).index("by_report", ["generatedReportId"]),

  // --- Imports & data quality ---------------------------------------------
  importBatches: defineTable({
    fileName: v.string(),
    sheetName: v.string(),
    performanceYearId: v.optional(v.id("performanceYears")),
    state: v.union(v.literal("dry_run"), v.literal("committed"), v.literal("reverted")),
    sourceRowCount: v.number(),
    importedRowCount: v.number(),
    employeeCount: v.number(),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    committedAt: v.optional(v.number()),
    revertedAt: v.optional(v.number()),
  }).index("by_state", ["state"]),

  importRows: defineTable({
    importBatchId: v.id("importBatches"),
    sourceRowNumber: v.number(),
    raw: v.any(), // verbatim source cells
    canonical: v.any(), // proposed canonical payload
    outcome: v.union(v.literal("imported"), v.literal("skipped"), v.literal("error")),
    messages: v.array(v.string()),
  }).index("by_batch_row", ["importBatchId", "sourceRowNumber"]),

  dataQualityIssues: defineTable({
    code: v.string(), // stable idempotency slug
    performanceYearId: v.optional(v.id("performanceYears")),
    importBatchId: v.optional(v.id("importBatches")),
    category: vDqCategory,
    severity: vDqSeverity,
    status: vDqStatus,
    employeeId: v.optional(v.id("employees")),
    kpiAssignmentId: v.optional(v.id("kpiAssignments")),
    sourceRowNumber: v.optional(v.number()),
    canonicalKey: v.optional(vCanonicalKpiKey),
    field: v.optional(v.string()),
    sourceValue: v.optional(v.union(v.string(), v.number(), v.null())),
    proposedValue: v.optional(v.union(v.string(), v.number(), v.null())),
    reason: v.string(),
    blocksScoring: v.boolean(),
    resolvedByUserId: v.optional(v.id("users")),
    resolutionNote: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_category", ["category"])
    .index("by_row", ["sourceRowNumber"])
    .index("by_employee", ["employeeId"]),

  // --- Audit ---------------------------------------------------------------
  // --- Rate limiting (fixed window; one row per key, reset in place) --------
  rateLimits: defineTable({
    /** e.g. "password_change:<userId>" or "report_pdf:<userId>". */
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  auditLogs: defineTable({
    entityType: v.string(),
    entityId: v.string(),
    action: v.string(), // create/update/submit/review/approve/override/report/download/delete
    actorUserId: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    requestMeta: v.optional(v.any()), // ip/user-agent when available
    at: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_actor", ["actorUserId"])
    .index("by_at", ["at"]),
});
