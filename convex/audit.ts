/**
 * Immutable audit trail helper. Called from mutations for every config, import,
 * submission, review, approval, override, report and deletion event.
 */
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./authz";

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  actorUserId?: Id<"users">;
  reason?: string;
  before?: unknown;
  after?: unknown;
  requestMeta?: unknown;
}

export async function recordAudit(ctx: MutationCtx, input: AuditInput): Promise<void> {
  await ctx.db.insert("auditLogs", {
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorUserId: input.actorUserId,
    reason: input.reason,
    before: input.before ?? undefined,
    after: input.after ?? undefined,
    requestMeta: input.requestMeta ?? undefined,
    at: Date.now(),
  });
}

/** Paginated audit trail (auditor / system admin only). */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireRole(ctx, ["auditor", "system_admin"]);
    const result = await ctx.db
      .query("auditLogs")
      .withIndex("by_at")
      .order("desc")
      .paginate(paginationOpts);
    const page = [];
    for (const l of result.page) {
      let actor: string | null = null;
      if (l.actorUserId) {
        const u = await ctx.db.get(l.actorUserId);
        actor = u?.name ?? u?.email ?? null;
      }
      page.push({
        id: l._id,
        entityType: l.entityType,
        entityId: l.entityId,
        action: l.action,
        reason: l.reason ?? null,
        actor,
        at: l.at,
        before: l.before ?? null,
        after: l.after ?? null,
      });
    }
    return { ...result, page };
  },
});
