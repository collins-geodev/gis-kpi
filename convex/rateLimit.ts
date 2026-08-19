/**
 * Fixed-window rate limiting for sensitive/expensive operations.
 *
 * Policies live server-side (the client only names the endpoint), keys are
 * always scoped to the calling user, and state is one row per key that resets
 * in place — so the table stays bounded by (endpoints × users).
 */
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./authz";

export const POLICIES = {
  /** Brute-force guard on the current-password check. */
  password_change: { limit: 5, windowMs: 15 * 60_000 },
  /** Heavy server-side renders (PDF may also call the AI gateway). */
  report_pdf: { limit: 10, windowMs: 10 * 60_000 },
  report_xlsx: { limit: 10, windowMs: 10 * 60_000 },
} as const;
export type RateLimitEndpoint = keyof typeof POLICIES;

const vEndpoint = v.union(
  v.literal("password_change"),
  v.literal("report_pdf"),
  v.literal("report_xlsx"),
);

const vOutcome = v.object({
  ok: v.boolean(),
  /** Seconds until the window resets (0 when ok). */
  retryAfterSeconds: v.number(),
});

/** Consume one token from the caller-scoped fixed window. */
export async function takeToken(
  ctx: MutationCtx,
  endpoint: RateLimitEndpoint,
  userId: Id<"users">,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const { limit, windowMs } = POLICIES[endpoint];
  const key = `${endpoint}:${userId}`;
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (row.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((row.windowStart + windowMs - now) / 1000),
      ),
    };
  }
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return { ok: true, retryAfterSeconds: 0 };
}

/** Public: rate-limit the signed-in caller for a named endpoint. */
export const hit = mutation({
  args: { endpoint: vEndpoint },
  returns: vOutcome,
  handler: async (ctx, { endpoint }) => {
    const user = await requireUser(ctx);
    return await takeToken(ctx, endpoint, user._id);
  },
});

/** Internal: same, for actions that already resolved the user id. */
export const hitForUser = internalMutation({
  args: { endpoint: vEndpoint, userId: v.id("users") },
  returns: vOutcome,
  handler: async (ctx, { endpoint, userId }) => {
    return await takeToken(ctx, endpoint, userId);
  },
});
