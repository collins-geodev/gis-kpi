# Master Build Prompt — GIS Team KPI Performance Dashboard

You are a senior full-stack product architect, Next.js engineer, Convex backend engineer, data modeler, analytics engineer, UX/UI designer, security reviewer, QA engineer, and technical writer. Build a production-quality **GIS Team KPI Performance Dashboard** for the **GIS Team / GIS Unit** within **Technical Services — Technical Optimization**.

Do not produce a superficial mock-up. Build an auditable performance-management application that records work activities, validates evidence, calculates role-based KPIs, supports review and approval, explains every score, generates management-grade PDF reports, exports polished Excel workbooks, and deploys safely through GitHub, Convex, and Vercel.

## 1. Required technology and engineering baseline

- Use the current stable **Next.js App Router**, React, TypeScript, Tailwind CSS, and an accessible component system suitable for enterprise dashboards.
- Host the frontend on **Vercel** and use **Convex** for the database, real-time queries, mutations, actions, file metadata, scheduled reminders, and audit records.
- Use the current **Vercel AI SDK** structured-output pattern. Generate report insights as schema-validated structured data before rendering them into a deterministic PDF. Route model access through **Vercel AI Gateway** unless a different provider is explicitly configured. Keep the model ID in environment configuration and verify the current available model list during implementation; never hard-code an assumed model ID.
- Default server-side report, PDF, Excel, and AI workloads to the **Node.js runtime**. Use an Edge runtime only after every dependency is proven compatible and a real latency requirement exists.
- Connect the project to **GitHub**. Use pull requests, protected production branches, automated linting, type checking, tests, builds, and Vercel Preview Deployments. Configure isolated Convex preview backends and seed preview data safely.
- Keep all secrets in Vercel/Convex environment variables. Never commit credentials, deployment keys, private file URLs, or model keys.

## 2. Product mission

Create a single, trusted system for answering:

1. What is each GIS team member expected to achieve by role, location, KPI, and period?
2. What activities and evidence support every reported result?
3. What is the actual, target, attainment, weighted contribution, and final approved score?
4. Which KPI, person, role, location, or tracking cadence is improving, slipping, overdue, unsupported, or blocked?
5. Can a manager reproduce every displayed score from source activity and evidence?
6. Can management generate a polished PDF or Excel report for a person, role, location, month, quarter, or year?

## 3. Source-of-truth rules from the workbook

The supplied workbook has one sheet named `KPI Template`, one table spanning `A1:M90`, 13 fields, 75 KPI assignment rows, 15 employees, 4 job-role categories, 14 blank separator rows, and no formulas. Its columns are:

`S/N`, `Employee Name`, `Employee ID`, `Role`, `Department`, `Unit`, `Location`, `Objectives`, `Metric`, `Weight`, `Target`, `Target Type`, `Frequency of Tracking`.

Treat the workbook as the **2026 KPI configuration baseline**, not as performance history. It has no activity, actual, evidence, review, approval, or historical trend records.

Import and preserve two layers:

- `source*` fields containing the exact workbook text and values for auditability.
- Clean `canonical*` fields used by the application after validation and administrative approval.

Never silently repair or overwrite source values. Every normalization must create an import issue with the source row, original value, proposed canonical value, reason, status, reviewer, and timestamp.

Important source conditions that the application must surface:

- Each employee has five KPI rows, but the weights total **80**, not 100. Do not silently treat 80 as 100 or invent the missing 20 points.
- The `S/N` column is blank throughout the data rows. Generate internal stable IDs; do not depend on `S/N`.
- One tracking frequency is blank: employee `IKD034794`, source row 32, QA objective. Propose `Monthly` based on the matching analyst template, but require admin approval.
- Percentage targets are stored as decimals (`0.2` and `1`) and displayed as `20%` and `100%`. Store percentages consistently as decimals and format them as percentages in the UI and exports.
- Location appears as both `Akowonjo BU` and `Akowonjo B/U`. Preserve the source value and propose canonical `Akowonjo B/U`.
- Correct obvious typographical variants only in canonical text, including `oustanding` → `outstanding`, `Archieved` → `Achieved`, `maitenance` → `maintenance`, duplicated punctuation, stray quotation marks, `assets.ts`, `time timelines`, and inconsistent `24`, `24 hrs`, and `24 hours` wording.
- Several metrics require business clarification: `GDB Folders` is vague; the database maintenance KPI says “reduce errors by 20%” but is typed as `Number` with target `20`; one innovation metric for `IKD034543` incorrectly repeats the two-business-day integration metric; one innovation metric for `IKD034860` is truncated; some innovation metrics are qualitative and need an approval rubric.
- The workbook contains job titles but no corporate grade, numeric job level, manager relationship, or explicit role hierarchy. Preserve exact job titles. Add editable `grade`, `roleLevel`, `managerId`, and `displayOrder` fields rather than inventing HR grades.

