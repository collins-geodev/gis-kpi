"use client";

/**
 * Dashboard error boundary. A crash while the session is gone (sign-out race,
 * expired token) silently redirects to sign-in instead of showing the raw
 * Next.js "Application error" screen; genuine errors get a styled retry card.
 */
import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const signedOut = !isLoading && !isAuthenticated;

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
    if (signedOut) window.location.replace("/signin");
  }, [error, signedOut]);

  if (signedOut || isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Redirecting to sign-in…
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
        <h2 className="mt-3 font-display text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The page hit an unexpected error. Your data is safe — try again, and if it
          persists let a System Admin know.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="accent" size="sm" onClick={() => reset()}>
            <RotateCcw className="h-4 w-4" /> Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.assign("/overview")}
          >
            Back to Overview
          </Button>
        </div>
      </div>
    </div>
  );
}
