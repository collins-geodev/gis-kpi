/**
 * Professional .xlsx builder (genuine workbook, not CSV). Node runtime only.
 * Sheets: Executive Summary · Team Scorecard · Individual KPI Detail ·
 * Activity Register · Evidence Register · Data Quality Issues ·
 * KPI Definitions & Methodology.
 *
 * Formatting: title bands, frozen headers, auto-filters, typed
 * numbers/dates/percentages, identifiers preserved as text, a visible 80-weight
 * note, print headers/footers, and spreadsheet-formula-injection-safe cells.
 */
import ExcelJS from "exceljs";
import type { ReportDataset } from "./types";

const COLORS = {
  navy: "FF07111F",
  slate: "FF0F172A",
  brand: "FFC00000",
  headerBg: "FFEEF2F7",
  white: "FFFFFFFF",
  muted: "FF64748B",
};

/** Defuse spreadsheet formula injection in a text cell. */
function safeText(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

interface Col<T> {
  header: string;
  width: number;
  set: (cell: ExcelJS.Cell, row: T) => void;
}

const text = <T>(header: string, width: number, pick: (r: T) => unknown): Col<T> => ({
  header,
  width,
  set: (cell, r) => {
    cell.value = safeText(pick(r));
    cell.alignment = { vertical: "top", wrapText: width > 40 };
  },
});

/** Identifier column: force text format so leading zeros survive. */
const idText = <T>(header: string, width: number, pick: (r: T) => unknown): Col<T> => ({
  header,
  width,
  set: (cell, r) => {
    cell.value = safeText(pick(r));
    cell.numFmt = "@";
  },
});

const number = <T>(header: string, width: number, pick: (r: T) => number): Col<T> => ({
  header,
  width,
  set: (cell, r) => {
    cell.value = pick(r);
    cell.numFmt = "#,##0.##";
    cell.alignment = { horizontal: "right" };
  },
});

const percentDecimal = <T>(
  header: string,
  width: number,
  pick: (r: T) => number | null,
): Col<T> => ({
  header,
  width,
  set: (cell, r) => {
    const v = pick(r);
    cell.value = v === null ? "—" : v;
    if (v !== null) cell.numFmt = "0%";
    cell.alignment = { horizontal: "right" };
  },
});

const dateCol = <T>(header: string, width: number, pick: (r: T) => number): Col<T> => ({
  header,
  width,
  set: (cell, r) => {
    cell.value = new Date(pick(r));
    cell.numFmt = "yyyy-mm-dd hh:mm";
  },
});

function addSheet<T>(
  wb: ExcelJS.Workbook,
  ds: ReportDataset,
  name: string,
  subtitle: string,
  columns: Col<T>[],
  rows: T[],
  stampMs: number,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: {
      orientation: columns.length > 5 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });
  const n = columns.length;

  // Title band.
  ws.mergeCells(1, 1, 1, n);
  const title = ws.getCell(1, 1);
  title.value = `${ds.meta.title} — ${name}`;
  title.font = { bold: true, size: 14, color: { argb: COLORS.white } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  // Subtitle band (scope, period, generated stamp, version, weight note).
  ws.mergeCells(2, 1, 2, n);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { italic: true, size: 10, color: { argb: COLORS.muted } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };

  // Header row.
  const header = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: COLORS.slate } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.muted } } };
    ws.getColumn(i + 1).width = c.width;
  });
  header.height = 18;

  // Data rows.
  rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    columns.forEach((c, ci) => c.set(row.getCell(ci + 1), r));
  });

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: n } };
  ws.headerFooter = {
    oddHeader: `&C&"Segoe UI"&8Powered by the GIS Team`,
    oddFooter: `&L&8CONFIDENTIAL — ${ds.meta.scopeLabel}&C&8${new Date(
      stampMs,
    ).toISOString()}&R&8Page &P of &N · v${ds.meta.reportVersion}`,
  };
  return ws;
}

