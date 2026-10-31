/**
 * Branded, email-client-safe HTML templates (table layout, inline styles).
 * Pure functions — unit-testable, no Convex imports. All user-authored text is
 * HTML-escaped before it reaches the template.
 *
 * Outlook's Word engine ignores max-width and overflow-wrap, then scales the
 * whole message down when one unbreakable string (a SharePoint URL, a hash, a
 * filename) forces the table wider than 600px. The shell therefore uses a
 * hybrid width: an MSO ghost table fixed at 600px for Word, and max-width
 * plus width:100% for everyone else. Whole-value http(s) URLs become short
 * links; other long tokens get a zero-width space and <wbr> so Word can wrap.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface KpiUpdateEmailInput {
  /**
   * "admin" = sent to an oversight member; "self" = sent to the person who
   * logged it; "employee" = sent to the employee the KPI belongs to when
   * someone else logged the update on their behalf.
   */
  variant: "admin" | "self" | "employee";
  recipientName: string;
  actorName: string;
  employeeName: string;
  employeeBusinessId: string;
  objective: string;
  activityTitle: string;
  periodKey: string;
  attainmentPct: string; // preformatted, e.g. "90%" or "—"
  statusLabel: string; // e.g. "Watch"
  dashboardUrl: string;
  kpiPath: string; // e.g. "/kpi/<id>"
}

const NAVY = "#07111F";
const SLATE = "#0F172A";
const RED = "#C00000";
const CYAN = "#0891B2";
const MUTED = "#64748B";
const BG = "#F1F5F9";
const PANEL = "#F8FAFC";
const WHITE = "#FFFFFF";
const FONT = "'Segoe UI',Arial,Helvetica,sans-serif";
/** Shrinks min-content in Chromium (new Outlook, Gmail). Word needs <wbr> too. */
const WRAP = "word-break:break-word;overflow-wrap:anywhere;word-wrap:break-word;";
const BREAK_EVERY = 40;
/** ZWSP entity then <wbr>. Inserted after escaping so a chunk never splits an entity. */
const SOFT = "&#8203;<wbr>";
const HTTP_URL = /^https?:\/\/\S+$/i;

const DEFAULT_FOOTNOTE =
  "This is an automated notification from the GIS KPI Performance Dashboard.";

/**
 * Escape `raw` and, for any run of more than 40 non-space characters, insert
 * a break opportunity every 40 characters. Breaks are chosen on the raw
 * string first so `&lt;` / `&quot;` are never cut in half, and they are never
 * placed inside an attribute — callers must not run this on an href.
 */
function softBreak(raw: string): string {
  return raw
    .split(/(\s+)/)
    .map((part) => {
      if (part.length === 0 || /^\s+$/.test(part) || part.length <= BREAK_EVERY) {
        return escapeHtml(part);
      }
      let out = "";
      for (let i = 0; i < part.length; i += BREAK_EVERY) {
        if (i > 0) out += SOFT;
        out += escapeHtml(part.slice(i, i + BREAK_EVERY));
      }
      return out;
    })
    .join("");
}

/** `*bold*` markers become <strong>. Each side is escaped and soft-broken. */
function formatInline(raw: string): string {
  const re = /\*([^*]+)\*/g;
  let html = "";
  let last = 0;
  for (const match of raw.matchAll(re)) {
    const index = match.index ?? 0;
    html += softBreak(raw.slice(last, index));
    html += `<strong>${softBreak(match[1] ?? "")}</strong>`;
    last = index + match[0].length;
  }
  html += softBreak(raw.slice(last));
  return html;
}

function isFileLabel(label: string): boolean {
  return label.trim().toLowerCase() === "file";
}

/**
 * A row value that is nothing but an http(s) URL is shown as a short link so
 * the raw URL cannot stretch the table. "File" reads "Open file"; any other
 * label reads "Open link". javascript: and other schemes stay plain text.
 * The href is escaped and is not soft-broken.
 */
function formatValueHtml(label: string, value: string): string {
  const trimmed = value.trim();
  if (HTTP_URL.test(trimmed)) {
    const text = isFileLabel(label) ? "Open file" : "Open link";
    return `<a href="${escapeHtml(trimmed)}" style="color:${CYAN};text-decoration:underline;${WRAP}">${text}</a>`;
  }
  return softBreak(value);
}