## 4. Seed roster

Seed the following 15 employees exactly. Use `employeeId` as the unique business identifier. Keep title/honorific separate from the searchable display name if practical.

| Employee ID | Employee name | Job role | Source location |
|---|---|---|---|
| IKD030835 | Mr Timothy Olutayo Olugbenro | Geographic Information Systems Lead | Shomolu B/U |
| IKD041386 | Mr Oladipupo Olanrewaju Eboda | Geographic Information Systems Lead | Akowonjo BU |
| IKD034693 | Mr Lukmon Olawale Adedo | Geo Database Specialist | Company Head Office |
| IKD042840 | Mr Chiedu Conweh | Geographic Information Systems Specialist | Ikorodu B/U |
| IKD034860 | Mr Sheriff Baba Mohammed | Geographic Information Systems Analyst | Ikorodu B/U |
| IKD034794 | Mr Michael Ifeanyi Akudoro | Geographic Information Systems Analyst | Akowonjo B/U |
| IKD034604 | Mrs Grace Amarachi Chukwu | Geographic Information Systems Analyst | Oshodi B/U |
| IKD034769 | Mrs Obianuju Esther Onwuasoanya | Geographic Information Systems Analyst | Oshodi B/U |
| IKD034543 | Mr Timothy Anuoluwapo Babatunde | Geographic Information Systems Analyst | Abule Egba B/U |
| IKD034675 | Mr Oluwasanmi Ayodele Ajala | Geographic Information Systems Analyst | Abule Egba B/U |
| IKD043643 | Mrs Ruth Oluwaseun Dele-Aisida | Geographic Information Systems Analyst | Ikeja B/U |
| IKD092080 | Mr Babatunde Temitope Akintayo | Geographic Information Systems Specialist | Ikeja B/U |
| IKD112347 | Mr Abiola Julius Oduwaiye | Geographic Information Systems Specialist | Company Head Office |
| IKD112310 | Ms Halima Olamide Hassan | Geographic Information Systems Analyst | Shomolu B/U |
| IKD112329 | Mr. Jeleel Oloyede Ajetunmobi | Geographic Information Systems Analyst | Company Head Office |

All 75 assignments use `Department = Technical Services` and `Unit = Technical Optimization`. Model `team/function = GIS Unit` or `GIS Team` separately so the organizational labels are not conflated.

Role distribution: 2 GIS Leads, 1 Geo Database Specialist, 3 GIS Specialists, and 9 GIS Analysts.

## 5. Canonical role KPI catalogue

Seed the exact individual rows from the workbook, then map them to the following canonical role templates. Store the source row number on every imported assignment.

### Geographic Information Systems Lead — five KPIs, total source weight 80

1. **GIS deliverable accuracy and quality**  
   Metric: improvement in identified GIS-deliverable errors versus the prior-year baseline.  
   Weight: 10. Target: 20%. Target type: Percentage. Tracking: Monthly.  
   Required inputs: baseline error count, current error count, inspected deliverable count, and approved QA evidence.

2. **Full GIS network-asset data integration**  
   Metric: verified integrated assets divided by planned or eligible assets.  
   Weight: 20. Target: 100%. Target type: Percentage. Tracking: Monthly.

3. **Technology innovation for network efficiency and reliability**  
   Metric: approved innovation delivered, with quantified or rubric-scored business impact such as cost savings, reliability, efficiency, adoption, and sustainability.  
   Weight: 20. Target: 1. Target type: Number. Tracking: Annually.

4. **Technical and mentorship training for GIS Specialists and Analysts**  
   Metric: approved technical training or knowledge-sharing sessions.  
   Weight: 15. Source target: 4. Target type: Number. Tracking: Quarterly. Interpret as one session per quarter / four per year, subject to admin confirmation.

