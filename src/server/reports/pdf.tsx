/**
 * Deterministic PDF report (Node runtime). All numbers come from the frozen
 * dataset (scoring engine); the optional AI narrative only explains them and is
 * clearly marked with a disclaimer + human-approval status.
 */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ReportDataset } from "./types";
import type { ReportNarrative } from "./narrative";

const C = {
  navy: "#07111F",
  slate: "#0F172A",
  brand: "#C00000",
  teal: "#0891B2",
  muted: "#64748B",
  light: "#F1F5F9",
  border: "#E2E8F0",
  white: "#FFFFFF",
  green: "#15803D",
  amber: "#B45309",
  red: "#B91C1C",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontSize: 9,
    color: C.slate,
  },
  coverPage: {
    backgroundColor: C.navy,
    color: C.white,
    padding: 48,
    justifyContent: "space-between",
  },
  coverTitle: { fontSize: 26, fontWeight: 700, marginTop: 140 },
  coverSub: { fontSize: 12, color: "#93C5FD", marginTop: 8 },
  coverMetaBox: {
    marginTop: 28,
    borderTopWidth: 2,
    borderTopColor: C.brand,
    paddingTop: 12,
  },
  coverMetaRow: { flexDirection: "row", marginBottom: 4 },
  coverMetaLabel: { width: 150, color: "#94A3B8", fontSize: 10 },
  coverMetaValue: { fontSize: 10, color: C.white },
  weightBanner: {
    marginTop: 18,
    backgroundColor: "#7F1D1D",
    padding: 10,
    borderRadius: 4,
  },
  poweredBy: { color: "#94A3B8", fontSize: 10, letterSpacing: 1 },
  h1: { fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 8 },
  h2: { fontSize: 11, fontWeight: 700, color: C.teal, marginTop: 14, marginBottom: 5 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4 },
  bullet: { fontSize: 9, lineHeight: 1.4, marginBottom: 2, marginLeft: 8 },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  stat: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    padding: 8,
    width: 120,
  },
  statLabel: { fontSize: 7, color: C.muted, textTransform: "uppercase" },
  statValue: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.light,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    paddingVertical: 3,
    minHeight: 14,
  },
  th: {
    fontSize: 7.5,
    fontWeight: 700,
    color: C.slate,
    paddingHorizontal: 3,
    textTransform: "uppercase",
  },
  td: { fontSize: 8, paddingHorizontal: 3 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 5,
    fontSize: 7,
    color: C.muted,
  },
  disclaimer: {
    backgroundColor: "#FEF9C3",
    borderColor: "#FDE68A",
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
    fontSize: 8,
    color: "#713F12",
  },
});

const fmtPct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const fmtTarget = (v: number, t: string) =>
  t === "percentage" ? `${Math.round(v * 100)}%` : String(v);

function Footer({ ds, stampMs }: { ds: ReportDataset; stampMs: number }) {
  return (
    <View style={s.footer} fixed>
      <Text>CONFIDENTIAL · {ds.meta.scopeLabel}</Text>
      <Text>Powered by the GIS Team</Text>
      <Text
        render={({ pageNumber, totalPages }) =>
          `${new Date(stampMs).toISOString().slice(0, 16).replace("T", " ")} · v${ds.meta.reportVersion} · Page ${pageNumber}/${totalPages}`
        }
      />
    </View>
  );
}

