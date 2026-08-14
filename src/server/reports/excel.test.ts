import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildWorkbook } from "./excel";
import type { ReportDataset } from "./types";

const STAMP = 1_755_000_000_000; // fixed for deterministic tests

const fixture: ReportDataset = {
  meta: {
    title: "GIS KPI Report",
    scope: "team",
    scopeRef: "team",
    scopeLabel: "GIS Unit — Team",
    periodKey: "2026-M08",
    periodLabel: "August 2026",
    year: 2026,
    timezone: "Africa/Lagos",
    configuredWeightTotal: 80,
    fullWeightTotal: 100,
    normalizationEnabled: false,
    reportVersion: 1,
  },
  executiveSummary: {
    employees: 1,
    assignments: 5,
    scoringBlocked: 1,
    dqOpen: 3,
    dqBlockers: 1,
    weightWarning: "Configured weight totals 80 / 100 per employee.",
  },
  employees: [
    {
      employeeId: "IKD030835",
      name: "Timothy Olutayo Olugbenro",
      jobRole: "Geographic Information Systems Lead",
      location: "Shomolu B/U",
      configuredWeight: 80,
      assignedWeightScore: 70,
      normalizedScore: 87.5,
      itemsWithData: 4,
      kpiCount: 5,
    },
  ],
  kpis: [
    {
      employeeId: "IKD030835",
      employeeName: "Timothy Olutayo Olugbenro",
      objective: "Full integration of GIS data…",
      metric: "Verified integrated assets / planned",
      weight: 20,
      target: 1,
      targetType: "percentage",
      frequency: "Monthly",
      measurementMode: "ratio",
      cappedAttainment: 0.9,
      weightedContribution: 18,
      status: "watch",
      scoringBlocked: false,
      sourceRowNumber: 3,
    },
  ],
  activities: [
    {
      employeeName: "Timothy Olutayo Olugbenro",
      objective: "Full integration…",
      periodKey: "2026-M08",
      title: "Integrated feeder assets",
      activityAt: STAMP,
      status: "submitted",
    },
  ],
  evidence: [
    {
      employeeName: "Timothy Olutayo Olugbenro",
      objective: "Full integration…",
      title: "QA log",
      category: "qa_log",
      reviewStatus: "approved",
      confidentiality: "internal",
      uploadedAt: STAMP,
    },
  ],
  dataQualityIssues: [
    {
      category: "location_variant",
      severity: "info",
      status: "proposed",
      sourceRowNumber: 8,
      employeeName: "Oladipupo Olanrewaju Eboda",
      field: "location",
      sourceValue: '=HYPERLINK("http://evil")', // formula-injection attempt
      proposedValue: "Akowonjo B/U",
      reason: "Normalize Akowonjo BU",
      blocksScoring: false,
    },
  ],
  definitions: [
    {
      role: "Geographic Information Systems Lead",
      title: "Full GIS network-asset data integration",
      canonicalObjective: "Full integration of GIS data…",
      canonicalMetric: "Verified integrated assets / planned",
      measurementMode: "ratio",
      direction: "higherIsBetter",
      targetType: "percentage",
      defaultTarget: 1,
      frequency: "Monthly",
      defaultWeight: 20,
      scoringNotes: "Ratio numerator/denominator.",
    },
  ],
};

describe("buildWorkbook", () => {
  it("produces a valid .xlsx with all seven sheets that reopens without errors", async () => {
    const buf = await buildWorkbook(fixture, STAMP);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      "Executive Summary",
      "Team Scorecard",
      "Individual KPI Detail",
      "Activity Register",
      "Evidence Register",
      "Data Quality Issues",
      "KPI Definitions & Methodology",
    ]);
  });

  it("preserves identifiers as text (leading zeros safe)", async () => {
    const buf = await buildWorkbook(fixture, STAMP);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Team Scorecard")!;
    const idCell = ws.getCell(4, 1); // first data row, Employee ID
    expect(idCell.value).toBe("IKD030835");
    expect(idCell.numFmt).toBe("@");
  });

  it("types percentages as percent cells", async () => {
    const buf = await buildWorkbook(fixture, STAMP);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Team Scorecard")!;
    const normalized = ws.getCell(4, 8); // Normalized column
    expect(normalized.numFmt).toBe("0%");
    expect(normalized.value).toBeCloseTo(0.875, 5);
  });

  it("neutralizes spreadsheet formula injection", async () => {
    const buf = await buildWorkbook(fixture, STAMP);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Data Quality Issues")!;
    const srcVal = ws.getCell(4, 6); // Source value column
    expect(String(srcVal.value).startsWith("'")).toBe(true);
  });

  it("freezes the header row on each sheet", async () => {
    const buf = await buildWorkbook(fixture, STAMP);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) {
      expect(ws.views?.[0]?.state).toBe("frozen");
    }
  });
});
