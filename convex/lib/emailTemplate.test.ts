import { describe, expect, test } from "vitest";
import {
  buildKpiUpdateEmail,
  buildNoticeEmail,
  escapeHtml,
  type NoticeEmailInput,
} from "./emailTemplate";

const DASHBOARD = "https://gis-kpi.vercel.app";

/** Realistic sharing link: long, query-string, no spaces. */
const SHAREPOINT_URL =
  "https://ikejaelectric.sharepoint.com/sites/GISTeam/Shared%20Documents/Evidence/2026/10/October_Substation_Inspection_Batch_Report_Jubril_Oloyede_Final.pdf?web=1&e=Ab12Cd34&CT=1761868800&OR=ItemsView";

function notice(partial: Partial<NoticeEmailInput> = {}) {
  return buildNoticeEmail({
    recipientName: "Collins Adebayo",
    subject: "Notice",
    intro: "Hello there.",
    panelTitle: "Details",
    rows: [{ label: "Item", value: "Value" }],
    ctaLabel: "Open",
    ctaPath: "/kpi/1",
    dashboardUrl: DASHBOARD,
    ...partial,
  });
}

function evidenceSubmitted() {
  return notice({
    recipientName: "Collins Adebayo",
    subject: "Evidence awaiting review — Jubril Oloyede: October batch report",
    intro:
      "*Jubril Oloyede* submitted evidence for *Jubril Oloyede*'s KPI. It is now awaiting verification and approval.",
    panelTitle: "Evidence details",
    rows: [
      { label: "Evidence", value: "October batch report", strong: true },
      {
        label: "KPI objective",
        value: "Keep the GIS network model current for Ikeja North feeders",
      },
      { label: "Employee", value: "Jubril Oloyede (GIS/2026)" },
      { label: "Category", value: "batch_report" },
      { label: "File", value: SHAREPOINT_URL },
    ],
    ctaLabel: "Review in the dashboard",
    ctaPath: "/kpi/kpi_ikeja_north",
  });
}