/** One labelled row inside the details panel. `label` and `valueHtml` are safe HTML. */
function detailRow(label: string, valueHtml: string): string {
  const labelStyle = `width:38%;padding:8px 14px;border-bottom:1px solid #E2E8F0;font-family:${FONT};font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.4px;${WRAP}`;
  const valueStyle = `width:62%;padding:8px 14px;border-bottom:1px solid #E2E8F0;font-family:${FONT};font-size:14px;color:${SLATE};${WRAP}`;
  return `
    <tr>
      <td align="left" valign="top" width="38%" style="${labelStyle}">${label}</td>
      <td align="left" valign="top" width="62%" style="${valueStyle}">${valueHtml}</td>
    </tr>`;
}

/**
 * Bulletproof button. Modern clients pad the anchor. Outlook Word ignores
 * padding on anchors, so an MSO-only cell carries the same padding — Word
 * never sees both, and the padding is not doubled.
 */
function renderCta(url: string, label: string): string {
  const href = escapeHtml(url);
  const text = `${softBreak(label)} →`;
  return `
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" width="100%">
            <tr>
              <td align="center" style="padding:22px 0 0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td align="center" bgcolor="${RED}" style="background-color:${RED};border-radius:8px;">
                      <!--[if mso]>
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td align="center" bgcolor="${RED}" style="background-color:${RED};padding:12px 28px;">
                      <![endif]-->
                      <a href="${href}" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.2;color:${WHITE};text-decoration:none;border-radius:8px;background-color:${RED};">${text}</a>
                      <!--[if mso]>
                      </td></tr></table>
                      <![endif]-->
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`;
}

