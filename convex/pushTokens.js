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
    platform: v.union(v.literal("android"), v.literal("ios")),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (existing !== null) {
      await ctx.db.patch(existing._id, { platform: args.platform, userId, updatedAt: Date.now() });
      return existing._id;
    }

    return await ctx.db.insert("pushTokens", { ...args, userId, updatedAt: Date.now() });
  },
});

export const removeInvalid = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (token !== null) await ctx.db.delete(token._id);
    return null;
  },
});