5. **On-time completion of GIS projects**  
   Metric: projects completed on or before the agreed date divided by total projects due, multiplied by 100.  
   Weight: 15. Target: 100%. Target type: Percentage. Tracking: Monthly.

### Geo Database Specialist — five KPIs, total source weight 80

1. **Enterprise geodatabase integrity, security, and performance**  
   Metric: documented weekly database health checks completed, combined with zero unscheduled downtime caused by database issues.  
   Weight: 20. Target: 100%. Target type: Percentage. Tracking: Weekly. Model health-check completion and downtime as separate inputs with an approved composite rule.

2. **Technical and mentorship training for GIS Analysts**  
   Metric: approved technical training or knowledge-sharing sessions.  
   Weight: 10. Source target: 4. Target type: Number. Tracking: Quarterly.

3. **GIS data quality during the Commercial Department maintenance window**  
   Source metric: reduce identified errors by 20% versus the previous year.  
   Weight: 10. Source target: 20. Source target type: Number. Tracking: Monthly. Flag the unit mismatch for administrative resolution before final scoring.

4. **Full GIS network-asset data integration**  
   Source metric: `GDB Folders`.  
   Weight: 20. Target: 100%. Target type: Percentage. Tracking: Monthly. Require a defined numerator, denominator, scope, and evidence standard.

5. **Technology innovation**  
   Source metric: `GIS Project Dashboard`.  
   Weight: 20. Target: 1. Target type: Number. Tracking: Annually. Require acceptance criteria and a business-impact rubric.

### Geographic Information Systems Specialist — five KPIs, total source weight 80

1. **On-time completion of GIS projects** — on-time projects / total projects due × 100; weight 15; target 100%; Percentage; Monthly.
2. **Resolution of GIS technical issues within 24 hours** — issues resolved within 24 hours / total eligible issues × 100; weight 10; target 100%; Percentage; Daily.
3. **Technical and mentorship training for GIS Analysts** — approved sessions; weight 15; source target 4; Number; Quarterly.
4. **Full GIS network-asset data integration** — achieved / planned × 100; weight 20; target 100%; Percentage; Monthly.
5. **Technology innovation for network efficiency and reliability** — approved innovation with business-impact evidence; weight 20; target 1; Number; Annually.

### Geographic Information Systems Analyst — five KPIs, total source weight 80

1. **Capture, process, and integrate spatial and non-spatial data**  
   Metric: new validated data integrated within two business days / total new validated data received × 100.  
   Weight: 20. Target: 100%. Target type: Percentage. Tracking: Weekly.

2. **GIS data quality assurance**  
   Metric: data errors or inconsistencies identified and corrected.  
   Weight: 15. Target: 20. Target type: Number. Tracking: Monthly. The source language says an average of 20 per month.

3. **Full GIS network-asset data integration**  
   Metric: achieved / planned × 100.  
   Weight: 10. Target: 100%. Target type: Percentage. Tracking: Monthly.

4. **Resolution of GIS technical issues within 24 hours**  
   Metric: issues resolved within 24 hours / total eligible issues × 100.  
   Weight: 15. Target: 100%. Target type: Percentage. Tracking: Daily.

5. **Technology innovation for network efficiency and reliability**  
   Metric: approved innovation with quantitative and qualitative business impact.  
   Weight: 20. Target: 1. Target type: Number. Tracking: Annually.

Source frequency distribution across the 75 rows: Monthly 31, Annually 15, Weekly 10, Daily 12, Quarterly 6, and blank 1. Source target types: Percentage 44 and Number 31.

## 6. KPI governance and configuration

Build an admin-controlled KPI settings module with:

- Versioned KPI definitions and versioned employee assignments by performance year.
- Effective dates, status (`draft`, `active`, `retired`), role template, employee override, location override, target type, target value, unit, frequency, direction of improvement, scoring method, score cap, stretch cap, evidence requirement, owner, reviewer, approver, and display order.
- Weight completeness validation per employee and period. Show `80 / 100 configured` prominently for the imported 2026 baseline.
- A workflow to resolve the missing 20 weight points: add KPI, change weights, or explicitly approve normalization. Preserve the decision in the audit log.
- Import preview, duplicate detection, dry-run validation, row-level errors, and reversible import batches.
- Canonicalization proposals that an administrator must approve.
- Ability to copy a role template to a new year without rewriting historical assignments.

