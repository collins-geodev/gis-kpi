# Architecture — GIS Team KPI Performance Dashboard

## 1. System shape

```
Next.js 15 (App Router, RSC)  ──▶  Convex (DB · queries/mutations/actions · file storage · crons · auth)
        │                                   │
        │ Node runtime route handlers       ├─ deterministic scoring engine (convex/lib/scoring.ts)
        ├─ /api/reports/pdf  (@react-pdf)   ├─ verbatim source rows (convex/lib/sourceRows.ts)
        ├─ /api/reports/xlsx (exceljs)      ├─ canonical catalogue (convex/lib/catalogue.ts)
        ├─ /api/ai/report    (Vercel AI SDK, structured output via AI Gateway)
        └─ /api/evidence/[id] (authenticated, authorized file streaming)
```

- **Frontend hosting:** Vercel (`gis-kpi` → `gis-kpi.vercel.app`).
- **Backend:** Convex project `gis-kpi` — dev `cautious-grasshopper-472`, prod `scintillating-bulldog-550`.
- **Repo:** `collins-geodev/gis-kpi`.
- **Runtime:** report/PDF/Excel/AI workloads default to the **Node.js runtime**. Edge only if a real latency need is proven and every dep is compatible.
- **Timezone:** all period boundaries / deadlines in `Africa/Lagos`.

## 2. Route map (App Router)

| Route | Page | Primary roles |
|---|---|---|
| `/signin`, `/setup` | Auth + first-run org/profile mapping, access-denied | all / system_admin |
| `/overview` | Executive Overview (approved team score, 80/100 weight completeness, evidence & cadence coverage, overdue, review backlog, drivers) | manager, executive_viewer, admins |
| `/team` | Team Performance (sortable scorecards, role/location comparison w/ fair-comparison labels) | manager, reviewer, admins |
| `/employees/[employeeId]` | Individual Performance (5 KPIs, target/actual/attainment/weight/contribution, activity timeline, evidence gallery, score history, report) | self, manager, reviewer, admins |
| `/kpi/[assignmentId]` | KPI Detail (definition, formula, **source vs canonical** wording, measurements, evidence lineage, calc, approvals, comments) | scoped |
| `/activities`, `/activities/new` | Activity Capture (mode-tailored forms, autosave, duplicate warnings) | employee, admins |
| `/evidence` | Evidence Centre (upload/preview/categorize/link/version/review, permission-aware download) | scoped |
| `/review` | Review & Approval Queue (bulk triage, side-by-side, verify/approve/reject/override/lock) | reviewer, manager, admins |
| `/analytics` | Trends, target-vs-actual, contribution waterfall, person×KPI heatmap, comparisons, backlog ageing, distributions, DQ exceptions | manager, admins |
| `/reports` | Reports & Exports (jobs, status/progress, preview, download, versions, access logs) | manager, executive_viewer, admins |
| `/settings/kpi` | KPI Settings (templates, assignments, targets, weights, formulas, thresholds, calendar, evidence rules, versions) | kpi_admin, system_admin |
| `/settings/users` | Users & Organization (people, employee IDs, job roles, app roles, locations, managers, scope) | system_admin |
| `/data-quality` | Data Quality & Imports (upload, mapping, dry run, validation, canonicalization approval, history, reconciliation totals) | kpi_admin, system_admin |
| `/audit` | Audit Log (who/what/before-after/reason/entity/timestamp) | auditor, system_admin |

Filters are URL-encoded (shareable). Every list has search, pagination, skeletons, empty/error/permission-denied states, retry, and last-updated timestamps.

## 3. Authorization matrix (application roles, separate from job roles)

| Capability | system_admin | kpi_admin | manager | reviewer | employee | exec_viewer | auditor |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Configure org/users/access/thresholds/periods | ✅ | — | — | — | — | — | — |
| KPI templates / assignments / imports / DQ resolution | ✅ | ✅ | — | — | — | — | — |
| View team performance & reports | ✅ | ✅ | ✅ (scope) | ✅ (scope) | — | ✅ (approved) | 👁 |
| Own KPIs / activities / evidence / submit | ✅ | ✅ | ✅ | ✅ | ✅ (self) | — | — |
| Verify evidence / recommend scores | ✅ | ✅ | ✅ | ✅ (scope) | — | — | — |
| Approve / reject / lock period / override (reason required) | ✅ | — | ✅ (scope) | — | — | — | — |
| Read another employee's restricted evidence | ✅ | ✅ | scope only | scope only | ❌ | ❌ | metadata only |
| Read config history / score lineage / audit logs | ✅ | 👁 | 👁 | — | — | — | ✅ |