function Table<T>({
  columns,
  rows,
}: {
  columns: {
    header: string;
    width: number;
    get: (r: T) => string;
    color?: (r: T) => string;
  }[];
  rows: T[];
}) {
  return (
    <View>
      <View style={s.tableHeader}>
        {columns.map((c, i) => (
          <Text key={i} style={[s.th, { width: `${c.width}%` }]}>
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View style={s.tableRow} key={ri} wrap={false}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[
                s.td,
                { width: `${c.width}%` },
                c.color ? { color: c.color(r) } : {},
              ]}
            >
              {c.get(r)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function statusColor(status: string): string {
  if (status === "on_target") return C.green;
  if (status === "watch") return C.teal;
  if (status === "at_risk") return C.amber;
  if (status === "critical") return C.red;
  return C.muted;
}

/** Colour for a 0–1 attainment fraction using the default status bands. */
function bandColor(frac: number | null): string {
  if (frac === null) return C.muted;
  if (frac >= 1) return C.green;
  if (frac >= 0.9) return C.teal;
  if (frac >= 0.75) return C.amber;
  return C.red;
}

const cs = StyleSheet.create({
  chartRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  chartLabel: { width: "30%", fontSize: 7.5, paddingRight: 4, color: C.slate },
  chartTrack: {
    flexGrow: 1,
    height: 7,
    backgroundColor: C.light,
    borderRadius: 3.5,
    overflow: "hidden",
  },
  chartFill: { height: 7, borderRadius: 3.5 },
  chartValue: {
    width: "13%",
    fontSize: 7.5,
    textAlign: "right",
    paddingLeft: 4,
    color: C.slate,
  },
  chartLegend: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 2 },
  chartLegendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  chartLegendSwatch: { width: 6, height: 6, borderRadius: 3 },
  chartLegendText: { fontSize: 6.5, color: C.muted },
});

/**
 * Deterministic horizontal bar chart rendered with plain Views — every width
 * comes straight from engine-computed numbers (no drawing library involved).
 */
function PdfBarChart({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; frac: number | null; valueLabel: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <View>
      <Text style={s.h2}>{title}</Text>
      <View style={cs.chartLegend}>
        {[
          ["≥100%", C.green],
          ["90–99%", C.teal],
          ["75–89%", C.amber],
          ["<75%", C.red],
          ["No data", C.muted],
        ].map(([label, color]) => (
          <View key={label} style={cs.chartLegendItem}>
            <View style={[cs.chartLegendSwatch, { backgroundColor: color }]} />
            <Text style={cs.chartLegendText}>{label}</Text>
          </View>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={cs.chartRow} wrap={false}>
          <Text style={cs.chartLabel}>{r.label}</Text>
          <View style={cs.chartTrack}>
            <View
              style={[
                cs.chartFill,
                {
                  width: `${Math.min(Math.max((r.frac ?? 0) * 100, 0), 100)}%`,
                  backgroundColor: bandColor(r.frac),
                },
              ]}
            />
          </View>
          <Text style={cs.chartValue}>{r.valueLabel}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <View wrap={false}>
      <Text style={s.h2}>{title}</Text>
      {items.map((it, i) => (
        <Text key={i} style={s.bullet}>
          • {it}
        </Text>
      ))}
    </View>
  );
}

export async function buildReportPdf(
  ds: ReportDataset,
  narrative: ReportNarrative | null,
  stampMs: number,
  aiApproved = false,
): Promise<Buffer> {
  const doc = (
    <Document title={ds.meta.title} author="GIS KPI Dashboard">
      {/* Cover */}
      <Page size="A4" style={s.coverPage}>
        <Text style={s.poweredBy}>IKEJA ELECTRIC · GIS UNIT · TECHNICAL SERVICES</Text>
        <View>
          <Text style={s.coverTitle}>{ds.meta.title}</Text>
          <Text style={s.coverSub}>{ds.meta.scopeLabel}</Text>
          <View style={s.coverMetaBox}>
            {[
              ["Period", ds.meta.periodLabel],
              ["Performance year", String(ds.meta.year)],
              ["Timezone", ds.meta.timezone],
              ["Generated", new Date(stampMs).toISOString()],
              ["Report version", `v${ds.meta.reportVersion}`],
              ["Normalization", ds.meta.normalizationEnabled ? "Enabled" : "Disabled"],
            ].map(([k, v]) => (
              <View style={s.coverMetaRow} key={k}>
                <Text style={s.coverMetaLabel}>{k}</Text>
                <Text style={s.coverMetaValue}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={s.weightBanner}>
            <Text style={{ fontSize: 10 }}>
              ⚠ Configured weight {ds.meta.configuredWeightTotal} /{" "}
              {ds.meta.fullWeightTotal} per employee. Scores are never rebased to 100
              without an explicit, labelled normalization.
            </Text>
          </View>
        </View>
        <Text style={s.poweredBy}>Powered by the GIS Team</Text>
      </Page>

      {/* Executive summary + scorecard */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Executive Summary</Text>
        <View style={s.statRow}>
          <Stat label="Employees" value={String(ds.executiveSummary.employees)} />
          <Stat label="KPI assignments" value={String(ds.executiveSummary.assignments)} />
          <Stat
            label="Scoring-blocked KPIs"
            value={String(ds.executiveSummary.scoringBlocked)}
          />
          <Stat label="Open DQ issues" value={String(ds.executiveSummary.dqOpen)} />
          <Stat
            label="Blocking DQ issues"
            value={String(ds.executiveSummary.dqBlockers)}
          />
        </View>

        {narrative ? (
          <>
            <View style={s.disclaimer}>
              <Text>
                AI-assisted narrative — explains engine-computed numbers only, does not
                determine scores. Human approval: {aiApproved ? "APPROVED" : "PENDING"}.
              </Text>
            </View>
            <Text style={s.p}>{narrative.executiveSummary}</Text>
            <Section title="Achievements" items={narrative.achievements} />
            <Section title="Performance drivers" items={narrative.performanceDrivers} />
          </>
        ) : (
          <Text style={s.p}>
            AI narrative not generated for this report. The tables below are the
            deterministic, engine-computed record.
          </Text>
        )}

        <Text style={s.h2}>Team scorecard</Text>
        <Table
          columns={[
            {
              header: "Employee",
              width: 26,
              get: (r: ReportDataset["employees"][number]) => r.name,
            },
            { header: "Role", width: 24, get: (r) => r.jobRole },
            { header: "Location", width: 16, get: (r) => r.location },
            { header: "Cfg wt", width: 9, get: (r) => `${r.configuredWeight}/100` },
            { header: "Score", width: 10, get: (r) => String(r.assignedWeightScore) },
            { header: "Norm", width: 9, get: (r) => `${Math.round(r.normalizedScore)}%` },
            { header: "Data", width: 6, get: (r) => `${r.itemsWithData}/${r.kpiCount}` },
          ]}
          rows={ds.employees}
        />
        <PdfBarChart
          title="Weighted score vs configured maximum"
          rows={ds.employees.map((e) => ({
            label: e.name,
            frac:
              e.itemsWithData === 0 || e.configuredWeight === 0
                ? null
                : e.assignedWeightScore / e.configuredWeight,
            valueLabel:
              e.itemsWithData === 0
                ? "no data"
                : `${e.assignedWeightScore}/${e.configuredWeight}`,
          }))}
        />
        <Footer ds={ds} stampMs={stampMs} />
      </Page>

      {/* KPI detail */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>KPI Detail — target · attainment · contribution</Text>
        <Table
          columns={[
            {
              header: "Employee",
              width: 20,
              get: (r: ReportDataset["kpis"][number]) => r.employeeName,
            },
            { header: "Objective", width: 34, get: (r) => r.objective },
            { header: "Wt", width: 6, get: (r) => String(r.weight) },
            { header: "Target", width: 9, get: (r) => fmtTarget(r.target, r.targetType) },
            { header: "Attain", width: 9, get: (r) => fmtPct(r.cappedAttainment) },
            { header: "Contrib", width: 9, get: (r) => String(r.weightedContribution) },
            {
              header: "Status",
              width: 13,
              get: (r) => r.status,
              color: (r) => statusColor(r.status),
            },
          ]}
          rows={ds.kpis.slice(0, 120)}
        />
        <PdfBarChart
          title="Attainment by KPI (measured KPIs, top 16 by weight)"
          rows={ds.kpis
            .filter((k) => k.cappedAttainment !== null)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 16)
            .map((k) => ({
              label: `${k.employeeName.split(" ")[0]} · ${k.objective.slice(0, 34)}`,
              frac: k.cappedAttainment,
              valueLabel: fmtPct(k.cappedAttainment),
            }))}
        />
        <Footer ds={ds} stampMs={stampMs} />
      </Page>

      {/* Risks, recommendations, evidence, methodology */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Risks, Actions & Methodology</Text>
        {narrative && (
          <>
            <Section title="Risks & weak evidence" items={narrative.risks} />
            <Section title="Data gaps" items={narrative.dataGaps} />
            <Section
              title="Evidence-backed observations"
              items={narrative.evidenceObservations}
            />
            <Section title="Recommended actions" items={narrative.recommendedActions} />
            <Section title="Coaching suggestions" items={narrative.coachingSuggestions} />
          </>
        )}

        <Text style={s.h2}>
          Data-quality gaps (top {Math.min(ds.dataQualityIssues.length, 12)})
        </Text>
        <Table
          columns={[
            {
              header: "Category",
              width: 22,
              get: (r: ReportDataset["dataQualityIssues"][number]) => r.category,
            },
            { header: "Sev", width: 10, get: (r) => r.severity },
            {
              header: "Row",
              width: 8,
              get: (r) => (r.sourceRowNumber ? String(r.sourceRowNumber) : "—"),
            },
            { header: "Reason", width: 48, get: (r) => r.reason },
            { header: "Blocks", width: 12, get: (r) => (r.blocksScoring ? "Yes" : "") },
          ]}
          rows={ds.dataQualityIssues.slice(0, 12)}
        />

        <Text style={s.h2}>Evidence index (top {Math.min(ds.evidence.length, 12)})</Text>
        {ds.evidence.length === 0 ? (
          <Text style={s.p}>No evidence in scope for this period.</Text>
        ) : (
          <Table
            columns={[
              {
                header: "Employee",
                width: 26,
                get: (r: ReportDataset["evidence"][number]) => r.employeeName,
              },
              { header: "Evidence", width: 34, get: (r) => r.title },
              { header: "Category", width: 20, get: (r) => r.category },
              { header: "Status", width: 20, get: (r) => r.reviewStatus },
            ]}
            rows={ds.evidence.slice(0, 12)}
          />
        )}

        <Text style={s.h2}>Methodology & scoring</Text>
        <Text style={s.p}>
          attainment = f(mode, inputs, target, direction); cappedAttainment =
          clamp(attainment, 0, officialCap 100%); weightedContribution = cappedAttainment
          × weight; assignedWeightScore = Σ contributions (out of the true configured
          maximum, {ds.meta.configuredWeightTotal}); normalizedScore = assignedWeightScore
          / configured × 100 (shown {ds.meta.normalizationEnabled ? "with" : "without"}{" "}
          normalization enabled). Ratio KPIs aggregate numerators/denominators; zero
          denominator or missing baseline reads as No Data. Percentages are decimals.
          Timezone {ds.meta.timezone}.
        </Text>
        {narrative && <Text style={s.p}>{narrative.methodologyNotes}</Text>}
        {narrative && narrative.citations.length > 0 && (
          <Text style={[s.p, { color: C.muted }]}>
            Citations: {narrative.citations.join("; ")}
          </Text>
        )}
        <Footer ds={ds} stampMs={stampMs} />
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}