## 7. Measurement and scoring engine

Implement calculations as deterministic, tested business logic. Never ask the AI model to calculate official scores.

Support these measurement modes:

- `ratio`: numerator / denominator, with denominator-zero handling.
- `count`: actual count compared with target count.
- `reduction`: (baseline − current) / baseline, with baseline-zero handling.
- `durationSla`: eligible items completed within a time threshold / total eligible items.
- `milestone`: approved milestones completed / planned milestones.
- `binary`: pass/fail with explicit conditions.
- `rubric`: reviewer-approved dimensions for qualitative innovation or impact.
- `composite`: multiple validated sub-measures such as health-check completion plus downtime.

For a higher-is-better KPI, calculate `attainment = actual / target`. For a lower-is-better KPI, use a configured inverse or reduction formula appropriate to the measure. Do not infer direction from wording at runtime; store it on the KPI definition.

Use configurable caps. Default official attainment cap may be 100%, with an optional stretch view up to 120%, but make both administrative settings.

Calculate and expose:

- raw actual and target;
- attainment percentage;
- weighted contribution = capped attainment × weight points;
- assigned-weight score = sum of weighted contributions, retaining the true configured maximum (80 for the imported baseline);
- normalized score = sum of weighted contributions / sum of assigned weights × 100, shown only when the organization explicitly enables normalization;
- evidence completeness percentage;
- cadence compliance percentage;
- provisional versus approved score;
- period-over-period change and year-to-date score.

Never display an 80-point configuration as a 100-point official score without a visible normalization label. Add configurable status thresholds, for example `On/Above Target`, `Watch`, `At Risk`, `Critical`, and `No Data`, with accessible colors and an admin-editable threshold table.

Aggregate daily and weekly observations into monthly, quarterly, and annual views using defined rules. For ratio KPIs, aggregate numerators and denominators rather than averaging percentages. Track period timezone as `Africa/Lagos` and handle deadlines, business days, holidays, and late submissions explicitly.

## 8. Activity and evidence workflow

Every performance claim must be traceable to activities and evidence.

Create an activity record with: employee, KPI assignment, activity date/time, tracking period, title, detailed description, quantity, numerator, denominator, baseline, current value, duration, project/ticket/asset reference, location, source system, created by, updated by, timestamps, and status.

Create an evidence record with: linked activity/KPI/period, storage ID or approved external URL, original filename, MIME type, file size, checksum, evidence category, title, description, activity date, project/ticket/asset ID, location, uploader, upload timestamp, version, confidentiality, review status, reviewer comments, and retention state.

Support images, PDF, Office files, CSV, ZIP/GIS packages, links, project records, tickets, training attendance, QA logs, database-health logs, screenshots, and supervisor attestations. Validate file types and sizes. Show upload progress and failures. Do not expose private evidence through permanent bearer URLs when access must be checked on every request; serve it through an authenticated and authorized path.

Workflow states: `draft`, `submitted`, `needs_changes`, `verified`, `approved`, `rejected`, `locked`, and `reopened`. Require reasons for rejection, reopening, deletion, or score overrides. Approved periods are immutable unless a privileged user reopens them; preserve the prior version.

## 9. Roles and access control

Keep **application permissions** separate from **employee job roles**.

Minimum application roles:

- `System Admin`: configuration, imports, users, access, thresholds, periods, integrations.
- `GIS Unit Admin / KPI Admin`: KPI templates, assignments, reporting calendar, data-quality resolution.
- `GIS Lead / Manager`: team visibility, review, comments, approvals, reports.
- `Reviewer`: evidence verification and scoring recommendations within assigned scope.
- `Employee`: own KPIs, activities, evidence, submissions, comments, reports.
- `Executive Viewer`: approved aggregate and individual read-only reports.
- `Auditor`: read-only access to configuration history, evidence metadata, score lineage, and audit logs.

Authenticate users through a production-ready identity provider compatible with Convex. In every public Convex query, mutation, action, and HTTP action, verify identity and authorization server-side. Never rely on hidden UI controls as authorization. Enforce scope by employee, reviewer assignment, role, location, and period.

## 10. Convex data model

Define a strict, validated Convex schema with useful indexes and paginated queries. At minimum include:

