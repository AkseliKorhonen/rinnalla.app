import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";

async function requireUserId(ctx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

export const register = mutation({
  args: {
    deviceId: v.optional(v.string()),
    platform: v.union(v.literal("android"), v.literal("ios")),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const tokenMatches = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(50);
    const deviceMatches = args.deviceId === undefined
      ? []
      : await ctx.db
          .query("pushTokens")
          .withIndex("by_userId_and_deviceId", (q) =>
            q.eq("userId", userId).eq("deviceId", args.deviceId),
          )
          .take(50);

    // Reuse a row when possible, but ensure that both the FCM token and a
    // user/device pair have only one current registration. This also safely
    // transfers an FCM token that Android has reassigned between accounts.
    const existing =
      tokenMatches.find(
        (candidate) =>
          candidate.userId === userId &&
          (args.deviceId === undefined || candidate.deviceId === args.deviceId),
      ) ??
      deviceMatches[0] ??
      tokenMatches[0] ??
      null;

    const obsoleteIds = new Set(
      [...tokenMatches, ...deviceMatches]
        .filter((candidate) => candidate._id !== existing?._id)
        .map((candidate) => candidate._id),
    );
    for (const obsoleteId of obsoleteIds) {
      await ctx.db.delete(obsoleteId);
    }

    const registration = {
      platform: args.platform,
      token: args.token,
      userId,
      updatedAt: Date.now(),
      ...(args.deviceId === undefined ? {} : { deviceId: args.deviceId }),
    };

    if (existing !== null) {
      await ctx.db.patch(existing._id, registration);
      return existing._id;
    }

    return await ctx.db.insert("pushTokens", registration);
  },
});

export const unregisterDevice = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const registrations = await ctx.db
      .query("pushTokens")
      .withIndex("by_userId_and_deviceId", (q) =>
        q.eq("userId", userId).eq("deviceId", args.deviceId),
      )
      .take(50);

    for (const registration of registrations) {
      await ctx.db.delete(registration._id);
    }
    return registrations.length;
  },
});

export const removeInvalid = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(50);
    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }
    return null;
  },
});
