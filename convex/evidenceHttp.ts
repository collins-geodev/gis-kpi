/**
 * Authenticated, authorized evidence streaming. Access is checked on EVERY
 * request via an internal query — never a permanent public bearer URL. Private
 * files are streamed straight from Convex storage; approved external links are
 * redirected. Every successful download is audit-logged.
 */
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "evidence";
}

/**
 * CORS: the app (Vercel/localhost) fetches from the .convex.site origin with a
 * Bearer token, which triggers a preflight. Access control lives in the token
 * check on every request — never in the origin — so a wildcard is safe here
 * (no cookies are involved).
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Disposition",
} as const;

export const evidencePreflight = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
});

export const serveEvidence = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");
  if (!idParam) {
    return new Response("Missing id", { status: 400, headers: CORS_HEADERS });
  }

  let auth;
  try {
    auth = await ctx.runQuery(internal.evidence.authorizeDownload, {
      evidenceId: idParam as Id<"evidenceFiles">,
    });
  } catch {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  if (!auth.allowed) {
    return new Response(auth.message ?? "Forbidden", {
      status: auth.status,
      headers: CORS_HEADERS,
    });
  }

  // Approved external evidence — redirect rather than proxy.
  if (!auth.storageId) {
    if (auth.externalUrl) return Response.redirect(auth.externalUrl, 302);
    return new Response("No content", { status: 404, headers: CORS_HEADERS });
  }

  const blob = await ctx.storage.get(auth.storageId);
  if (!blob) {
    return new Response("File not found", { status: 404, headers: CORS_HEADERS });
  }

  if (auth.userId) {
    await ctx.runMutation(internal.evidence.logAccess, {
      evidenceId: idParam as Id<"evidenceFiles">,
      userId: auth.userId,
    });
  }

  return new Response(blob, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": auth.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFilename(auth.filename ?? "evidence")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