/** Tags stripped, comments removed, &#8203; decoded to a real zero-width space. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8203;/g, "\u200B")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function maxTokenLength(text: string): number {
  return text.split(/[\s\u200B]+/).reduce((max, part) => Math.max(max, part.length), 0);
}

function assertReadableShell(html: string) {
  expect(html).toContain('width="600"');
  expect(html).toContain("max-width:600px");
  expect(html).toContain("width:100%");
  for (const color of ["#07111F", "#C00000", "#FFFFFF", "#F8FAFC"]) {
    expect(html).toContain(`bgcolor="${color}"`);
    expect(html).toContain(`background-color:${color}`);
  }
  expect(html).toContain("word-break:break-word");
  expect(html).toContain("overflow-wrap:anywhere");
  expect(html).toContain("word-wrap:break-word");
  expect(html).not.toContain("white-space:nowrap");
  expect(html).toContain('lang="en"');
  expect(html).toContain("width=device-width");
  expect(html).toContain("x-apple-disable-message-reformatting");
  expect(html).toContain("<o:PixelsPerInch>96</o:PixelsPerInch>");
  expect(html).toContain("Ikeja Electric · GIS Team · Technical Services");
  expect(html).toContain("GIS KPI Performance Dashboard");
  expect(html).toContain("◈ POWERED BY THE GIS TEAM ◈");
  expect(html).toContain("Confidential — intended for the addressee only.");
  expect(html).toContain("Segoe UI");

  const anchorRe = /<a\b[^>]*href="[^"]+"/g;
  let foundRedCta = false;
  for (const match of html.matchAll(anchorRe)) {
    const before = html.slice(0, match.index ?? 0);
    const tdAt = before.lastIndexOf("<td");
    const td = before.slice(tdAt);
    if (td.includes('bgcolor="#C00000"') && td.includes("background-color:#C00000")) {
      foundRedCta = true;
    }
  }
  expect(foundRedCta).toBe(true);
  expect(maxTokenLength(visibleText(html))).toBeLessThanOrEqual(40);
}

describe("notice emails", () => {
  test("a SharePoint file URL stays a short link and the shell stays readable", () => {
    expect(SHAREPOINT_URL).not.toMatch(/\s/);
    expect(SHAREPOINT_URL.length).toBeGreaterThan(40);

    const { html, text, subject } = evidenceSubmitted();
    expect(subject).toBe(
      "Evidence awaiting review — Jubril Oloyede: October batch report",
    );
    expect(html).toContain(`href="${escapeHtml(SHAREPOINT_URL)}"`);
    expect(html).toContain(">Open file</a>");
    expect(visibleText(html).toLowerCase()).not.toContain("sharepoint");
    expect(text).toContain(SHAREPOINT_URL);
    expect(text).toContain("File: " + SHAREPOINT_URL);
    assertReadableShell(html);
    expect(html).toContain(">Review in the dashboard →</a>");
  });

  test("approved, rejected, and period-approved notices share the shell", () => {
    const slug = "missing-georeferenced-boundary-for-ikeja-north-feeder";
    expect(slug.length).toBeGreaterThan(40);
    expect(slug).not.toMatch(/\s/);

    const approved = notice({
      subject: "Your evidence was approved — October batch report",
      intro:
        "*Ada Lovelace* has approved the evidence “October batch report”. It now counts toward the evidence gate for official scoring.",
      panelTitle: "Review decision",
      rows: [
        { label: "Evidence", value: "October batch report" },
        {
          label: "KPI objective",
          value: "Keep the GIS network model current for Ikeja North feeders",
        },
        { label: "Decision", value: "APPROVED", strong: true },
      ],
      ctaLabel: "Open in the dashboard",
      ctaPath: "/kpi/kpi_ikeja_north",
    });
    const rejected = notice({
      subject: "Your evidence was rejected — October batch report",
      intro:
        "*Ada Lovelace* has rejected the evidence “October batch report”. See the reviewer's comment below, then update and re-submit.",
      panelTitle: "Review decision",
      rows: [
        { label: "Evidence", value: "October batch report" },
        {
          label: "KPI objective",
          value: "Keep the GIS network model current for Ikeja North feeders",
        },
        { label: "Decision", value: "REJECTED", strong: true },
        { label: "Reviewer comment", value: `Returned: ${slug}` },
      ],
      ctaLabel: "Open in the dashboard",
      ctaPath: "/kpi/kpi_ikeja_north",
    });
    const periodApproved = notice({
      subject: "Your 2026-10 scorecard was approved — 86.5 / 100",
      intro:
        "*Ada Lovelace* approved your 2026-10 performance (“Consistent field updates”). Your official score is frozen in a reproducible, auditable snapshot.",
      panelTitle: "Approved scorecard",
      rows: [
        { label: "Period", value: "2026-10" },
        { label: "Official score", value: "86.5 / 100", strong: true },
        { label: "Normalized score", value: "87%" },
        { label: "Evidence completion", value: "100%" },
        { label: "Approved by", value: "Ada Lovelace" },
      ],
      ctaLabel: "View your scorecard",
      ctaPath: "/employees/emp_jubril",
    });

    for (const email of [approved, rejected, periodApproved]) {
      assertReadableShell(email.html);
    }
    expect(rejected.html).toContain(`${slug.slice(0, 40)}&#8203;<wbr>`);
    expect(rejected.html).not.toContain(slug);
    expect(rejected.text).toContain(slug);
    expect(approved.text).toContain("Decision: APPROVED");
    expect(periodApproved.text).toContain("Official score: 86.5 / 100");
  });

  test("a 120-character filename is soft-broken and not linked", () => {
    const filename = "Q4_substation_inspection_batch_report_".repeat(4).slice(0, 120);
    expect(filename).toHaveLength(120);
    const { html } = notice({
      rows: [{ label: "File", value: filename }],
    });
    expect(html).toContain(
      `${filename.slice(0, 40)}&#8203;<wbr>${filename.slice(40, 80)}&#8203;<wbr>${filename.slice(80)}`,
    );
    expect(html).toContain("<wbr>");
    expect(html).toContain("&#8203;");
    expect(html).not.toContain("Open file");
    expect(maxTokenLength(visibleText(html))).toBeLessThanOrEqual(40);
  });

  test("names and values with markup and quotes are escaped", () => {
    const recipientName = `Collins <script>alert("x")</script>`;
    const value = `Note <script>alert('y')</script>`;
    const { html, text } = notice({
      recipientName,
      rows: [{ label: "Label <b>", value }],
      intro: "Plain intro",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
    expect(html).toContain("&#39;y&#39;");
    expect(html).toContain("Label &lt;b&gt;");
    expect(text).toContain(recipientName);
    expect(text).toContain(value);
  });

  test("soft breaks do not split HTML entities", () => {
    const value = `${"a".repeat(39)}<${"b".repeat(39)}`;
    const { html } = notice({ rows: [{ label: "Note", value }] });
    expect(html).toContain(`${"a".repeat(39)}&lt;&#8203;<wbr>${"b".repeat(39)}`);
    expect(html).not.toContain("&lt&#8203;");
    expect(html).not.toContain("&l&#8203;");
  });

  test("asterisk markers in the intro become strong", () => {
    const { html, text } = notice({
      intro: "*Jubril Oloyede* submitted evidence for *Jubril Oloyede*'s KPI.",
    });
    expect(html).toContain("<strong>Jubril Oloyede</strong>");
    expect(html).not.toContain("*Jubril Oloyede*");
    expect(text).toContain("Jubril Oloyede submitted evidence for Jubril Oloyede's KPI.");
    expect(text).not.toContain("*");
  });

  test("javascript URLs are not hrefs", () => {
    const quoted = 'javascript:alert("xss")';
    const long = `javascript:${"A".repeat(50)}`;
    const { html } = notice({
      rows: [
        { label: "File", value: quoted },
        { label: "Link", value: long },
      ],
    });
    expect(html.toLowerCase()).not.toMatch(/href\s*=\s*["']javascript:/);
    expect(html).not.toContain("Open file");
    expect(html).not.toContain("Open link");
    expect(html).toContain("javascript:");
    expect(html).toContain("&quot;xss&quot;");
    expect(html).toContain(`javascript:${"A".repeat(29)}&#8203;<wbr>`);
    expect(maxTokenLength(visibleText(html))).toBeLessThanOrEqual(40);
  });

  test("a URL embedded in a sentence is wrapped, not replaced", () => {
    const url =
      "https://ikejaelectric.sharepoint.com/sites/GISTeam/SharedDocuments/October_Batch_Report_Final.pdf";
    const value = `Stored at ${url} for the audit.`;
    const { html, text } = notice({
      rows: [{ label: "File", value }],
    });
    expect(html).not.toContain("Open file");
    expect(html).not.toContain("Open link");
    expect(html).not.toContain(`href="${escapeHtml(url)}"`);
    expect(html).toContain("<wbr>");
    expect(html).toContain("&#8203;");
    expect(html).toContain(`${url.slice(0, 40)}&#8203;<wbr>`);
    expect(text).toContain(url);
    expect(maxTokenLength(visibleText(html))).toBeLessThanOrEqual(40);
  });

  test("a non-file http URL becomes Open link, and FILE is case-insensitive", () => {
    const url = "https://ikejaelectric.sharepoint.com/sites/GISTeam/portal";
    const file = notice({ rows: [{ label: "FILE", value: url }] });
    const other = notice({ rows: [{ label: "Portal", value: url }] });
    expect(file.html).toContain(">Open file</a>");
    expect(file.html).not.toContain(">Open link</a>");
    expect(other.html).toContain(">Open link</a>");
    expect(other.html).not.toContain(">Open file</a>");
    expect(other.text).toContain(url);
  });
});

describe("KPI update emails", () => {
  const objective =
    "MaintainSubstationGeodatabaseAccuracyAboveTheAgreedQuarterlyThresholdForIkejaNorth";

  function kpi(variant: "admin" | "self" | "employee") {
    return buildKpiUpdateEmail({
      variant,
      recipientName: "Collins Adebayo",
      actorName: "Ada Lovelace",
      employeeName: "Jubril Oloyede",
      employeeBusinessId: "GIS/2026",
      objective,
      activityTitle: "Field inspection",
      periodKey: "2026-10",
      attainmentPct: "90%",
      statusLabel: "Watch",
      dashboardUrl: DASHBOARD,
      kpiPath: "/kpi/abc",
    });
  }

  test("subjects and plain-text bodies stay the same, and a long objective wraps", () => {
    expect(objective.length).toBeGreaterThan(40);
    expect(objective).not.toMatch(/\s/);

    const admin = kpi("admin");
    const self = kpi("self");
    const employee = kpi("employee");

    expect(admin.subject).toBe("KPI update — Jubril Oloyede: Field inspection");
    expect(employee.subject).toBe("A KPI update was logged for you — Field inspection");
    expect(self.subject).toBe("Your KPI update was recorded — Field inspection");

    expect(admin.text).toBe(`Hello Collins Adebayo,

Ada Lovelace logged a KPI update for Jubril Oloyede (GIS/2026).

Activity: Field inspection
KPI objective: ${objective}
Period: 2026-10
Provisional attainment: 90%
Status: Watch

Open in the dashboard: https://gis-kpi.vercel.app/kpi/abc

Powered by the GIS Team`);
    expect(employee.text).toContain(
      "Ada Lovelace logged a KPI update on your behalf. Your provisional measurement was recomputed.",
    );
    expect(self.text).toContain(
      "Your KPI update was recorded and your provisional measurement recomputed.",
    );

    for (const email of [admin, self, employee]) {
      assertReadableShell(email.html);
      expect(email.html).toContain(`${objective.slice(0, 40)}&#8203;<wbr>`);
      expect(email.html).not.toContain(objective);
      expect(email.text).toContain(objective);
      expect(email.html).toContain(">Open in the dashboard →</a>");
    }
    expect(admin.html).toContain(
      "<strong>Ada Lovelace</strong> logged a KPI update for <strong>Jubril Oloyede</strong> (GIS/2026).",
    );
    expect(employee.html).toContain(
      "<strong>Ada Lovelace</strong> logged a KPI update on your behalf.",
    );
    expect(self.html).toContain(
      "Your KPI update was recorded successfully and your provisional measurement has been recomputed.",
    );
  });
});
