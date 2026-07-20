import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

function normalizeName(value) {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Your name must be between 2 and 80 characters");
  }
  return name;
}

async function requireUser(ctx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("User not found");
  }
  return user;
}

async function profileImageUrl(ctx, user) {
  if (user.profileImageStorageId !== undefined) {
    const url = await ctx.storage.getUrl(user.profileImageStorageId);
    if (url !== null) return url;
  }
  return user.image ?? null;
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      image: await profileImageUrl(ctx, user),
    };
  },
});

export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    await ctx.db.patch(userId, { name: normalizeName(args.name) });
  },
});

export const generateProfileImageUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const commitProfileImage = internalMutation({
  args: {
    storageId: v.id("_storage"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }
    const claimedBy = await ctx.db
      .query("users")
      .withIndex("by_profileImageStorageId", (query) =>
        query.eq("profileImageStorageId", args.storageId),
      )
      .unique();
    if (claimedBy !== null && claimedBy._id !== user._id) {
      throw new Error("That image is already in use");
    }

    const previousStorageId = user.profileImageStorageId;
    await ctx.db.patch(user._id, {
      profileImageStorageId: args.storageId,
    });
    if (
      previousStorageId !== undefined
      && previousStorageId !== args.storageId
    ) {
      await ctx.storage.delete(previousStorageId);
    }
    return null;
  },
});

export const removeProfileImage = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const previousStorageId = user.profileImageStorageId;
    await ctx.db.patch(user._id, {
      image: undefined,
      profileImageStorageId: undefined,
    });
    if (previousStorageId !== undefined) {
      await ctx.storage.delete(previousStorageId);
    }
    return null;
  },
});
