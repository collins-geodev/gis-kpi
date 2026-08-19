/**
 * User profile: identity, designated role(s), linked employee, and the profile
 * photo (uploaded or captured in-app via the camera). Avatars live in Convex
 * storage; the query hands back a short-lived URL.
 */
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getUserRoles, requireUser } from "./authz";
import { recordAudit } from "./audit";
import { vAppRole } from "./validators";

const MAX_AVATAR_BYTES = 6 * 1024 * 1024; // 6 MB

export const getMine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      roles: v.array(vAppRole),
      avatarUrl: v.union(v.string(), v.null()),
      employee: v.union(
        v.null(),
        v.object({
          employeeId: v.string(),
          displayName: v.string(),
          jobRole: v.string(),
          canonicalLocation: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const roles = await getUserRoles(ctx, user._id);
    const avatarUrl = user.avatarStorageId
      ? await ctx.storage.getUrl(user.avatarStorageId)
      : null;
    let employee = null;
    if (user.employeeId) {
      const e = await ctx.db.get(user.employeeId);
      if (e) {
        employee = {
          employeeId: e.employeeId,
          displayName: e.displayName,
          jobRole: e.jobRole,
          canonicalLocation: e.canonicalLocation,
        };
      }
    }
    return {
      name: user.name ?? null,
      email: user.email ?? null,
      roles,
      avatarUrl,
      employee,
    };
  },
});

/** Short-lived URL for uploading a profile photo (any signed-in user). */
export const generateAvatarUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setAvatar = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw new ConvexError("Uploaded file not found.");
    if (meta.size > MAX_AVATAR_BYTES) {
      throw new ConvexError("Profile photo must be 6 MB or smaller.");
    }
    if (meta.contentType && !meta.contentType.startsWith("image/")) {
      throw new ConvexError("Profile photo must be an image.");
    }
    const old = user.avatarStorageId;
    await ctx.db.patch(user._id, { avatarStorageId: storageId });
    if (old) await ctx.storage.delete(old);
    await recordAudit(ctx, {
      entityType: "user",
      entityId: user._id,
      action: "update_avatar",
      actorUserId: user._id,
    });
    return null;
  },
});

export const removeAvatar = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.avatarStorageId) {
      await ctx.storage.delete(user.avatarStorageId);
      await ctx.db.patch(user._id, { avatarStorageId: undefined });
    }
    return null;
  },
});

export const updateName = mutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, { name }) => {
    const user = await requireUser(ctx);
    const clean = name.trim().slice(0, 120);
    if (!clean) throw new ConvexError("Name cannot be empty.");
    await ctx.db.patch(user._id, { name: clean });
    return null;
  },
});
