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

export const serveEvidence = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");
  if (!idParam) return new Response("Missing id", { status: 400 });

  let auth;
  try {
    auth = await ctx.runQuery(internal.evidence.authorizeDownload, {
      evidenceId: idParam as Id<"evidenceFiles">,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (!auth.allowed) {
    return new Response(auth.message ?? "Forbidden", { status: auth.status });
  }

  // Approved external evidence — redirect rather than proxy.
  if (!auth.storageId) {
    if (auth.externalUrl) return Response.redirect(auth.externalUrl, 302);
    return new Response("No content", { status: 404 });
  }

  const blob = await ctx.storage.get(auth.storageId);
  if (!blob) return new Response("File not found", { status: 404 });

  if (auth.userId) {
    await ctx.runMutation(internal.evidence.logAccess, {
      evidenceId: idParam as Id<"evidenceFiles">,
      userId: auth.userId,
    });
  }

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": auth.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFilename(auth.filename ?? "evidence")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
