/* GIS KPI Dashboard — 8-slide workflow deck in the IE SwitchTrace template. */
const pptxgen = require("pptxgenjs");

const RED = "C00000";
const DARK = "1D1A16";
const SLATE = "2E3A4A";
const GRAY = "6E6A64";
const LINE = "B4ACA2";
const ORANGE = "ED7D31", ORANGE_F = "FDF0E6";
const GREEN = "0E7C66", GREEN_F = "E1F1EC";
const AMBER = "7A5A00", AMBER_F = "FFF7DD";
const SLATE_F = "ECEFF3";
const RED_F = "FBECEC";
const CARD_BORDER = "E4E0DA";
const FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

function contentSlide(title, subtitle) {
  const s = pres.addSlide();
  s.background = { path: "bg-content.png" };
  s.addText(title, {
    x: 0.62, y: 0.44, w: 10.4, h: 0.86,
    fontFace: FONT, fontSize: 33, bold: true, color: RED, align: "left", margin: 0, valign: "middle",
  });
  s.addText(subtitle, {
    x: 0.64, y: 1.34, w: 11.6, h: 0.5,
    fontFace: FONT, fontSize: 15.5, color: SLATE, align: "left", margin: 0, valign: "middle",
  });
  return s;
}

// Rounded node card with mono-style heading + small sub-line.
function node(s, x, y, w, h, fill, color, head, sub, opts = {}) {
  s.addShape("roundRect", {
    x, y, w, h, fill: { color: fill }, line: { color, width: 1.2 }, rectRadius: 0.07,
  });
  const rows = [
    { text: head, options: { fontSize: opts.headSize || 12, bold: true, color, breakLine: true } },
  ];
  if (sub) rows.push({ text: sub, options: { fontSize: opts.subSize || 9.5, color: GRAY } });
  s.addText(rows, {
    x, y, w, h, align: "center", valign: "middle", fontFace: FONT, margin: 0.04, lineSpacingMultiple: 1.05,
  });
}

// vertical connector
function vline(s, x, y, h) {
  s.addShape("line", { x, y, w: 0, h, line: { color: LINE, width: 1.5, endArrowType: "triangle" } });
}

// numbered step card
function step(s, x, y, w, h, n, head, sub) {
  s.addShape("roundRect", {
    x, y, w, h, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.07,
  });
  s.addShape("roundRect", { x: x + 0.14, y: y + 0.16, w: 0.34, h: 0.3, fill: { color: RED }, rectRadius: 0.05 });
  s.addText(String(n), { x: x + 0.14, y: y + 0.16, w: 0.34, h: 0.3, align: "center", valign: "middle", fontFace: "Consolas", fontSize: 12, bold: true, color: "FFFFFF", margin: 0 });
  s.addText(
    [
      { text: head, options: { fontSize: 12.5, bold: true, color: DARK, breakLine: true } },
      { text: sub, options: { fontSize: 9.8, color: GRAY } },
    ],
    { x: x + 0.14, y: y + 0.5, w: w - 0.28, h: h - 0.62, align: "left", valign: "top", fontFace: FONT, margin: 0, lineSpacingMultiple: 1.08 },
  );
}

// small colored chip
function chip(s, x, y, w, text, color, fill) {
  s.addShape("roundRect", { x, y, w, h: 0.34, fill: { color: fill }, line: { color, width: 1.2 }, rectRadius: 0.06 });
  s.addText(text, { x, y, w, h: 0.34, align: "center", valign: "middle", fontFace: FONT, fontSize: 10.5, bold: true, color, margin: 0 });
}

