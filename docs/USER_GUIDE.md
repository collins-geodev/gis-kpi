# Employee & Reviewer Guide

## For employees

### See your KPIs
Once an admin links your account to your employee record, your five KPIs appear on **Activity Capture** and your **Individual Performance** page.

### Capture activity (`/activities`)
1. Pick the KPI you're reporting on.
2. Pick the period (e.g. August 2026).
3. Enter the inputs the KPI needs — the form adapts to the measurement mode:
   - **Ratio / integration:** numerator (achieved) and denominator (planned/total).
   - **SLA (24h / 2-business-day):** items within the threshold and total eligible items.
   - **Count (QA errors):** the count achieved.
   - **Reduction (reduce errors 20%):** prior-year baseline and current value.
   - **Rubric (innovation):** score and max (scored against an approved rubric).
4. Add a title and notes, then **Save**. Your measurement recomputes automatically.

### Attach evidence (KPI detail page)
Open a KPI (from Individual Performance) and use the **Evidence** panel to upload a file (≤ 25 MB) or attach a link. **Required evidence must be approved by a reviewer before your result becomes an official score.**

**Evidence counts only for the month it supports.** Proof approved for July does not complete August — each period needs its own.

- In **Activity Capture**, attachments automatically carry the period you are logging.
- On the **KPI page** or in the **Evidence Centre**, choose the month in **Evidence for**. Early in a month it defaults to the month just closed (where proof usually belongs) — check it before uploading.
- Quarterly and annual KPIs: evidence for any month inside the quarter/year counts toward it.
- Upload evidence before the period's deadline; late uploads still count but are flagged to your reviewer.
- Upload your own work. The same file submitted by two people is flagged to administrators.

### Read your score
On **Individual Performance** you'll see, per KPI: target, weight, attainment, contribution, and status. Your configured weight is **80 / 100** — the score is shown out of the true configured maximum and is never silently rebased to 100.

## For reviewers & managers

### Verify evidence
On a KPI detail page, **Approve** or **Reject** (reason required) each evidence item. Approving evidence updates the evidence-completeness of the period that evidence supports — and only that period.

### Approve a period (`/review`)
The queue lists provisional measurements by employee + period with readiness flags. **Approve period** is only enabled when every KPI is ready (required evidence approved for that period, no blocking data-quality issue). Approving freezes a reproducible score snapshot.

Evidence badges on each row are for **that row's period**:

| Badge | Meaning |
| --- | --- |
| **evidence ✓** | Approved evidence covers this period. |
| **evidence submitted (n)** + **Approve evidence** | Evidence for this period awaits review; the button approves only this period's items. |
| **no evidence for this period** | Nothing approved for this period. Hover to see which periods *do* have approved evidence — usually a sign it was tagged to the wrong month. |
| **evidence late (n)** | Evidence for this period arrived after its deadline (it still counts). |
| **duplicate evidence (n)** | *Admins only:* the same file was also uploaded by another employee. Check it in the Evidence Centre. |

### Send work back after approval
- **Reject** (on a pending row) returns every entry for that KPI and period — including already-approved ones — to the employee with your reason.
- **Return** (next to an approved entry in the row's *Self-reported* list) sends back just that entry. Other entries are untouched; the KPI re-enters the queue for re-approval, and the earlier frozen score stays on record until the period is approved again.
- Both require a reason, are audit-logged, and notify the employee. **Undo** after a reject restores the entries to *submitted*.

### Fair comparisons
Team comparisons always show role and configured weight — never compare people without that context.

## Accessibility & themes
The dashboard supports light/dark themes (toggle in the top bar), keyboard navigation, screen-reader labels, and respects reduced-motion. Charts include a **table alternative**.
