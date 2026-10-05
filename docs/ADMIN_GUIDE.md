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
- **Approve period** is blocked until required evidence is approved **for that period** and no data-quality issue blocks the KPI. Approval finalizes the measurements and freezes a reproducible `scoreSnapshot` (calc version + inputs).
- Reviewers can send work back after approval: **Reject all** returns all entries for a KPI/period (approved ones included); **Recall entry** on a single approved entry sends back only that entry (`approvals:recallActivityApproval`). Both need a reason, are audited and notify the employee. The KPI re-enters the queue; its earlier snapshot stays until the period is re-approved.

### Evidence rules (period-aware)

- Evidence completes only the period it supports. Its period is, in order: the **period tag** chosen at upload → the **work date** picked in Activity Capture → the **upload month** (legacy, untagged files). Months roll up into quarterly/annual KPIs. Deleted evidence never counts. See `convex/lib/evidencePeriod.ts`.
- Evidence decisions (approve / reject / remove) never reopen a period that is already approved.
- **Wrong-period flag:** evidence dated to a period with no logged work on its KPI shows *no work logged for …* in the Evidence panel and *wrong period? tagged …* on `/review`. Reviewers/admins can change any file's period in the Evidence panel (owners only before approval) — audited as `set_evidence_period` (`evidence:setEvidencePeriod`).
- **Late flag:** an upload after the period's evidence deadline is flagged *evidence late* on `/review` (it still counts). The deadline is the period's `evidenceDueAt` if set, otherwise its submission `dueAt`; cadence grace waives it.
- **Duplicate flag:** admins see *duplicate* in the Evidence Centre and *duplicate evidence (n)* on `/review` when the same file was uploaded by another employee — same SHA-256 checksum (computed in the browser at upload), same link, or same filename and size.

### Evidence maintenance commands

Run from a terminal authenticated to Convex. Each supports a dry run — run that first and check the output.

```bash
# Re-derive stored evidence ticks per period (fixes ticks written by the old assignment-wide rule)
npx convex run migrations:repairEvidenceGates '{"dryRun":true}' --prod

# Re-mark approved periods that an evidence action wrongly reopened (only rows unchanged since approval)
npx convex run migrations:repairReopenedApprovals '{"dryRun":true}' --prod

# Evidence due by 23:59 on the 5th of the following month — the current setting
# (all periods, or add "periodKey":"2026-M09")
npx convex run migrations:setEvidenceDeadlines '{"dayOfNextMonth":5,"dryRun":true}' --prod

# Monthly entry deadlines: 23:59 on the 5th of the following month — the current setting
# (also reopens periods flagged "grace" too early and clears stale "submitted late" flags)
npx convex run migrations:setSubmissionDeadlines '{"dayOfNextMonth":5,"dryRun":true}' --prod

# Remove evidence deadlines (the period due date applies again)
npx convex run migrations:setEvidenceDeadlines '{"clear":true}' --prod
```

Drop `"dryRun":true` to apply. Every applied change is written to the Audit Log.

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
