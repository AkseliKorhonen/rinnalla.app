import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function makeInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function requireUserId(ctx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId;
}

async function generateUniqueInviteCode(ctx) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const inviteCode = makeInviteCode();
    const existing = await ctx.db
      .query("families")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();

    if (existing === null) {
      return inviteCode;
    }
  }

  throw new Error("Could not generate invite code");
}

async function getMembership(ctx, familyId, userId) {
  return await ctx.db
    .query("familyMembers")
    .withIndex("by_familyId_and_userId", (q) =>
      q.eq("familyId", familyId).eq("userId", userId),
    )
    .unique();
}

async function requireOwner(ctx, familyId, userId) {
  const membership = await getMembership(ctx, familyId, userId);
  if (membership === null || membership.role !== "owner") {
    throw new Error("Only the family owner can manage access");
  }
  return membership;
}

export const listMy = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const memberships = await ctx.db
      .query("familyMembers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(20);

    const families = [];
    for (const membership of memberships) {
      const family = await ctx.db.get(membership.familyId);
      if (!family) {
        continue;
      }

      families.push({
        _id: family._id,
        name: family.name,
        inviteCode: family.inviteCode,
        role: membership.role,
        joinedAt: membership.joinedAt,
      });
    }

    return families;
  },
});

export const dashboard = query({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const membership = await getMembership(ctx, args.familyId, userId);

    if (membership === null) {
      throw new Error("Family not found");
    }

    const family = await ctx.db.get(args.familyId);
    if (family === null) {
      throw new Error("Family not found");
    }

    const memberships = await ctx.db
      .query("familyMembers")
      .withIndex("by_familyId", (q) => q.eq("familyId", args.familyId))
      .take(20);
    const members = [];
    for (const member of memberships) {
      const user = await ctx.db.get(member.userId);
      members.push({
        _id: member._id,
        userId: member.userId,
        email: user?.email ?? null,
        name: user?.name ?? null,
        image: user?.image ?? null,
        role: member.role,
        joinedAt: member.joinedAt,
      });
    }

    members.sort((left, right) => right.joinedAt - left.joinedAt);

    return {
      family: {
        _id: family._id,
        name: family.name,
        inviteCode: family.inviteCode,
      },
      currentUserId: userId,
      members,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const inviteCode = await generateUniqueInviteCode(ctx);
    const now = Date.now();

    const familyId = await ctx.db.insert("families", {
      name: args.name.trim(),
      createdBy: userId,
      inviteCode,
      createdAt: now,
    });

    await ctx.db.insert("familyMembers", {
      familyId,
      userId,
      role: "owner",
      joinedAt: now,
    });

    return familyId;
  },
});

export const join = mutation({
  args: {
    inviteCode: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const normalizedCode = args.inviteCode.trim().toUpperCase();

    const family = await ctx.db
      .query("families")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", normalizedCode))
      .unique();

    if (family === null) {
      throw new Error("Family not found");
    }

    const existingMembership = await ctx.db
      .query("familyMembers")
      .withIndex("by_familyId_and_userId", (q) =>
        q.eq("familyId", family._id).eq("userId", userId),
      )
      .unique();

    if (existingMembership) {
      throw new Error("You are already in this family");
    }

    await ctx.db.insert("familyMembers", {
      familyId: family._id,
      userId,
      role: "member",
      joinedAt: Date.now(),
    });

    return family._id;
  },
});

export const heartbeat = mutation({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const membership = await getMembership(ctx, args.familyId, userId);

    if (membership === null) {
      throw new Error("Family not found");
    }

    // Kept as a no-op while older deployed clients still send heartbeats.
    // Presence is no longer collected or used to decide who can be called.
    return null;
  },
});

export const regenerateInviteCode = mutation({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwner(ctx, args.familyId, userId);
    const inviteCode = await generateUniqueInviteCode(ctx);

    await ctx.db.patch(args.familyId, { inviteCode });
    return inviteCode;
  },
});

export const removeMember = mutation({
  args: {
    familyId: v.id("families"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    await requireOwner(ctx, args.familyId, ownerId);

    if (args.userId === ownerId) {
      throw new Error("The family owner cannot be removed");
    }

    const membership = await getMembership(ctx, args.familyId, args.userId);
    if (membership === null) {
      throw new Error("Family member not found");
    }

    await ctx.db.delete(membership._id);

    return args.userId;
  },
});

export const leave = mutation({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const membership = await getMembership(ctx, args.familyId, userId);
    if (membership === null) {
      throw new Error("Family not found");
    }
    if (membership.role === "owner") {
      throw new Error("Transfer ownership before leaving this family");
    }

    await ctx.db.delete(membership._id);

    return args.familyId;
  },
});
