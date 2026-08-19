/**
 * Excel export endpoint (Node runtime). Authenticates via the Convex Auth token,
 * fetches the scope-checked report dataset, and streams a genuine .xlsx.
 */
import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex/_generated/api";
import { buildWorkbook } from "@/server/reports/excel";
import type { ReportDataset } from "@/server/reports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scope = "individual" | "team" | "role" | "location";

export async function GET(req: NextRequest) {
  const token = await convexAuthNextjsToken().catch(() => null);
  if (!token) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") ?? "team") as Scope;
  const scopeRef = url.searchParams.get("scopeRef") ?? undefined;
  const periodKey = url.searchParams.get("periodKey") ?? "2026";

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new NextResponse("Server not configured", { status: 500 });

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // Per-user rate limit on this heavy render (policy lives server-side).
  try {
    const gate = await client.mutation(api.rateLimit.hit, { endpoint: "report_xlsx" });
    if (!gate.ok) {
      return new NextResponse(
        "Too many report requests — please try again in a few minutes.",
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
      );
    }
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let dataset: ReportDataset;
  try {
    dataset = (await client.query(api.reports.dataset, {
      scope,
      scopeRef,
      periodKey,
    })) as ReportDataset;
  } catch (e) {
    const message = errorMessage(e, "Report failed");
    return new NextResponse(message, { status: 403 });
  }

  const stamp = Date.now();
  const buffer = await buildWorkbook(dataset, stamp);
  const safeScope = `${scope}${scopeRef ? "-" + scopeRef.slice(0, 12) : ""}`;
  const filename = `GIS-KPI-${safeScope}-${periodKey}.xlsx`.replace(/[^\w.\-]+/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