export async function buildWorkbook(ds: ReportDataset, stampMs: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GIS KPI Performance Dashboard";
  wb.created = new Date(stampMs);
  wb.company = "Ikeja Electric — GIS Team";

  const subtitle = `${ds.meta.scopeLabel} · ${ds.meta.periodLabel} · generated ${new Date(
    stampMs,
  ).toISOString()} · report v${ds.meta.reportVersion} · ${ds.executiveSummary.weightWarning}`;

  // 1. Executive Summary — key/value layout.
  const summaryRows: { k: string; v: string | number }[] = [
    { k: "Scope", v: ds.meta.scopeLabel },
    { k: "Period", v: ds.meta.periodLabel },
    { k: "Performance year", v: ds.meta.year },
    { k: "Timezone", v: ds.meta.timezone },
    { k: "Employees", v: ds.executiveSummary.employees },
    { k: "KPI assignments", v: ds.executiveSummary.assignments },
    {
      k: "Configured weight total",
      v: `${ds.meta.configuredWeightTotal} / ${ds.meta.fullWeightTotal}`,
    },
    { k: "Normalization enabled", v: ds.meta.normalizationEnabled ? "Yes" : "No" },
    { k: "Open data-quality issues", v: ds.executiveSummary.dqOpen },
    { k: "Issues blocking scoring", v: ds.executiveSummary.dqBlockers },
    { k: "Scoring-blocked KPIs", v: ds.executiveSummary.scoringBlocked },
    { k: "Weight note", v: ds.executiveSummary.weightWarning },
  ];
  addSheet(
    wb,
    ds,
    "Executive Summary",
    subtitle,
    [
      text<{ k: string; v: string | number }>("Metric", 34, (r) => r.k),
      text<{ k: string; v: string | number }>("Value", 60, (r) => r.v),
    ],
    summaryRows,
    stampMs,
  );

  // 2. Team Scorecard.
  addSheet(
    wb,
    ds,
    "Team Scorecard",
    subtitle,
    [
      idText<ReportDataset["employees"][number]>("Employee ID", 14, (r) => r.employeeId),
      text<ReportDataset["employees"][number]>("Name", 30, (r) => r.name),
      text<ReportDataset["employees"][number]>("Job role", 34, (r) => r.jobRole),
      text<ReportDataset["employees"][number]>("Location", 20, (r) => r.location),
      number<ReportDataset["employees"][number]>("KPIs", 8, (r) => r.kpiCount),
      number<ReportDataset["employees"][number]>(
        "Configured weight",
        16,
        (r) => r.configuredWeight,
      ),
      number<ReportDataset["employees"][number]>(
        "Assigned score",
        14,
        (r) => r.assignedWeightScore,
      ),
      percentDecimal<ReportDataset["employees"][number]>(
        "Normalized",
        12,
        (r) => r.normalizedScore / 100,
      ),
      number<ReportDataset["employees"][number]>(
        "KPIs w/ data",
        12,
        (r) => r.itemsWithData,
      ),
    ],
    ds.employees,
    stampMs,
  );

  // 3. Individual KPI Detail.
  addSheet(
    wb,
    ds,
    "Individual KPI Detail",
    subtitle,
    [
      text<ReportDataset["kpis"][number]>("Employee", 26, (r) => r.employeeName),
      text<ReportDataset["kpis"][number]>("Objective", 50, (r) => r.objective),
      text<ReportDataset["kpis"][number]>("Metric", 50, (r) => r.metric),
      number<ReportDataset["kpis"][number]>("Weight", 9, (r) => r.weight),
      {
        header: "Target",
        width: 12,
        set: (cell, r: ReportDataset["kpis"][number]) => {
          cell.value = r.target;
          cell.numFmt = r.targetType === "percentage" ? "0%" : "#,##0.##";
          cell.alignment = { horizontal: "right" };
        },
      },
      text<ReportDataset["kpis"][number]>("Cadence", 12, (r) => r.frequency),
      text<ReportDataset["kpis"][number]>("Mode", 12, (r) => r.measurementMode),
      percentDecimal<ReportDataset["kpis"][number]>(
        "Attainment",
        12,
        (r) => r.cappedAttainment,
      ),
      number<ReportDataset["kpis"][number]>(
        "Contribution",
        13,
        (r) => r.weightedContribution,
      ),
      text<ReportDataset["kpis"][number]>("Status", 14, (r) => r.status),
      text<ReportDataset["kpis"][number]>("Blocked", 10, (r) =>
        r.scoringBlocked ? "Yes" : "",
      ),
      number<ReportDataset["kpis"][number]>("Src row", 9, (r) => r.sourceRowNumber),
    ],
    ds.kpis,
    stampMs,
  );

  // 4. Activity Register.
  addSheet(
    wb,
    ds,
    "Activity Register",
    subtitle,
    [
      text<ReportDataset["activities"][number]>("Employee", 26, (r) => r.employeeName),
      text<ReportDataset["activities"][number]>("KPI objective", 50, (r) => r.objective),
      text<ReportDataset["activities"][number]>("Period", 12, (r) => r.periodKey),
      text<ReportDataset["activities"][number]>("Activity", 40, (r) => r.title),
      dateCol<ReportDataset["activities"][number]>("Date", 20, (r) => r.activityAt),
      text<ReportDataset["activities"][number]>("Status", 14, (r) => r.status),
    ],
    ds.activities,
    stampMs,
  );

  // 5. Evidence Register.
  addSheet(
    wb,
    ds,
    "Evidence Register",
    subtitle,
    [
      text<ReportDataset["evidence"][number]>("Employee", 26, (r) => r.employeeName),
      text<ReportDataset["evidence"][number]>("KPI objective", 50, (r) => r.objective),
      text<ReportDataset["evidence"][number]>("Evidence", 34, (r) => r.title),
      text<ReportDataset["evidence"][number]>("Category", 20, (r) => r.category),
      text<ReportDataset["evidence"][number]>("Review status", 14, (r) => r.reviewStatus),
      text<ReportDataset["evidence"][number]>(
        "Confidentiality",
        16,
        (r) => r.confidentiality,
      ),
      dateCol<ReportDataset["evidence"][number]>("Uploaded", 20, (r) => r.uploadedAt),
    ],
    ds.evidence,
    stampMs,
  );

  // 6. Data Quality Issues.
  addSheet(
    wb,
    ds,
    "Data Quality Issues",
    subtitle,
    [
      text<ReportDataset["dataQualityIssues"][number]>("Category", 22, (r) => r.category),
      text<ReportDataset["dataQualityIssues"][number]>("Severity", 10, (r) => r.severity),
      text<ReportDataset["dataQualityIssues"][number]>("Status", 12, (r) => r.status),
      number<ReportDataset["dataQualityIssues"][number]>(
        "Src row",
        9,
        (r) => r.sourceRowNumber ?? 0,
      ),
      text<ReportDataset["dataQualityIssues"][number]>(
        "Employee",
        24,
        (r) => r.employeeName ?? "",
      ),
      text<ReportDataset["dataQualityIssues"][number]>(
        "Source value",
        34,
        (r) => r.sourceValue ?? "",
      ),
      text<ReportDataset["dataQualityIssues"][number]>(
        "Proposed value",
        34,
        (r) => r.proposedValue ?? "",
      ),
      text<ReportDataset["dataQualityIssues"][number]>("Reason", 60, (r) => r.reason),
      text<ReportDataset["dataQualityIssues"][number]>("Blocks scoring", 14, (r) =>
        r.blocksScoring ? "Yes" : "",
      ),
    ],
    ds.dataQualityIssues,
    stampMs,
  );

  // 7. KPI Definitions & Methodology.
  addSheet(
    wb,
    ds,
    "KPI Definitions & Methodology",
    subtitle,
    [
      text<ReportDataset["definitions"][number]>("Role", 34, (r) => r.role),
      text<ReportDataset["definitions"][number]>("KPI", 30, (r) => r.title),
      text<ReportDataset["definitions"][number]>(
        "Objective",
        50,
        (r) => r.canonicalObjective,
      ),
      text<ReportDataset["definitions"][number]>(
        "Metric / formula",
        50,
        (r) => r.canonicalMetric,
      ),
      text<ReportDataset["definitions"][number]>("Mode", 12, (r) => r.measurementMode),
      text<ReportDataset["definitions"][number]>("Direction", 14, (r) => r.direction),
      {
        header: "Target",
        width: 12,
        set: (cell, r: ReportDataset["definitions"][number]) => {
          cell.value = r.defaultTarget;
          cell.numFmt = r.targetType === "percentage" ? "0%" : "#,##0.##";
          cell.alignment = { horizontal: "right" };
        },
      },
      number<ReportDataset["definitions"][number]>("Weight", 9, (r) => r.defaultWeight),
      text<ReportDataset["definitions"][number]>(
        "Scoring notes",
        60,
        (r) => r.scoringNotes,
      ),
    ],
    ds.definitions,
    stampMs,
  );

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
