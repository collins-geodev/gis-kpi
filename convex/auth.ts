/**
 * Convex Auth wiring. Password (email + password) provider first; OAuth
 * providers (e.g. Google/GitHub) can be added to the `providers` array later
 * once their client credentials are configured in the Convex environment.
 *
 * New sign-ups are created inactive-by-default at the app-role layer: a fresh
 * user has NO userRoleAssignments and therefore no access until an admin grants
 * a role (or the one-time bootstrap in access.ts runs for the configured admin
 * email). Authentication ≠ authorization.
 */
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string | undefined) ?? (params.email as string),
          isActive: true,
        };
      },
    }),
  ],
});
