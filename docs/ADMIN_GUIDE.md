# Administrator Guide

For System Admins and GIS Unit / KPI Admins.

## 1. First-run setup

1. Complete the local/deploy steps in the [README](../README.md) (Convex dev, auth, seed).
2. Create your account on `/signin`, then on **Executive Overview** click **Claim System Admin** (only works while no admin exists; lock it to one address with `ADMIN_BOOTSTRAP_EMAIL` in the Convex env).
3. Seed the baseline if not done: `npx convex run seed:seedBaseline`.

## 2. Users & application roles (`/settings/users`)

- **Application roles are separate from job roles.** Grant roles: System Admin, KPI Admin, Manager, Reviewer, Employee, Executive Viewer, Auditor.
- **Link accounts to employees** so employees see their own KPIs in Activity Capture and get self-service scope.
- Managers/reviewers can be scoped by employee, role, or location (via `grantRole` scope fields).

## 3. Data Quality queue (`/data-quality`)

Every workbook anomaly is a reviewable issue — **nothing is auto-corrected**. Actions:

- **Approve** a proposed canonical value (e.g. `Akowonjo BU → Akowonjo B/U`, typo fixes).
- **Resolve** an ambiguity after clarifying the business rule (GDB Folders, GIS Project Dashboard, the composite integrity rule).
- **Reject** a proposal (reason required) — the source value is retained.

Resolving a **blocking** issue (missing row-32 frequency, the row-16 unit mismatch, the row-54 mismatch, the row-30 truncation, the innovation rubric) recomputes whether the affected KPI is still `scoring blocked`. A KPI can't be approved into an official score until its blockers clear.

## 4. The 80 / 100 weight gap

Each employee's five KPIs total **80**, not 100. This is surfaced everywhere (Overview, Team, Individual, exports). Resolve per organization policy by either: adding a KPI, changing weights, or explicitly enabling normalization on the performance year (`performanceYears.normalizationEnabled`). Whatever you choose is audit-logged. Until then, the score is shown out of the true configured maximum (80) and never silently rebased to 100.

## 5. Scoring, caps & thresholds

- Measurement modes, direction of improvement, target type, and caps live on each KPI definition/assignment (see `convex/lib/catalogue.ts`, `scoring.ts`).
- Default caps: official 100%, stretch 120% (`performanceYears.officialAttainmentCap` / `stretchAttainmentCap`).
- Status bands (On/Above Target · Watch · At Risk · Critical · No Data) come from `convex/lib/thresholds.ts` (admin-editable defaults).

## 6. Review & approval (`/review`)

- Provisional measurements appear grouped by employee + period.
- **Approve period** is blocked until required evidence is approved and no data-quality issue blocks the KPI. Approval finalizes the measurements and freezes a reproducible `scoreSnapshot` (calc version + inputs).

## 7. Reports & exports (`/reports`)

- **Excel** (`/api/reports/xlsx`) — 7-sheet workbook, typed cells, formula-injection safe, 80-weight note.
- **PDF** (`/api/reports/pdf`) — deterministic; optional AI narrative (needs `AI_GATEWAY_API_KEY`) that only explains engine numbers, with a disclaimer + human-approval status.
- Generation provenance (format, AI provider/model/prompt/schema version, usage) is written to the Audit Log.

## 8. Audit & scheduled jobs

- **Audit Log** (`/audit`) records config, imports, submissions, reviews, approvals, overrides, report generation and downloads.
- Cron jobs (`convex/crons.ts`): daily overdue-period flagging and a manager review-backlog reminder.

## 9. Imports & reconciliation

- The seed import is idempotent and preserves the verbatim source layer on every assignment.
- Reconciliation totals (15 employees / 75 rows / weight 80) and the full anomaly ledger are in [RECONCILIATION.md](RECONCILIATION.md).
