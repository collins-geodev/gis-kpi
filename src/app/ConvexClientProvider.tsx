"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ThemeProvider } from "next-themes";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Fail loudly in dev if the URL is missing (set by `npx convex dev`).
if (!convexUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    "NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` and copy the URL into .env.local.",
  );
}

const convex = new ConvexReactClient(convexUrl ?? "https://placeholder.convex.cloud");

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </ConvexAuthNextjsProvider>
  );
}
