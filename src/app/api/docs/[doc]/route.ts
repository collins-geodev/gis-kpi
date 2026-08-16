/**
 * Authenticated workflow-document downloads (Node runtime). Mirrors the report
 * endpoints: no valid Convex auth token → 401, so the files are never served to
 * signed-out visitors. Files ship with the deployment in server-assets/docs
 * (bundled via outputFileTracingIncludes) — not under public/.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCS: Record<string, { contentType: string }> = {
  "GIS-KPI-Dashboard-Workflow.pdf": { contentType: "application/pdf" },
  "GIS-KPI-Dashboard-Workflow-Deck.pptx": {
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ doc: string }> },
) {
  const token = await convexAuthNextjsToken().catch(() => null);
  if (!token) return new NextResponse("Unauthorized", { status: 401 });

  const { doc } = await params;
  const entry = DOCS[doc];
  if (!entry) return new NextResponse("Not found", { status: 404 });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new NextResponse("Server not configured", { status: 500 });

  // Validate the token against the backend (a stale or forged cookie fails here).
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  try {
    const me = await client.query(api.profile.getMine, {});
    if (me === null) return new NextResponse("Unauthorized", { status: 401 });
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const filePath = path.join(process.cwd(), "server-assets", "docs", doc);
  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": entry.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${doc}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