Enforcement is **server-side in every Convex function** (query/mutation/action/httpAction) via centralized `requireIdentity` / `requireRole` / `requireEmployeeScope` helpers. Hidden UI controls are never the authorization boundary. Scope keys: employee, reviewer assignment, role, location, period.

## 4. Data model (Convex tables)

Organization: `organizations · departments · units · teams · locations`.
People/access: `employees · jobRoles · users · userRoleAssignments`.
Calendar: `performanceYears · trackingPeriods`.
KPI config: `kpiDefinitions · kpiDefinitionVersions · kpiAssignments` (immutable snapshot + verbatim source layer).
Measurement: `activities · kpiMeasurements`.
Evidence: `evidenceFiles · evidenceLinks`.
Workflow: `reviews · approvals · comments · scoreOverrides`.
Reporting: `scoreSnapshots · reportJobs · generatedReports · reportAccessLogs`.
Ops: `notifications · reminderJobs`.
Import/DQ: `importBatches · importRows · dataQualityIssues`.
Audit: `auditLogs`.

Indexes cover employee+period, KPI+period, role+period, location+period, status+due, reviewer+status, importBatch+sourceRow, evidence+assignment, audit entity+timestamp, DQ code/status/category. Large tables paginate with cursors. See [`convex/schema.ts`](../convex/schema.ts).

## 5. Scoring rules (deterministic — never the LLM)

Measurement modes: `ratio · count · reduction · durationSla · milestone · binary · rubric · composite`. Direction (`higherIsBetter`/`lowerIsBetter`) is stored on the definition, never inferred at runtime. Caps are admin settings (default official 100%, stretch 120%).

```
attainment            = f(mode, raw inputs, target, direction)   # decimal, 1.0 = 100%
cappedAttainment      = clamp(attainment, 0, officialCap)
weightedContribution  = cappedAttainment × weight points
assignedWeightScore   = Σ weightedContribution                    # retains TRUE max (80 for baseline)
normalizedScore       = assignedWeightScore / Σ weights × 100     # shown only when normalization enabled + labelled
```

- Ratio-type KPIs aggregate **numerators & denominators** across sub-periods — never average percentages.
- Zero denominator / missing baseline → **no data** (status `no_data`), not a divide-by-zero.
- A submission without required, approved evidence can never become an approved official score.
- Approved scores are frozen into `scoreSnapshots` (calc version + inputs) for reproducible reporting.
- Status bands (`On/Above Target · Watch · At Risk · Critical · No Data`) come from an admin-editable threshold table.

Implementation + 47 passing unit tests: [`convex/lib/scoring.ts`](../convex/lib/scoring.ts), [`scoring.test.ts`](../convex/lib/scoring.test.ts), [`reconciliation.test.ts`](../convex/lib/reconciliation.test.ts).

## 6. AI report pipeline (explains, never calculates)

1. Freeze an approved report dataset (score snapshots, activities, evidence *metadata/summaries*, trends, thresholds, calc lineage).
2. Strip secrets & unnecessary PII; treat evidence text as **untrusted data**, never instructions.
3. Vercel AI SDK structured output (`generateText` + `Output.object`) against a strict Zod schema; model id from env, routed via AI Gateway.
4. Reject/retry invalid output; log provider, model id, prompt+schema version, usage, time, requester, dataset snapshot id.
5. Deterministic engine supplies all numbers; render validated narrative + deterministic tables/chart images into the PDF. AI disclaimer + human approval status; managers may edit narrative (original + edit history retained).

## 7. Deterministic exports

- **PDF** (`@react-pdf/renderer`, Node): branded cover, executive summary, scorecard + 80/100 weight warning, KPI table, charts, achievements/evidence, risks/overdue/weak-evidence/DQ gaps, recommendations, evidence index, methodology + approval trail, footer ("Powered by the GIS Team").
- **Excel** (`exceljs`, Node, genuine `.xlsx`): sheets `Executive Summary · Team Scorecard · Individual KPI Detail · Activity Register · Evidence Register · Data Quality Issues · KPI Definitions & Methodology`. Title bands, filters, frozen headers, typed numbers/dates/percentages, conditional formatting, identifiers preserved as text, formula-injection-safe cells, visible 80-weight note.

## 8. Security posture

Validate every Convex arg/return; centralized authn/authz at the top of every public function; least-privilege scope on every read/write/file/report/export; guard against IDOR, mass assignment, duplicate submissions, replayed report jobs, unauthorized file access; sanitize filenames + user text; mitigate spreadsheet formula injection; rate-limit sensitive/AI actions; evidence retention/legal-hold/deactivation rules; immutable `auditLogs` for config/import/submit/review/approve/override/report/download/delete.
