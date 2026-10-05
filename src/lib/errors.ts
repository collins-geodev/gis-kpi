import { ConvexError } from "convex/values";

/**
 * Human-readable message from a caught mutation/action error.
 *
 * Convex redacts plain `Error` messages in production ("Server Error"), so
 * user-facing Convex functions throw `ConvexError` and the real message rides
 * in `.data`. Prefer that (also when `instanceof` fails across bundles, by
 * duck-typing `.data`); otherwise pull the text after "Uncaught …Error:" out
 * of a dev-style message; never show a bare "Server Error" — use the caller's
 * fallback instead.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const data =
    e instanceof ConvexError || (e instanceof Error && "data" in e)
      ? (e as { data?: unknown }).data
      : undefined;
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    const msg = (data as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  if (!(e instanceof Error)) return fallback;
  const uncaught =
    /Uncaught (?:ConvexError|\w*Error): ([\s\S]*?)(?:\n\s+at |\n\s*Called by|$)/.exec(
      e.message,
    );
  if (uncaught?.[1]?.trim()) return uncaught[1].trim();
  if (/Server Error/i.test(e.message) || /^\[CONVEX /.test(e.message)) return fallback;
  return e.message || fallback;
}
