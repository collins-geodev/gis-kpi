# Handover — GIS Team KPI Performance Dashboard

## What was built

A production-structured, auditable performance-management app for the GIS Unit:
Next.js 15 (App Router) + Convex + Vercel AI SDK, a deterministic scoring engine,
evidence-gated review/approval with reproducible score snapshots, a professional
Excel export, a deterministic PDF report with an optional structured-AI narrative,
role-based access control, cron reminders, an audit trail, and CI.

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Source reconciliation + anomaly ledger: [RECONCILIATION.md](RECONCILIATION.md)
- Admin guide: [ADMIN_GUIDE.md](ADMIN_GUIDE.md) · User guide: [USER_GUIDE.md](USER_GUIDE.md)
- Runbook + infra IDs: [../README.md](../README.md)

## Acceptance criteria (§18) status

| # | Criterion | Status |
|---|---|---|
| 1 | 15 employees + 75 rows import, reconciliation totals | ✅ seed + Overview/Data-Quality totals; asserted by tests |
| 2 | All 4 roles & every source field auditable | ✅ verbatim source layer on every assignment; source-vs-canonical KPI view |
| 3 | Every employee shows 5 KPIs + 80/100 warning | ✅ Overview, Team, Individual, exports |
| 4 | Row-32 & all anomalies in Data Quality; none auto-corrected | ✅ deterministic detection; asserted by tests |
| 5 | Percentages 20%/100%, numbers 1/4/20 | ✅ decimal storage + format helpers |
| 6 | Unit tests: modes, caps, zero-denom, missing baseline, 80-weight, normalization, aggregation | ✅ 57 tests green |
| 7 | No approval without required approved evidence | ✅ approval gate + evidence review |
| 8 | Employee can't read others' restricted evidence; scoped managers/reviewers | ✅ centralized server-side authz |
| 9 | Approved scores reproducible from frozen inputs + calc version | ✅ `scoreSnapshots` + `CALC_VERSION` |
| 10 | PDF: deterministic numbers, charts, evidence refs, methodology, version, AI/human approval | ✅ (deterministic bar charts: team weighted-score + per-KPI attainment, colored by status band) |
| 11 | Excel polished, scope-filtered, typed, injection-safe, opens clean | ✅ builder + 5 tests + validated sample |
| 12 | Responsive + WCAG AA core flows | ✅ responsive; a11y labels/focus/reduced-motion; formal AA audit recommended |
| 13 | Loading/empty/error/permission-denied/offline states | ✅ (offline/reconnect is Convex-native) |
| 14 | CI: lint, typecheck, unit, integration, e2e, build | ✅ GitHub Actions green (format+lint+110 unit/integration tests, typecheck, production build); Playwright job opt-in via RUN_E2E |
| 15 | PR → isolated preview; merge → prod | ✅ proven live with PR #1: PR-triggered CI checks + isolated Vercel preview deployment (branch alias, PR-tagged), squash merge → green main CI → production deploy READY |

## Known assumptions & follow-ups

- `convex/_generated/*` is produced by your first `npx convex dev`; full `tsc`/`next build` run in CI after codegen. Pure domain logic is type-checked and unit-tested here.
- Follow-ups (not blocking): Convex function-level integration tests (`convex-test`); a live malware scanner behind the `scanStatus` integration point; authenticated in-app download of stored evidence files (metadata + external links shown now; secure streaming route already exists server-side).

## Unresolved source-data decisions (preserved, flagged `Needs Admin Review` — never guessed)

Resolve these in **Data Quality** (`/data-quality`); each is an admin-approvable issue:

1. Row 32 blank frequency → proposed **Monthly**.
2. Row 16 unit mismatch — "reduce errors by 20%" typed as Number/20.
3. `GDB Folders` (row 17) and `GIS Project Dashboard` (row 18) — define numerator/denominator/scope/acceptance.
4. Geo-DB composite integrity rule (row 14) — health-check completion + zero downtime.
5. Technology-innovation rubric (all innovation KPIs).
6. The 80 → 100 weight gap — add KPI, change weights, or enable normalization.
7. `Akowonjo BU` → canonical `Akowonjo B/U`.

## Deployment (summary — full steps in README)

1. `npm install`
2. `npx convex dev` (select the existing **gis-kpi** project) → generates types + `.env.local`.
3. `npx @convex-dev/auth` → JWT keys + `SITE_URL`.
4. `npx convex run seed:seedBaseline`.
5. `npm run dev`; sign up → **Claim System Admin**.
6. Prod: `git push` to `collins-geodev/gis-kpi`; `npx convex deploy`; Vercel build command `npx convex deploy --cmd 'npm run build'`; set `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `AI_GATEWAY_API_KEY`, `AI_REPORT_MODEL`.

No secrets are committed; all live in the Convex/Vercel dashboards.

## Verification evidence

- `npm test` → **57 passing** (scoring engine, workbook reconciliation, activity aggregation, Excel export).
- Domain layer `tsc --strict` clean; all source files parse/format clean.
- Real sample Excel + PDF generated from the actual builders and independently re-opened (openpyxl / pypdf) without errors.