/** Shared branded chrome (header, red rule, card, CTA, footer). */
function renderShell(opts: {
  recipientNameHtml: string;
  introHtml: string;
  panelTitleHtml: string;
  rowsHtml: string;
  ctaUrl: string;
  ctaLabel: string;
  footnoteHtml: string;
}): string {
  const textCell = `font-family:${FONT};${WRAP}`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:${FONT};">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background-color:${BG};">
    <tr>
      <td align="center" style="padding:24px 0;">
        <!--[if mso]>
        <table role="presentation" align="center" width="600" border="0" cellpadding="0" cellspacing="0"><tr><td width="600" align="left">
        <![endif]-->
        <div style="max-width:600px;width:100%;margin:0 auto;${WRAP}">
          <table role="presentation" id="email-card" align="center" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="max-width:600px;width:100%;border-collapse:separate;border-spacing:0;${textCell}">
            <tr>
              <td align="left" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:12px 12px 0 0;padding:26px 32px 22px;${textCell}">
                <div style="font-size:11px;letter-spacing:2px;color:#94A3B8;text-transform:uppercase;${WRAP}">Ikeja Electric · GIS Team · Technical Services</div>
                <div style="font-size:22px;font-weight:700;color:${WHITE};margin-top:6px;${WRAP}">GIS KPI Performance Dashboard</div>
              </td>
            </tr>
            <tr>
              <td align="left" bgcolor="${RED}" style="background-color:${RED};height:4px;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td align="left" bgcolor="${WHITE}" style="background-color:${WHITE};padding:30px 32px;${textCell}">
                <p align="left" style="margin:0 0 6px;font-size:15px;line-height:1.5;color:${SLATE};${textCell}">Hello ${opts.recipientNameHtml},</p>
                <p align="left" style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${SLATE};${textCell}">${opts.introHtml}</p>
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:100%;table-layout:fixed;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;box-sizing:border-box;">
                  <colgroup>
                    <col style="width:38%" width="38%" />
                    <col style="width:62%" width="62%" />
                  </colgroup>
                  <tr>
                    <td colspan="2" align="left" bgcolor="${PANEL}" style="background-color:${PANEL};padding:10px 14px;font-family:${FONT};font-size:12px;font-weight:700;color:${CYAN};text-transform:uppercase;letter-spacing:.6px;${WRAP}">${opts.panelTitleHtml}</td>
                  </tr>
                  ${opts.rowsHtml}
                </table>
                ${renderCta(opts.ctaUrl, opts.ctaLabel)}
                <p align="left" style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};${textCell}">${opts.footnoteHtml}</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:0 0 12px 12px;padding:16px 32px;${textCell}">
                <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#FCA5A5;text-align:center;">◈ POWERED BY THE GIS TEAM ◈</div>
                <div style="font-size:11px;color:#64748B;margin-top:6px;text-align:center;">Confidential — intended for the addressee only.</div>
              </td>
            </tr>
          </table>
        </div>
        <!--[if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface NoticeEmailInput {
  recipientName: string;
  subject: string;
  /** Plain-text intro sentence(s); names may be wrapped in *asterisks* for bold. */
  intro: string;
  panelTitle: string;
  rows: { label: string; value: string; strong?: boolean }[];
  ctaLabel: string;
  ctaPath: string;
  dashboardUrl: string;
  footnote?: string;
}

/**
 * Generic branded notification (evidence submitted, decisions, approvals,
 * reminders, password and OTP). All content is escaped; `*bold*` markers in
 * the intro become <strong>. Plain text keeps raw row values, including URLs.
 */
export function buildNoticeEmail(input: NoticeEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const rowsHtml = input.rows
    .map((r) => {
      const valueHtml = formatValueHtml(r.label, r.value);
      return detailRow(
        softBreak(r.label),
        r.strong ? `<strong>${valueHtml}</strong>` : valueHtml,
      );
    })
    .join("");
  const ctaUrl = `${input.dashboardUrl.replace(/\/$/, "")}${input.ctaPath}`;
  const html = renderShell({
    recipientNameHtml: softBreak(input.recipientName),
    introHtml: formatInline(input.intro),
    panelTitleHtml: softBreak(input.panelTitle),
    rowsHtml,
    ctaUrl,
    ctaLabel: input.ctaLabel,
    footnoteHtml: softBreak(input.footnote ?? DEFAULT_FOOTNOTE),
  });

  const text = [
    `Hello ${input.recipientName},`,
    "",
    input.intro.replace(/\*/g, ""),
    "",
    ...input.rows.map((r) => `${r.label}: ${r.value}`),
    "",
    `${input.ctaLabel}: ${ctaUrl}`,
    "",
    "Powered by the GIS Team",
  ].join("\n");

  return { subject: input.subject, html, text };
}

const KPI_FOOTNOTE =
  "Provisional numbers come from the deterministic scoring engine. Official scores require approved evidence and reviewer sign-off. This is an automated notification from the GIS KPI Performance Dashboard.";

export function buildKpiUpdateEmail(input: KpiUpdateEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject =
    input.variant === "admin"
      ? `KPI update — ${input.employeeName}: ${input.activityTitle}`
      : input.variant === "employee"
        ? `A KPI update was logged for you — ${input.activityTitle}`
        : `Your KPI update was recorded — ${input.activityTitle}`;

  const actor = softBreak(input.actorName);
  const employee = softBreak(input.employeeName);
  const businessId = softBreak(input.employeeBusinessId);
  const introHtml =
    input.variant === "admin"
      ? `<strong>${actor}</strong> logged a KPI update for <strong>${employee}</strong> (${businessId}). The measurement was recomputed by the deterministic scoring engine and is awaiting review.`
      : input.variant === "employee"
        ? `<strong>${actor}</strong> logged a KPI update on your behalf. Your provisional measurement has been recomputed and now moves to evidence verification and review.`
        : `Your KPI update was recorded successfully and your provisional measurement has been recomputed. It now moves to evidence verification and review.`;

  const rowsHtml = [
    detailRow("Activity", `<strong>${softBreak(input.activityTitle)}</strong>`),
    detailRow("KPI objective", softBreak(input.objective)),
    detailRow(
      "Employee",
      `${employee} <span style="color:${MUTED};">(${businessId})</span>`,
    ),
    detailRow("Period", softBreak(input.periodKey)),
    detailRow(
      "Provisional attainment",
      `<strong>${softBreak(input.attainmentPct)}</strong>`,
    ),
    detailRow("Status", softBreak(input.statusLabel)),
  ].join("");

  const ctaUrl = `${input.dashboardUrl.replace(/\/$/, "")}${input.kpiPath}`;
  const html = renderShell({
    recipientNameHtml: softBreak(input.recipientName),
    introHtml,
    panelTitleHtml: "KPI update details",
    rowsHtml,
    ctaUrl,
    ctaLabel: "Open in the dashboard",
    footnoteHtml: softBreak(KPI_FOOTNOTE),
  });

  const text = [
    `Hello ${input.recipientName},`,
    "",
    input.variant === "admin"
      ? `${input.actorName} logged a KPI update for ${input.employeeName} (${input.employeeBusinessId}).`
      : input.variant === "employee"
        ? `${input.actorName} logged a KPI update on your behalf. Your provisional measurement was recomputed.`
        : "Your KPI update was recorded and your provisional measurement recomputed.",
    "",
    `Activity: ${input.activityTitle}`,
    `KPI objective: ${input.objective}`,
    `Period: ${input.periodKey}`,
    `Provisional attainment: ${input.attainmentPct}`,
    `Status: ${input.statusLabel}`,
    "",
    `Open in the dashboard: ${ctaUrl}`,
    "",
    "Powered by the GIS Team",
  ].join("\n");

  return { subject, html, text };
}
