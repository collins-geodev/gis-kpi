import { ConvexError } from "convex/values";

/**
 * Human-readable message from a caught mutation/action error.
 *
 * Convex redacts plain `Error` messages in production ("Server Error"), so
 * user-facing Convex functions throw `ConvexError` and the real message rides
 * in `.data`. Prefer that; fall back to `.message` (useful in dev and for
 * client-side errors), then to the caller's fallback.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) {
    return typeof e.data === "string" ? e.data : fallback;
  }
  return e instanceof Error ? e.message : fallback;
}
