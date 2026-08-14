# Source-Data Reconciliation — 2026 KPI Baseline

**Source workbook:** `GIS 2026 PO Settings-3.xlsx` · sheet `KPI Template` · table range `A1:M90`
**Treated as:** the 2026 KPI *configuration* baseline (no performance history).
**Parsed:** verbatim into [`convex/lib/sourceRows.ts`](../convex/lib/sourceRows.ts) — every value preserved byte-for-byte (typos, stray quotes, the `×` sign, trailing spaces, the blank row‑32 frequency).

## Structural totals (verified by test)

| Check | Expected | Parsed | Status |
|---|---|---|---|
| KPI assignment rows | 75 | 75 | ✅ |
| Employees | 15 | 15 | ✅ |
| Job-role categories | 4 | 4 | ✅ |
| Blank separator rows | 14 | 14 | ✅ |
| Weight per employee | 80 (not 100) | 80 for all 15 | ✅ surfaced, not "fixed" |
| Rows per employee | 5 | 5 for all 15 | ✅ |
| `S/N` column | blank | blank (internal IDs generated) | ✅ |

**Role distribution:** 2 GIS Leads · 1 Geo Database Specialist · 3 GIS Specialists · 9 GIS Analysts.

**Frequency distribution:** Monthly 31 · Annually 15 · Daily 12 · Weekly 10 · Quarterly 6 · **blank 1**.
**Target-type distribution:** Percentage 44 · Number 31.
Percentages are stored as decimals (`0.2`, `1`) and formatted as `20%` / `100%` in UI + exports.

## Anomalies surfaced to the Data Quality queue (nothing silently corrected)

Every item below is created as an admin-approvable `dataQualityIssues` record with source value, proposed canonical value, reason, status, reviewer and timestamp. Detection is deterministic — see [`convex/lib/dataQuality.ts`](../convex/lib/dataQuality.ts) and the tests in [`reconciliation.test.ts`](../convex/lib/reconciliation.test.ts).

| Category | Count | Blocks scoring? | Detail |
|---|---|---|---|
| `weight_incomplete` | 15 | no | Each employee totals **80/100**. Resolve by adding a KPI, changing weights, or explicitly approving normalization (decision is audit-logged). |
| `missing_frequency` | 1 | **yes** | Row 32 (`IKD034794`, QA objective) has a blank cadence → proposes **Monthly** (matches the analyst QA template), pending admin approval. |
| `location_variant` | 5 | no | `Akowonjo BU` (rows 8–12, `IKD041386`) → canonical **`Akowonjo B/U`**; source retained. |
| `unit_mismatch` | 1 | **yes** | Row 16 (Geo-DB commercial-maintenance): metric reads "reduce errors by 20%" but is typed `Number`/`20`. Resolve target type before scoring. |
| `metric_mismatch` | 1 | **yes** | Row 54 (`IKD034543`) innovation objective carries the two-business-day integration metric by mistake. |
| `metric_truncated` | 1 | **yes** | Row 30 (`IKD034860`) innovation metric is cut off at "…enhancing the overall". |
| `metric_ambiguous` | 3 | **yes** | `GDB Folders` (row 17), `GIS Project Dashboard` (row 18), and the Geo-DB composite integrity rule (row 14, health-check completion + zero downtime). |
| `rubric_required` | 1 | **yes** | Technology-innovation KPIs are qualitative → require an approved business-impact rubric before final scoring. |
| `typo_normalization` | computed at import | no | Per-row objective/metric proposals: `oustanding`→`outstanding`, `Archieved`→`Achieved`, `maitenance`→`maintenance`, `assets.ts`→`assets`, `time timelines`→`timelines`, stray quotes stripped, `24`/`24hrs`/`24 hours` unified, duplicated punctuation collapsed. Source text is preserved verbatim; only the canonical layer changes, and only after approval. |

## Editable HR fields (not invented)

The workbook has job titles but no grade/level/manager/hierarchy. `employees` adds **editable** `grade`, `roleLevel`, `managerId`, `displayOrder` — all default to null/derived, never fabricated HR grades. Exact job titles are preserved.

## Canonical role KPI catalogue

The verbatim rows are mapped to role templates in [`convex/lib/catalogue.ts`](../convex/lib/catalogue.ts). Classification is driven by the **objective** (not the metric) so a mis-copied metric (row 54) still maps to the correct KPI while the mismatch is raised separately. Each role template totals weight 80, mirroring the source.