/* ============ SLIDE 1 — TITLE ============ */
{
  const s = pres.addSlide();
  s.background = { path: "bg-title.png" };
  s.addText("IKEJA ELECTRIC PLC  ·  GIS TEAM", {
    x: 6.3, y: 2.62, w: 6.4, h: 0.32, align: "right", fontFace: FONT,
    fontSize: 13, bold: true, color: GRAY, charSpacing: 3, margin: 0, valign: "middle",
  });
  s.addText("GIS KPI Dashboard", {
    x: 6.3, y: 2.98, w: 6.4, h: 1.0, align: "right", fontFace: FONT,
    fontSize: 47, bold: true, color: RED, margin: 0, valign: "middle",
  });
  s.addText("Application & Performance Workflow", {
    x: 6.3, y: 4.06, w: 6.4, h: 0.5, align: "right", fontFace: FONT,
    fontSize: 21, bold: true, italic: true, color: DARK, margin: 0, valign: "middle",
  });
  s.addText("Auditable, role-based KPI performance management for the GIS Team — Technical Services", {
    x: 6.3, y: 4.62, w: 6.4, h: 0.62, align: "right", fontFace: FONT,
    fontSize: 13, color: GRAY, margin: 0, valign: "middle",
  });
  s.addText([
    { text: "Collins Anyanwu", options: { bold: true, color: DARK } },
    { text: "   ·   GIS Team, Ikeja Electric Plc", options: { color: GRAY } },
  ], {
    x: 6.3, y: 5.42, w: 6.4, h: 0.36, align: "right", fontFace: FONT, fontSize: 12.5, margin: 0, valign: "middle",
  });
}

/* ============ SLIDE 2 — OVERVIEW ============ */
{
  const s = contentSlide("Overview", "One dashboard, one backend — every score reproducible from activity and evidence.");
  s.addText(
    "The GIS KPI Dashboard digitises how the GIS Team plans, measures and proves performance. Every employee carries five core KPIs from the approved 2026 workbook plus four shared non-core KPIs — 100 weighted points in all; every result is backed by captured activity and reviewable evidence; every official score is frozen as a reproducible snapshot.",
    { x: 0.64, y: 1.95, w: 5.0, h: 1.75, fontFace: FONT, fontSize: 13.5, color: SLATE, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.12 },
  );
  s.addText(
    [
      { text: "Management Dashboard", options: { bold: true, color: DARK, breakLine: true } },
      { text: "Team performance, review queue, analytics, data quality & audit.", options: { color: GRAY, breakLine: true } },
      { text: "", options: { breakLine: true, fontSize: 6 } },
      { text: "Employee Workspace", options: { bold: true, color: DARK, breakLine: true } },
      { text: "Capture activity, attach evidence, track your own score.", options: { color: GRAY, breakLine: true } },
      { text: "", options: { breakLine: true, fontSize: 6 } },
      { text: "Reports & Exports", options: { bold: true, color: DARK, breakLine: true } },
      { text: "Deterministic Excel & PDF — the optional AI narrative only explains.", options: { color: GRAY } },
    ],
    { x: 0.64, y: 3.72, w: 5.05, h: 2.6, fontFace: FONT, fontSize: 12.5, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.08 },
  );

  node(s, 6.35, 2.0, 1.95, 1.15, ORANGE_F, ORANGE, "EMPLOYEES", "Capture · evidence", { headSize: 11 });
  node(s, 8.5, 2.0, 1.95, 1.15, GREEN_F, GREEN, "REVIEWERS", "Verify · approve", { headSize: 11 });
  node(s, 10.65, 2.0, 1.95, 1.15, RED_F, RED, "ADMINS", "Configure · audit", { headSize: 11 });
  vline(s, 7.33, 3.15, 0.62); vline(s, 9.47, 3.15, 0.62); vline(s, 11.62, 3.15, 0.62);
  node(s, 6.35, 3.77, 6.25, 1.15, SLATE_F, SLATE, "CONVEX BACKEND — SINGLE SOURCE OF TRUTH", "KPI catalogue · activities · evidence · approvals · snapshots · audit log", { headSize: 12 });
  vline(s, 9.47, 4.92, 0.5);
  node(s, 7.55, 5.42, 3.85, 0.72, AMBER_F, AMBER, "In-app · email notifications", null, { headSize: 11 });
}

