import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { evidencePreflight, serveEvidence } from "./evidenceHttp";

const http = httpRouter();

// Convex Auth HTTP routes (sign-in callbacks, token refresh, etc.).
auth.addHttpRoutes(http);

// Authenticated, authorized evidence streaming (never a permanent bearer URL).
// The browser preflights the cross-origin Authorization fetch, so OPTIONS must
// answer with CORS headers or the download is blocked before it starts.
http.route({
  path: "/evidence",
  method: "GET",
  handler: serveEvidence,
});
http.route({
  path: "/evidence",
  method: "OPTIONS",
  handler: evidencePreflight,
});

export default http;