- `organizations`, `departments`, `units`, `teams`, `locations`;
- `jobRoles` and `appRoles`;
- `users` and `userRoleAssignments`;
- `performanceYears` and `trackingPeriods`;
- `kpiDefinitions` and `kpiDefinitionVersions`;
- `kpiAssignments` with immutable snapshots of objective, metric, weight, target, target type, frequency, and scoring rules;
- `activities` and `kpiMeasurements`;
- `evidenceFiles` and `evidenceLinks`;
- `reviews`, `approvals`, `comments`, and `scoreOverrides`;
- `scoreSnapshots` for reproducible approved reporting;
- `notifications` and `reminderJobs`;
- `reportJobs` and `generatedReports`;
- `importBatches`, `importRows`, and `dataQualityIssues`;
- `auditLogs`.

Add indexes for common access paths such as employee + period, KPI + period, role + period, location + period, status + due date, reviewer + status, import batch + source row, evidence + assignment, and audit entity + timestamp. Avoid unbounded scans. Use cursor pagination for large activity, evidence, report, and audit tables.

Use queries for reads, mutations for transactional writes, actions for external AI/report services, and HTTP actions only where an external endpoint or authenticated file-serving path is needed. Use scheduled functions for reminders, overdue flags, period opening/closing, report queues, and safe retries. Make import and report jobs idempotent.

## 11. Application pages and workflows

Build the following responsive areas:

1. **Sign-in and first-run setup** — authentication, organization context, profile mapping, access-denied experience.
2. **Executive Overview** — approved team score, configured weight completeness, evidence coverage, cadence compliance, on-target rate, overdue submissions, review backlog, top positive/negative drivers, and reporting period selector.
3. **Team Performance** — sortable employee scorecards, role/location comparisons, fair-comparison labels, status, trend, evidence completeness, overdue items, and drill-down.
4. **Individual Performance** — profile, five assigned KPIs, target/actual/attainment/weight/contribution, activity timeline, evidence gallery, reviewer feedback, score history, and downloadable report.
5. **KPI Detail** — definition, formula, source wording, canonical wording, target, cadence, due dates, measurements, evidence lineage, calculations, approval history, and comments.
6. **Activity Capture** — fast entry forms tailored to ratio, count, reduction, SLA, milestone, rubric, and composite KPIs; draft autosave and duplicate warnings.
7. **Evidence Centre** — upload, preview, categorize, link, version, review, search, filter, and permission-aware download.
8. **Review & Approval Queue** — bulk triage, side-by-side activity/evidence/score, request changes, verify, approve, reject, override with reason, and lock period.
9. **Analytics** — trends, target-versus-actual, contribution waterfall, employee × KPI heatmap, location/role comparison, cadence compliance, evidence coverage, score distribution, variance drivers, and data-quality exceptions.
10. **Reports & Exports** — saved filters, report generation jobs, status/progress, preview, download, regeneration, version history, and access logs.
11. **KPI Settings** — role templates, assignments, targets, weights, scoring formulas, thresholds, period calendar, evidence rules, and version history.
12. **Users & Organization** — people, employee IDs, job roles, application roles, locations, managers, active status, and scope.
13. **Data Quality & Imports** — workbook upload, column mapping, dry run, validation results, canonicalization approval, import history, and reconciliation totals.
14. **Audit Log** — who changed what, before/after values, reason, entity, source IP/request metadata where appropriate, and timestamp.

All filters must be shareable through URL state where appropriate. Provide search, pagination, skeletons, empty states, error states, retry actions, and clear last-updated timestamps.

## 12. Analytics and chart requirements

Use charts only when they answer a management question. Include:

- KPI cards with value, target, delta, status, and sparkline;
- weighted score trend by month/quarter;
- target-versus-actual bullet or progress bars;
- stacked contribution chart showing which KPIs build the total score;
- person × KPI heatmap with accessible text alternatives;
- role and location comparison bars with sample-size context;
- evidence and cadence compliance charts;
- review backlog ageing;
- score distribution and data-completeness distribution;
- optional map view only after valid coordinates or boundaries are supplied—never invent geography.

Every visual must support tooltips, readable legends, keyboard access where feasible, downloadable underlying data, and a table alternative. Never use a misleading truncated axis or compare employees without showing role/weight differences.