/* ============ SLIDE 3 — ROLES & ACCESS ============ */
{
  const s = contentSlide("Roles & Access", "Seven application roles, least-privilege by design — enforced server-side in every backend function.");
  const roles = [
    ["SA", "System Admin", "Org, users & thresholds; the only role that locks periods or overrides — with reason."],
    ["KA", "KPI Admin", "Owns the catalogue: targets, weights, formulas, imports and the data-quality queue."],
    ["MG", "Manager", "Scoped team view; verifies evidence, approves scores and periods for their people."],
    ["RV", "Reviewer", "Verifies evidence and recommends scores in scope; never approves periods."],
    ["EM", "Employee", "Captures activity on their own five KPIs and attaches the evidence behind it."],
    ["EV", "Executive Viewer", "Read-only — and only approved results; provisional numbers are never final."],
    ["AU", "Auditor", "Reads the audit log and score lineage; evidence metadata only."],
  ];
  const W = 3.02, H = 1.5, GX = 0.16, GY = 0.24, X0 = 0.64, Y0 = 2.0;
  roles.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = X0 + col * (W + GX), y = Y0 + row * (H + GY);
    s.addShape("roundRect", { x, y, w: W, h: H, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.07 });
    s.addShape("roundRect", { x: x + 0.14, y: y + 0.16, w: 0.46, h: 0.34, fill: { color: RED_F }, line: { color: RED, width: 1 }, rectRadius: 0.05 });
    s.addText(r[0], { x: x + 0.14, y: y + 0.16, w: 0.46, h: 0.34, align: "center", valign: "middle", fontFace: "Consolas", fontSize: 11, bold: true, color: RED, margin: 0 });
    s.addText(r[1], { x: x + 0.7, y: y + 0.16, w: W - 0.84, h: 0.34, align: "left", valign: "middle", fontFace: FONT, fontSize: 12.5, bold: true, color: DARK, margin: 0 });
    s.addText(r[2], { x: x + 0.14, y: y + 0.56, w: W - 0.28, h: H - 0.68, align: "left", valign: "top", fontFace: FONT, fontSize: 9.6, color: GRAY, margin: 0, lineSpacingMultiple: 1.05 });
  });
  // Note card fills the empty 8th grid cell's row space, below both rows.
  s.addText(
    [
      { text: "Application roles ≠ job roles.  ", options: { bold: true, color: RED } },
      { text: "Dashboard permissions are separate from roster job roles — granting Reviewer never changes anyone's KPI targets. Managers and reviewers can be scoped by employee, job role or location.", options: { color: SLATE } },
    ],
    { x: 0.64, y: 5.6, w: 11.9, h: 0.85, fontFace: FONT, fontSize: 11.5, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.1 },
  );
}

