import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { serveEvidence } from "./evidenceHttp";

const http = httpRouter();

// Convex Auth HTTP routes (sign-in callbacks, token refresh, etc.).
auth.addHttpRoutes(http);

// Authenticated, authorized evidence streaming (never a permanent bearer URL).
http.route({
  path: "/evidence",
  method: "GET",
  handler: serveEvidence,
});

export default http;
