/**
 * Convex Auth provider configuration. CONVEX_SITE_URL is set automatically by
 * the Convex deployment; the auth setup CLI (`npx @convex-dev/auth`) writes the
 * JWT keys into the deployment environment.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