/* ============ SLIDE 4 — KPI CATALOGUE ============ */
{
  const s = contentSlide("KPI Catalogue", "From the approved 2026 workbook to a living, versioned catalogue — nothing silently corrected.");
  const stats = [
    ["75", "Core KPI assignments"],
    ["15", "GIS Team employees"],
    ["4", "Job-role templates"],
    ["100", "Points per person (80 core + 20 non-core)"],
  ];
  stats.forEach((t, i) => {
    const x = 0.64 + i * 3.06;
    s.addShape("roundRect", { x, y: 2.0, w: 2.88, h: 1.5, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
    s.addText(t[0], { x, y: 2.12, w: 2.88, h: 0.8, align: "center", valign: "middle", fontFace: FONT, fontSize: 40, bold: true, color: RED, margin: 0 });
    s.addText(t[1], { x, y: 2.95, w: 2.88, h: 0.4, align: "center", valign: "top", fontFace: FONT, fontSize: 11.5, color: GRAY, margin: 0 });
  });
  s.addShape("roundRect", { x: 0.64, y: 3.85, w: 5.9, h: 1.85, fill: { color: "FAF6F0" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "Verbatim source layer", options: { bold: true, color: DARK, breakLine: true } },
      { text: "Every workbook row is preserved exactly as written and mapped to a canonical, computable definition. Any anomaly — a blank frequency, a spelling variant, a unit mismatch — becomes an admin-approvable data-quality issue.", options: { color: SLATE } },
    ],
    { x: 0.85, y: 4.02, w: 5.5, h: 1.55, fontFace: FONT, fontSize: 11.8, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.12 },
  );
  s.addShape("roundRect", { x: 6.78, y: 3.85, w: 5.9, h: 1.85, fill: { color: RED_F }, line: { color: RED, width: 1.2 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "Core 80 + non-core 20 = 100", options: { bold: true, color: RED, breakLine: true } },
      { text: "The workbook's five core weights total 80 points, preserved verbatim. The remaining 20 points come from four shared non-core KPIs adopted from the 2025 workbook by an explicit, audit-logged decision — core and non-core labelled apart on every scorecard.", options: { color: SLATE } },
    ],
    { x: 6.99, y: 4.02, w: 5.5, h: 1.55, fontFace: FONT, fontSize: 11.8, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.12 },
  );
  s.addText("Five core KPIs per employee plus four shared non-core KPIs — safety hazard reporting, compliance recertification, internal customer satisfaction and training hours (5 points each). Definitions are versioned; old scores keep the rules they were approved under.",
    { x: 0.64, y: 5.95, w: 12.0, h: 0.6, fontFace: FONT, fontSize: 11.5, color: GRAY, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.1 });
}

/* ============ SLIDE 5 — CAPTURE & EVIDENCE ============ */
{
  const s = contentSlide("Capture & Evidence", "Mode-tailored forms — and no official score without approved evidence.");
  step(s, 0.64, 2.0, 2.9, 1.5, 1, "Pick KPI & period", "Only the employee's own assignments are offered.");
  step(s, 3.72, 2.0, 2.9, 1.5, 2, "Enter the inputs", "The form asks exactly what the measurement mode needs — never a typed-in percentage.");
  step(s, 6.8, 2.0, 2.9, 1.5, 3, "Save", "Autosaved and duplicate-warned; the provisional measurement recomputes instantly.");
  step(s, 9.88, 2.0, 2.9, 1.5, 4, "Attach evidence", "Files ≤ 25 MB or links — categorised, versioned, tied to the measurement.");

  s.addText("MEASUREMENT MODES", { x: 0.64, y: 3.85, w: 4.0, h: 0.3, fontFace: "Consolas", fontSize: 10.5, bold: true, color: GRAY, charSpacing: 2, margin: 0, valign: "middle" });
  const modes = ["Ratio", "Duration / SLA", "Count", "Reduction", "Milestone", "Binary", "Rubric", "Composite"];
  modes.forEach((m, i) => {
    chip(s, 0.64 + i * 1.55, 4.2, 1.42, m, SLATE, SLATE_F);
  });

  s.addShape("roundRect", { x: 0.64, y: 4.95, w: 12.14, h: 1.15, fill: { color: RED_F }, line: { color: RED, width: 1.2 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "The evidence gate.  ", options: { bold: true, color: RED } },
      { text: "A reviewer approves or rejects each evidence item — rejection carries a written reason back to the employee. A KPI that requires evidence cannot be approved into an official score until its evidence is approved, and every restricted download is logged.", options: { color: SLATE } },
    ],
    { x: 0.9, y: 5.12, w: 11.6, h: 0.85, fontFace: FONT, fontSize: 12, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.12 },
  );
}

/* ============ SLIDE 6 — REVIEW, APPROVAL & SCORING ============ */
{
  const s = contentSlide("Review, Approval & Scoring", "Approval freezes a reproducible snapshot — the engine scores, the AI only explains.");
  step(s, 0.64, 2.0, 2.9, 1.5, 1, "Provisional", "Measurements recompute live as activity lands.");
  step(s, 3.72, 2.0, 2.9, 1.5, 2, "Verify", "Reviewer checks the claim, the activity and the evidence.");
  step(s, 6.8, 2.0, 2.9, 1.5, 3, "Approve period", "Enabled only when evidence is approved and no data-quality issue blocks.");
  step(s, 9.88, 2.0, 2.9, 1.5, 4, "Snapshot frozen", "Calc version + inputs — the same number recomputes months later.");

  s.addShape("roundRect", { x: 0.64, y: 3.8, w: 12.14, h: 0.72, fill: { color: "FAF8F5" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.07 });
  s.addText(
    [
      { text: "attainment = f(mode, inputs, target, direction)", options: { color: DARK } },
      { text: "   →   ", options: { color: GRAY } },
      { text: "clamp(0 … cap)", options: { color: DARK } },
      { text: "   →   ", options: { color: GRAY } },
      { text: "× weight points", options: { color: DARK } },
      { text: "   →   ", options: { color: GRAY } },
      { text: "Σ over all KPIs (out of 100)", options: { color: RED, bold: true } },
    ],
    { x: 0.9, y: 3.8, w: 11.6, h: 0.72, fontFace: "Consolas", fontSize: 12, align: "left", margin: 0, valign: "middle" },
  );

  s.addText("STATUS BANDS", { x: 0.64, y: 4.75, w: 4.0, h: 0.3, fontFace: "Consolas", fontSize: 10.5, bold: true, color: GRAY, charSpacing: 2, margin: 0, valign: "middle" });
  chip(s, 0.64, 5.1, 1.9, "On / Above Target", GREEN, GREEN_F);
  chip(s, 2.7, 5.1, 1.3, "Watch", AMBER, AMBER_F);
  chip(s, 4.16, 5.1, 1.3, "At Risk", ORANGE, ORANGE_F);
  chip(s, 5.62, 5.1, 1.3, "Critical", RED, RED_F);
  chip(s, 7.08, 5.1, 1.3, "No Data", GRAY, "F4F1EC");

  s.addText(
    [
      { text: "Overrides & recalls — never quiet.  ", options: { bold: true, color: RED } },
      { text: "An override requires a written reason and keeps the engine's number alongside; rejections and period approvals can be recalled via a post-action Undo. Everything is audit-logged, and locked periods accept no further change.", options: { color: SLATE } },
    ],
    { x: 0.64, y: 5.75, w: 11.8, h: 0.7, fontFace: FONT, fontSize: 11.5, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.1 },
  );
}

/* ============ SLIDE 7 — ANALYTICS & REPORTS ============ */
{
  const s = contentSlide("Analytics & Reports", "Three altitudes of oversight — all reading from the same approved snapshots.");
  const cards = [
    ["Executive Overview", "Approved team score out of 100 (core + non-core labelled apart), workflow posture, evidence coverage, overdue periods and the review backlog."],
    ["Team Performance", "Sortable scorecards with role and location comparison — always labelled with job role and configured weight, so comparisons stay fair."],
    ["Individual Performance", "One employee's KPIs: target, actual, attainment, weight, contribution — plus timeline, evidence gallery, score history and per-employee analytics with peer context."],
  ];
  cards.forEach((c, i) => {
    const x = 0.64 + i * 4.12;
    s.addShape("roundRect", { x, y: 2.0, w: 3.94, h: 1.95, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
    s.addText(
      [
        { text: c[0], options: { bold: true, color: DARK, fontSize: 13.5, breakLine: true } },
        { text: c[1], options: { color: GRAY, fontSize: 10.8 } },
      ],
      { x: x + 0.18, y: 2.16, w: 3.58, h: 1.65, fontFace: FONT, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.1 },
    );
  });
  s.addText(
    [
      { text: "Analytics workbench — ", options: { bold: true, color: DARK } },
      { text: "trends, target-vs-actual, contribution waterfall, person × KPI heatmap, backlog ageing and score distributions. Every chart has a table alternative; every filter is a shareable URL.", options: { color: SLATE } },
    ],
    { x: 0.64, y: 4.25, w: 12.0, h: 0.75, fontFace: FONT, fontSize: 12, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.1 },
  );
  s.addShape("roundRect", { x: 0.64, y: 5.05, w: 12.14, h: 1.15, fill: { color: "FAF6F0" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "Reports with provenance.  ", options: { bold: true, color: RED } },
      { text: "A 7-sheet typed Excel workbook and a deterministic PDF with embedded engine-drawn charts (weighted-score and attainment bars by status band) — plus an optional AI narrative that only explains the engine's numbers, ships with a disclaimer and approval status, and records provider, model and prompt version in the audit log.", options: { color: SLATE } },
    ],
    { x: 0.9, y: 5.22, w: 11.6, h: 0.85, fontFace: FONT, fontSize: 12, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.12 },
  );
}

/* ============ SLIDE 8 — CLOSING ============ */
{
  const s = contentSlide("A single, auditable trail", "From a day's work to a defensible score — every step attributable, timestamped and reviewable.");
  const chain = ["Capture", "Measure", "Evidence", "Approve", "Snapshot", "Report"];
  chain.forEach((c, i) => {
    const x = 0.64 + i * 2.05;
    node(s, x, 2.1, 1.75, 0.66, i === 4 ? GREEN_F : SLATE_F, i === 4 ? GREEN : SLATE, c, null, { headSize: 12 });
    if (i < chain.length - 1) {
      s.addText("→", { x: x + 1.75, y: 2.1, w: 0.3, h: 0.66, align: "center", valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: LINE, margin: 0 });
    }
  });

  s.addShape("roundRect", { x: 0.64, y: 3.2, w: 5.9, h: 1.3, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "MANAGEMENT DASHBOARD", options: { fontFace: "Consolas", fontSize: 9.5, bold: true, color: GRAY, charSpacing: 2, breakLine: true } },
      { text: "gis-kpi.vercel.app", options: { fontFace: "Consolas", fontSize: 15, bold: true, color: RED, breakLine: true } },
      { text: "Overview · Team · Review · Analytics · Reports · Audit", options: { fontSize: 10.5, color: GRAY } },
    ],
    { x: 0.85, y: 3.34, w: 5.5, h: 1.05, fontFace: FONT, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.18 },
  );
  s.addShape("roundRect", { x: 6.78, y: 3.2, w: 5.9, h: 1.3, fill: { color: "FFFFFF" }, line: { color: CARD_BORDER, width: 1 }, rectRadius: 0.08 });
  s.addText(
    [
      { text: "EMPLOYEE WORKSPACE", options: { fontFace: "Consolas", fontSize: 9.5, bold: true, color: GRAY, charSpacing: 2, breakLine: true } },
      { text: "gis-kpi.vercel.app/activities", options: { fontFace: "Consolas", fontSize: 15, bold: true, color: RED, breakLine: true } },
      { text: "Activity Capture · Evidence · Individual Performance · Profile", options: { fontSize: 10.5, color: GRAY } },
    ],
    { x: 6.99, y: 3.34, w: 5.5, h: 1.05, fontFace: FONT, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.18 },
  );

  chip(s, 0.64, 4.85, 1.95, "Evidence-backed", GREEN, GREEN_F);
  chip(s, 2.75, 4.85, 2.35, "Deterministically scored", ORANGE, ORANGE_F);
  chip(s, 5.26, 4.85, 2.15, "Audited & exportable", RED, RED_F);

  s.addText(
    [
      { text: "Prepared by   ", options: { fontFace: "Consolas", fontSize: 10, bold: true, color: GRAY, charSpacing: 2 } },
      { text: "Collins Anyanwu", options: { fontSize: 14, bold: true, color: DARK } },
      { text: "   ·   GIS Team, Ikeja Electric Plc", options: { fontSize: 12, color: GRAY } },
    ],
    { x: 0.64, y: 5.6, w: 9.0, h: 0.45, fontFace: FONT, align: "left", margin: 0, valign: "middle" },
  );
}

pres.writeFile({ fileName: "gis-kpi-workflow-deck.pptx" }).then(() => console.log("deck written"));