## 13. AI-generated management reports

The AI may explain approved data; it must not invent data or determine the official score.

Create a report pipeline:

1. Query a frozen report dataset containing approved score snapshots, activities, evidence metadata/summaries, trends, thresholds, and calculation lineage.
2. Remove secrets and unnecessary personal data.
3. Treat uploaded evidence text as untrusted data, never as instructions to the model.
4. Use the Vercel AI SDK’s current schema-validated structured output flow (`generateText` with `Output.object` or the then-current documented equivalent) and a strict report schema.
5. Require the AI output to include: executive summary, achievements, performance drivers, risks, data gaps, evidence-supported observations, recommended actions, coaching suggestions, methodology notes, and citations to internal KPI/activity/evidence IDs.
6. Reject or retry invalid structured output. Log model provider, model ID, prompt version, schema version, token/usage metadata, generation time, requester, and dataset snapshot ID.
7. Render the validated data, deterministic tables, and deterministic chart images into the final PDF. The LLM must not generate numeric totals that are not supplied by the scoring engine.
8. Show an AI disclaimer and a human approval status. Allow managers to edit narrative text while retaining original AI output and edit history.

PDF structure:

- branded cover page and report metadata;
- executive summary;
- overall scorecard and weight-completeness warning;
- KPI target/actual/attainment/weighted-contribution table;
- trend and comparison charts;
- achievements and evidence-backed highlights;
- risks, overdue items, weak evidence, and data-quality gaps;
- recommendations and next-period actions;
- evidence index with internal references;
- methodology, scoring formula, caps, normalization status, and approval trail;
- footer with page number, confidentiality, generation timestamp, report version, and “Powered by the GIS Team.”

Reports must work for individual, team, role, location, monthly, quarterly, and annual scopes. Long-running generation should use a job state (`queued`, `running`, `completed`, `failed`, `cancelled`) with safe retry and no duplicate charge for an idempotent request.

## 14. Professional Excel export

Generate a genuine `.xlsx` workbook, not CSV renamed as Excel. Include:

- `Executive Summary`;
- `Team Scorecard`;
- `Individual KPI Detail`;
- `Activity Register`;
- `Evidence Register`;
- `Data Quality Issues`;
- `KPI Definitions & Methodology`.

Use professional title bands, filters, frozen headers, appropriate widths, wrapped narrative fields, typed dates/numbers/percentages, conditional formatting, print settings, page headers/footers, source period, generated timestamp, and a visible note when weights total 80. Preserve leading zeros and identifiers as text. Include the active filters and report version. Validate that the workbook opens without formula errors or clipped critical content.

## 15. Visual design and motion

Create an executive-grade GIS operations aesthetic, not a gaming interface.

- Base palette: deep navy `#07111F`, slate `#0F172A`, off-white `#F8FAFC`, GIS teal/cyan accents, success green, warning amber, and critical red.
- Incorporate the workbook’s header red `#C00000` as a deliberate corporate accent for key navigation, report bands, or emphasis—not as a large harsh background.
- Use subtle map grids, contour lines, network-node paths, coordinates, or geospatial motifs at very low opacity. Do not use a real map without licensed/source data.
- Use restrained glass or layered cards, crisp borders, accessible contrast, clean spacing, large KPI numerals, and a neutral enterprise font.
- Animate chart entrances, status transitions, map nodes, and icons subtly. Avoid perpetual motion in primary reading areas, layout shifts, and excessive blur.
- Respect `prefers-reduced-motion`, keyboard navigation, focus states, screen readers, and WCAG AA contrast.
- Provide a light theme and a professional dark theme if feasible; persist the user choice.

Add the exact phrase **“Powered by the GIS Team”** as a tasteful horizontal scrolling banner in the dashboard shell and report/export footer. In the web UI it should glow softly and breathe/zoom between approximately 0.98 and 1.02 while scrolling. Pause or simplify on hover/focus, supply a non-animated accessible label, hide duplicated marquee text from assistive technology, and disable the motion under reduced-motion preferences.

## 16. Reliability, privacy, and security

