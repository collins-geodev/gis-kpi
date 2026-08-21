/**
 * Convex Auth wiring. Password (email + password) provider first; OAuth
 * providers (e.g. Google/GitHub) can be added to the `providers` array later
 * once their client credentials are configured in the Convex environment.
 *
 * New sign-ups are created inactive-by-default at the app-role layer: a fresh
 * user has NO userRoleAssignments and therefore no access until an admin grants
 * a role (or the one-time bootstrap in access.ts runs for the configured admin
 * email). Authentication ≠ authorization.
 *
 * Login emails are normalized (trimmed, lowercased) at this boundary so the
 * casing someone types never decides whether they can sign in, sign up, or
 * reset a password. `migrations:normalizeAuthEmails` brought pre-existing
 * rows in line with this rule.
 */
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { MutationCtx } from "./_generated/server";
import { ResendOTPPasswordReset } from "./otp";

/** One canonical form for every login email (mailboxes are case-insensitive). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(params.email as string);
        return {
          email,
          name: (params.name as string | undefined) ?? email,
          isActive: true,
        };
      },
      reset: ResendOTPPasswordReset,
    }),
  ],
  callbacks: {
    /**
     * Link sign-ups to an existing users row by email instead of creating a
     * duplicate. This matters after an admin clears a broken credential
     * (migrations:resetUserLoginCredential): the employee re-registers with
     * the same email and adopts their original account — employee link, role
     * assignments, and notification history intact. Safe because sign-up with
     * an email that still HAS a credential fails before this callback runs.
     */
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;
      // The callback receives a generically-typed ctx; narrow to this app's.
      const db = (ctx as unknown as MutationCtx).db;
      const email = args.profile.email as string | undefined;
      if (email) {
        const existing = await db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .first();
        if (existing) return existing._id;
      }
      return await db.insert("users", { ...args.profile });
    },
  },
});
