/**
 * Branded, email-client-safe HTML templates (table layout, inline styles).
 * Pure functions — unit-testable, no Convex imports. All user-authored text is
 * HTML-escaped before it reaches the template.
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
  /** "admin" = sent to a System Admin; "self" = sent to the person who logged it. */
  variant: "admin" | "self";
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

/** One labelled row inside the details panel. */
function detailRow(label: string, valueHtml: string): string {
  return `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">${label}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #E2E8F0;font-size:14px;color:${SLATE};">${valueHtml}</td>
    </tr>`;
}

/** Shared branded chrome (header, red rule, card, CTA, footer). */
function renderShell(opts: {
  recipientName: string; // escaped
  introHtml: string; // escaped/inline-safe
  panelTitle: string; // escaped
  rowsHtml: string;
  ctaUrl: string;
  ctaLabel: string; // escaped
  footnote: string; // escaped
}): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:${NAVY};border-radius:12px 12px 0 0;padding:26px 32px 22px;">
          <div style="font-size:11px;letter-spacing:2px;color:#94A3B8;text-transform:uppercase;">Ikeja Electric · GIS Unit · Technical Services</div>
          <div style="font-size:22px;font-weight:700;color:#FFFFFF;margin-top:6px;">GIS KPI Performance Dashboard</div>
        </td></tr>
        <tr><td style="height:4px;background:${RED};font-size:0;line-height:0;">&nbsp;</td></tr>
        <!-- Body card -->
        <tr><td style="background:#FFFFFF;padding:30px 32px;">
          <p style="margin:0 0 6px;font-size:15px;color:${SLATE};">Hello ${opts.recipientName},</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${SLATE};">${opts.introHtml}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;border-collapse:separate;">
            <tr><td colspan="2" style="background:#F8FAFC;padding:10px 14px;font-size:12px;font-weight:700;color:${CYAN};text-transform:uppercase;letter-spacing:.6px;">${opts.panelTitle}</td></tr>
            ${opts.rowsHtml}
          </table>
          <p style="margin:22px 0 0;" align="center">
            <a href="${opts.ctaUrl}" style="display:inline-block;background:${RED};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">${opts.ctaLabel} →</a>
          </p>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">${opts.footnote}</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:${NAVY};border-radius:0 0 12px 12px;padding:16px 32px;" align="center">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#FCA5A5;">◈ POWERED BY THE GIS TEAM ◈</div>
          <div style="font-size:11px;color:#64748B;margin-top:6px;">Confidential — intended for the addressee only.</div>
        </td></tr>
      </table>
    </td></tr>
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
 * Generic branded notification (evidence submitted, decisions, approvals).
 * All content is escaped; `*bold*` markers in the intro become <strong>.
 */
export function buildNoticeEmail(input: NoticeEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const introHtml = escapeHtml(input.intro).replace(
    /\*([^*]+)\*/g,
    "<strong>$1</strong>",
  );
  const rowsHtml = input.rows
    .map((r) =>
      detailRow(
        escapeHtml(r.label),
        r.strong ? `<strong>${escapeHtml(r.value)}</strong>` : escapeHtml(r.value),
      ),
    )
    .join("");
  const ctaUrl = `${input.dashboardUrl.replace(/\/$/, "")}${input.ctaPath}`;
  const footnote = escapeHtml(
    input.footnote ??
      "This is an automated notification from the GIS KPI Performance Dashboard.",
  );

  const html = renderShell({
    recipientName: escapeHtml(input.recipientName),
    introHtml,
    panelTitle: escapeHtml(input.panelTitle),
    rowsHtml,
    ctaUrl,
    ctaLabel: escapeHtml(input.ctaLabel),
    footnote,
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

export function buildKpiUpdateEmail(input: KpiUpdateEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const e = {
    recipientName: escapeHtml(input.recipientName),
    actorName: escapeHtml(input.actorName),
    employeeName: escapeHtml(input.employeeName),
    employeeBusinessId: escapeHtml(input.employeeBusinessId),
    objective: escapeHtml(input.objective),
    activityTitle: escapeHtml(input.activityTitle),
    periodKey: escapeHtml(input.periodKey),
    attainmentPct: escapeHtml(input.attainmentPct),
    statusLabel: escapeHtml(input.statusLabel),
  };
  const ctaUrl = `${input.dashboardUrl.replace(/\/$/, "")}${input.kpiPath}`;

  const subject =
    input.variant === "admin"
      ? `KPI update — ${input.employeeName}: ${input.activityTitle}`
      : `Your KPI update was recorded — ${input.activityTitle}`;

  const intro =
    input.variant === "admin"
      ? `<strong>${e.actorName}</strong> logged a KPI update for <strong>${e.employeeName}</strong> (${e.employeeBusinessId}). The measurement was recomputed by the deterministic scoring engine and is awaiting review.`
      : `Your KPI update was recorded successfully and your provisional measurement has been recomputed. It now moves to evidence verification and review.`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 14px;border-bottom:1px solid #E2E8F0;font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">${label}</td>
      <td style="padding:8px 14px;border-bottom:1px solid #E2E8F0;font-size:14px;color:${SLATE};">${value}</td>
    </tr>`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:${NAVY};border-radius:12px 12px 0 0;padding:26px 32px 22px;">
          <div style="font-size:11px;letter-spacing:2px;color:#94A3B8;text-transform:uppercase;">Ikeja Electric · GIS Unit · Technical Services</div>
          <div style="font-size:22px;font-weight:700;color:#FFFFFF;margin-top:6px;">GIS KPI Performance Dashboard</div>
        </td></tr>
        <tr><td style="height:4px;background:${RED};font-size:0;line-height:0;">&nbsp;</td></tr>
        <!-- Body card -->
        <tr><td style="background:#FFFFFF;padding:30px 32px;">
          <p style="margin:0 0 6px;font-size:15px;color:${SLATE};">Hello ${e.recipientName},</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${SLATE};">${intro}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;border-collapse:separate;">
            <tr><td colspan="2" style="background:#F8FAFC;padding:10px 14px;font-size:12px;font-weight:700;color:${CYAN};text-transform:uppercase;letter-spacing:.6px;">KPI update details</td></tr>
            ${row("Activity", `<strong>${e.activityTitle}</strong>`)}
            ${row("KPI objective", e.objective)}
            ${row("Employee", `${e.employeeName} <span style="color:${MUTED};">(${e.employeeBusinessId})</span>`)}
            ${row("Period", e.periodKey)}
            ${row("Provisional attainment", `<strong>${e.attainmentPct}</strong>`)}
            ${row("Status", e.statusLabel)}
          </table>
          <p style="margin:22px 0 0;" align="center">
            <a href="${ctaUrl}" style="display:inline-block;background:${RED};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Open in the dashboard →</a>
          </p>
          <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
            Provisional numbers come from the deterministic scoring engine. Official scores
            require approved evidence and reviewer sign-off. This is an automated
            notification from the GIS KPI Performance Dashboard.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:${NAVY};border-radius:0 0 12px 12px;padding:16px 32px;" align="center">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#FCA5A5;">◈ POWERED BY THE GIS TEAM ◈</div>
          <div style="font-size:11px;color:#64748B;margin-top:6px;">Confidential — intended for the addressee only.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hello ${input.recipientName},`,
    "",
    input.variant === "admin"
      ? `${input.actorName} logged a KPI update for ${input.employeeName} (${input.employeeBusinessId}).`
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
