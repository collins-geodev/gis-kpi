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
import { Loader2, MapPinned } from "lucide-react";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    form.set("flow", flow);
    try {
      await signIn("password", form);
      router.push("/overview");
    } catch (err) {
      setError(
        flow === "signIn"
          ? "Could not sign in. Check your email and password."
          : "Could not create the account. It may already exist.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="bg-geo-grid relative flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="bg-geo-contour pointer-events-none absolute inset-0" aria-hidden />
      <Card className="relative z-10 w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <MapPinned className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-lg">GIS KPI Performance Dashboard</CardTitle>
              <CardDescription>Technical Services · GIS Unit</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
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
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="you@ikejaelectric.com"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {flow === "signIn" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {flow === "signIn" ? "New to the dashboard?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                setError(null);
                setFlow((f) => (f === "signIn" ? "signUp" : "signIn"));
              }}
            >
              {flow === "signIn" ? "Create one" : "Sign in"}
            </button>
          </p>
        </CardContent>
      </Card>
      <div className="relative z-10 mt-8 w-full max-w-md overflow-hidden rounded-md">
        <PoweredByGisTeam />
      </div>
    </main>
  );
}
