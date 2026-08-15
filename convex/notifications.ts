/**
 * In-app notification feed (the topbar bell). Rows are written by the email/
 * notice pipeline; this module only reads and marks them for the signed-in
 * user.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./authz";

/** Latest notifications for the caller + unread count. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) => q.eq("userId", user._id))
      .take(200);
    const sorted = rows.sort((a, b) => b.createdAt - a.createdAt);
    return {
      unreadCount: rows.filter((n) => n.readAt === undefined).length,
      items: sorted.slice(0, 20).map((n) => ({
        id: n._id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        href: n.href ?? null,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      })),
    };
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const user = await requireUser(ctx);
    const n = await ctx.db.get(notificationId);
    if (!n || n.userId !== user._id) return null;
    if (n.readAt === undefined) {
      await ctx.db.patch(notificationId, { readAt: Date.now() });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("readAt", undefined),
      )
      .take(500);
    const now = Date.now();
    for (const n of unread) await ctx.db.patch(n._id, { readAt: now });
    return null;
  },
});