- Validate every Convex argument and return shape.
- Centralize authentication and authorization helpers and call them at the beginning of every public backend function.
- Apply least privilege and scope checks to every read, write, file, report, and export.
- Protect against insecure direct object references, mass assignment, duplicate submissions, replayed report jobs, and unauthorized file access.
- Sanitize filenames and user-authored text; escape report content; mitigate spreadsheet formula injection in exports.
- Rate-limit sensitive actions and AI generation; enforce file limits; provide a malware-scanning integration point.
- Store only necessary PII. Define evidence retention, deletion, legal hold, and employee deactivation behavior.
- Record immutable audit events for configuration, import, submission, review, approval, override, report generation, download, and deletion.
- Provide graceful failures, retries, observability, structured logs, and admin-visible job errors without leaking secrets.

## 17. Repository, deployment, and documentation

Organize the repository clearly, with feature-oriented UI modules and domain-oriented Convex functions. Include:

- typed schema and validators;
- reusable authorization and scoring helpers;
- seed/import scripts for the exact workbook baseline;
- environment-variable example file with placeholders only;
- unit, integration, and end-to-end tests;
- GitHub Actions for lint, formatting check, type check, tests, and production build;
- branch protection guidance and required checks;
- Vercel project configuration and Convex development/preview/production setup;
- a README covering local setup, authentication, imports, scoring, evidence security, AI reports, PDF/Excel generation, testing, deployment, backup/export, and operational troubleshooting;
- an administrator guide and a concise employee/reviewer user guide.

Use Vercel’s Git integration for automatic preview deployments on branches and pull requests and production deployment from the configured production branch. Configure separate environment variables and Convex deployments for local, preview, and production. Seed preview data without exposing production employee evidence.

## 18. Testing and acceptance criteria

The implementation is complete only when all of these pass:

1. Exactly 15 employees and 75 KPI assignment rows import from the baseline, with a reconciliation screen showing source and imported totals.
2. All four job-role categories and every source objective, metric, weight, target, target type, frequency, department, unit, and location remain auditable.
3. Every employee shows five KPIs and an explicit `80 / 100 configured weight` warning.
4. The missing row-32 frequency and all other source anomalies appear in the Data Quality queue; none are silently corrected.
5. Percentage targets display correctly as 20% or 100%, while number targets display as 1, 4, or 20.
6. Unit tests cover ratio, count, reduction, SLA, rubric, composite, zero denominator, missing baseline, caps, 80-point weighting, normalization, and period aggregation.
7. A submitted result without required evidence cannot become an approved official score.
8. An employee cannot read another employee’s restricted evidence; managers/reviewers see only their authorized scope.
9. Approved scores are reproducible from frozen inputs and calculation versions.
10. PDF reports include correct deterministic numbers, charts, evidence references, methodology, report version, and AI/human approval status.
11. Excel exports are polished, filtered to the selected scope, correctly typed, formula-injection safe, and open without errors.
12. The dashboard is responsive at mobile, tablet, laptop, and large-screen widths and meets WCAG AA for core flows.
13. Loading, empty, error, permission-denied, offline/reconnect, and failed-job states are implemented.
14. CI passes lint, type checking, unit tests, integration tests, end-to-end tests, and production build.
15. A GitHub pull request produces an isolated Vercel/Convex preview; merging the approved production branch deploys production safely.

## 19. Delivery sequence

Proceed in this order and show progress after each phase:

1. Inspect the existing repository and preserve valid work.
2. Present the proposed information architecture, route map, schema, authorization matrix, scoring rules, and source-data reconciliation before broad implementation.
3. Implement the Convex schema, indexes, authorization helpers, versioned settings, seed import, and deterministic scoring engine.
4. Implement authentication, application shell, dashboard pages, activity/evidence capture, review workflow, analytics, and admin settings.
5. Implement structured AI insights, deterministic PDF rendering, and professional Excel export.
6. Add auditability, scheduled reminders, observability, failure handling, security hardening, and accessibility.
7. Add tests, seed data, CI, GitHub/Vercel/Convex deployment configuration, and documentation.
8. Run the full verification suite and provide a final handover containing architecture, completed features, known assumptions, unresolved source-data decisions, deployment steps, admin credentials/setup instructions without secrets, and evidence that the acceptance criteria passed.

When a source rule is ambiguous, do not guess and do not block unrelated implementation. Preserve the source, create a visible `Needs Admin Review` issue, implement the configuration point, and continue with safe test data. The finished application must make every score understandable, every claim evidence-backed, and every change auditable.
