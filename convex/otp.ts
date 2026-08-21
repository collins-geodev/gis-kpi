/**
 * Email provider for the self-service "Forgot password" flow: sends an
 * 8-digit one-time code (15-minute expiry) through Resend using the branded
 * notice template. Wired into the Password provider via `reset` in auth.ts.
 */
import { Email } from "@convex-dev/auth/providers/Email";
import { buildNoticeEmail } from "./lib/emailTemplate";

const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 60 * 15;

/** Unbiased random digits via rejection sampling (250 = 25 × 10). */
function randomDigits(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < 250 && out.length < length) out += (b % 10).toString();
    }
  }
  return out;
}

export const ResendOTPPasswordReset = Email({
  id: "resend-otp-password-reset",
  maxAge: CODE_TTL_SECONDS,
  async generateVerificationToken() {
    return randomDigits(CODE_LENGTH);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("Password reset is not available until email is configured.");
    }
    const from = process.env.EMAIL_FROM ?? "GIS KPI Dashboard <onboarding@resend.dev>";
    const dashboardUrl = process.env.DASHBOARD_URL ?? "https://gis-kpi.vercel.app";
    const { subject, html, text } = buildNoticeEmail({
      recipientName: email.split("@")[0]!,
      subject: "Your password reset code",
      intro:
        "Someone asked to reset the password for your GIS KPI Dashboard account. Enter the code below on the sign-in page to choose a new password. The code expires in *15 minutes*. If this wasn't you, ignore this email — your password is unchanged.",
      panelTitle: "Password reset",
      rows: [
        { label: "Account", value: email },
        { label: "Reset code", value: token, strong: true },
        { label: "Expires in", value: "15 minutes" },
      ],
      ctaLabel: "Back to sign-in",
      ctaPath: "/signin",
      dashboardUrl,
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, html, text }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error("Password reset email failed", res.status, detail);
      throw new Error("Could not send the reset code email.");
    }
  },
});
