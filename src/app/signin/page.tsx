"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PoweredByGisTeam } from "@/components/powered-by-gis-team";
import { Loader2 } from "lucide-react";
import { GeoMark } from "@/components/geo-mark";

/**
 * signIn / signUp: email + password.
 * forgot: email only — emails an 8-digit reset code.
 * resetVerify: code + new password — sets the password and signs in.
 */
type Flow = "signIn" | "signUp" | "forgot" | "resetVerify";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("signIn");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function switchFlow(next: Flow) {
    setError(null);
    setInfo(null);
    setFlow(next);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      if (flow === "forgot") {
        const address = (form.get("email") as string).trim();
        await signIn("password", { email: address, flow: "reset" });
        setEmail(address);
        setInfo(`We emailed an 8-digit code to ${address}. Enter it below.`);
        setFlow("resetVerify");
        setSubmitting(false);
        return;
      }
      if (flow === "resetVerify") {
        await signIn("password", {
          email,
          code: form.get("code") as string,
          newPassword: form.get("newPassword") as string,
          flow: "reset-verification",
        });
        router.push("/overview");
        return;
      }
      form.set("flow", flow);
      await signIn("password", form);
      router.push("/overview");
    } catch {
      setError(
        flow === "signIn"
          ? "Could not sign in. Check your email and password."
          : flow === "signUp"
            ? "Could not create the account. It may already exist."
            : flow === "forgot"
              ? "Could not send the reset code. Check the email address and try again."
              : "Could not reset the password. The code may be wrong or expired — request a new one.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="bg-geo-grid relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="starfield" aria-hidden />
      <div className="aurora" aria-hidden />
      <div className="bg-geo-contour pointer-events-none absolute inset-0" aria-hidden />
      <Card className="relative z-10 w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/25 bg-accent/10">
              <GeoMark className="h-8 w-8" />
            </div>
            <div>
              <CardTitle className="text-lg">GIS KPI Performance Dashboard</CardTitle>
              <CardDescription>Technical Services · GIS Team</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {flow !== "resetVerify" && (
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  Work email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={inputClass}
                  placeholder="you@ikejaelectric.com"
                />
              </div>
            )}
            {(flow === "signIn" || flow === "signUp") && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  {flow === "signIn" && (
                    <button
                      type="button"
                      className="text-sm font-medium text-accent hover:underline"
                      onClick={() => switchFlow("forgot")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>
            )}
            {flow === "forgot" && (
              <p className="text-sm text-muted-foreground">
                Enter your work email and we&apos;ll send you an 8-digit code to set a new
                password.
              </p>
            )}
            {flow === "resetVerify" && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="code" className="text-sm font-medium">
                    Reset code
                  </label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    maxLength={8}
                    autoComplete="one-time-code"
                    className={inputClass}
                    placeholder="8-digit code from your email"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="newPassword" className="text-sm font-medium">
                    New password
                  </label>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={inputClass}
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {flow === "signIn"
                ? "Sign in"
                : flow === "signUp"
                  ? "Create account"
                  : flow === "forgot"
                    ? "Send reset code"
                    : "Set new password"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {flow === "signIn" ? (
              <>
                New to the dashboard?{" "}
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => switchFlow("signUp")}
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                {flow === "resetVerify" && (
                  <>
                    Didn&apos;t get the code?{" "}
                    <button
                      type="button"
                      className="font-medium text-accent hover:underline"
                      onClick={() => switchFlow("forgot")}
                    >
                      Resend
                    </button>{" "}
                    ·{" "}
                  </>
                )}
                Back to{" "}
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => switchFlow("signIn")}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </CardContent>
      </Card>
      <div className="relative z-10 mt-8 w-full max-w-md overflow-hidden rounded-md">
        <PoweredByGisTeam />
      </div>
    </main>
  );
}
