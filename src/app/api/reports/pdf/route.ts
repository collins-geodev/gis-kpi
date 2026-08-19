/**
 * PDF export endpoint (Node runtime). Auth via the Convex token, fetches the
 * scope-checked dataset, optionally generates a schema-validated AI narrative,
 * renders a deterministic PDF, and logs generation provenance.
 */
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex/_generated/api";
import { buildReportPdf } from "@/server/reports/pdf";
import { aiConfigured, generateNarrative } from "@/server/reports/ai";
import type { ReportDataset } from "@/server/reports/types";
import type { ReportNarrative } from "@/server/reports/narrative";
import type { NarrativeProvenance } from "@/server/reports/ai";

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
  const withAi = url.searchParams.get("ai") === "1";

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new NextResponse("Server not configured", { status: 500 });

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);

  // Per-user rate limit — the PDF render may also call the AI gateway.
  try {
    const gate = await client.mutation(api.rateLimit.hit, { endpoint: "report_pdf" });
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
    return new NextResponse(e instanceof Error ? e.message : "Report failed", {
      status: 403,
    });
  }

  // Optional structured-AI narrative (best-effort; PDF renders without it).
  let narrative: ReportNarrative | null = null;
  let provenance: NarrativeProvenance | null = null;
  if (withAi && aiConfigured()) {
    try {
      const result = await generateNarrative(dataset);
      narrative = result.narrative;
      provenance = result.provenance;
    } catch {
      narrative = null;
    }
  }

  const stamp = Date.now();
  const buffer = await buildReportPdf(dataset, narrative, stamp, false);

  // Provenance log (best-effort).
  try {
    await client.mutation(api.reports.logGeneration, {
      scope,
      scopeRef,
      periodKey,
      format: "pdf",
      aiProvider: provenance?.provider,
      aiModelId: provenance?.modelId,
      promptVersion: provenance?.promptVersion,
      schemaVersion: provenance?.schemaVersion,
      usage: provenance?.usage,
      generationMs: provenance?.generationMs,
    });
  } catch {
    // non-fatal
  }

  const safeScope = `${scope}${scopeRef ? "-" + scopeRef.slice(0, 12) : ""}`;
  const filename = `GIS-KPI-${safeScope}-${periodKey}.pdf`.replace(/[^\w.\-]+/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
