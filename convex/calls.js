import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

const RINGING_TIMEOUT_MS = 2 * 60 * 1000;
const ACTIVE_CALL_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const EXPIRY_BATCH_SIZE = 100;

async function requireUserId(ctx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId;
}

async function requireFamilyMembership(ctx, familyId, userId) {
  const membership = await ctx.db
    .query("familyMembers")
    .withIndex("by_familyId_and_userId", (q) =>
      q.eq("familyId", familyId).eq("userId", userId),
    )
    .unique();

  if (membership === null) {
    throw new Error("Family not found");
  }

  return membership;
}

async function getCallForUser(ctx, callId, userId) {
  const call = await ctx.db.get(callId);
  if (call === null) {
    throw new Error("Call not found");
  }
  if (call.callerId !== userId && call.calleeId !== userId) {
    throw new Error("Call not found");
  }
  await requireFamilyMembership(ctx, call.familyId, userId);
  return call;
}

async function getCallSummaries(ctx, calls) {
  return await Promise.all(
    calls.map(async (call) => {
      const caller = await ctx.db.get(call.callerId);
      const callee = await ctx.db.get(call.calleeId);
      return {
        ...call,
        caller: {
          _id: call.callerId,
          email: caller?.email ?? null,
          name: caller?.name ?? null,
        },
        callee: {
          _id: call.calleeId,
          email: callee?.email ?? null,
          name: callee?.name ?? null,
        },
      };
    }),
  );
}

async function deleteIceCandidates(ctx, callId) {
  const candidates = ctx.db
    .query("callIceCandidates")
    .withIndex("by_callId", (q) => q.eq("callId", callId));

  for await (const candidate of candidates) {
    await ctx.db.delete(candidate._id);
  }
}

async function hasBusyCall(ctx, userId, familyId) {
  const [ringingAsCaller, ringingAsCallee, activeAsCaller, activeAsCallee] =
    await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_callerId_and_status", (q) =>
          q.eq("callerId", userId).eq("status", "ringing"),
        )
        .take(20),
      ctx.db
        .query("calls")
        .withIndex("by_calleeId_and_status", (q) =>
          q.eq("calleeId", userId).eq("status", "ringing"),
        )
        .take(20),
      ctx.db
        .query("calls")
        .withIndex("by_callerId_and_status", (q) =>
          q.eq("callerId", userId).eq("status", "active"),
        )
        .take(20),
      ctx.db
        .query("calls")
        .withIndex("by_calleeId_and_status", (q) =>
          q.eq("calleeId", userId).eq("status", "active"),
        )
        .take(20),
    ]);

  return [
    ...ringingAsCaller,
    ...ringingAsCallee,
    ...activeAsCaller,
    ...activeAsCallee,
  ].some((call) => call.familyId === familyId);
}

export const watch = query({
  args: {
    familyId: v.id("families"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireFamilyMembership(ctx, args.familyId, userId);

    const [ringingCalls, activeCalls] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_familyId_and_status", (q) =>
          q.eq("familyId", args.familyId).eq("status", "ringing"),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("calls")
        .withIndex("by_familyId_and_status", (q) =>
          q.eq("familyId", args.familyId).eq("status", "active"),
        )
        .order("desc")
        .take(20),
    ]);

    const currentCall =
      [...activeCalls, ...ringingCalls].find(
        (call) => call.callerId === userId || call.calleeId === userId,
      ) ?? null;

    if (currentCall === null) {
      return {
        call: null,
        candidates: [],
      };
    }

    const [callSummary] = await getCallSummaries(ctx, [currentCall]);
    const candidates = await ctx.db
      .query("callIceCandidates")
      .withIndex("by_callId_and_recipientId", (q) =>
        q.eq("callId", currentCall._id).eq("recipientId", userId),
      )
      .order("asc")
      .take(100);

    return {
      call: callSummary,
      candidates,
    };
  },
});

export const start = mutation({
  args: {
    familyId: v.id("families"),
    calleeId: v.id("users"),
    offerSdp: v.string(),
  },
  handler: async (ctx, args) => {
    const callerId = await requireUserId(ctx);
    if (callerId === args.calleeId) {
      throw new Error("You cannot call yourself");
    }

    await requireFamilyMembership(ctx, args.familyId, callerId);
    await requireFamilyMembership(ctx, args.familyId, args.calleeId);

    const [callerBusy, calleeBusy] = await Promise.all([
      hasBusyCall(ctx, callerId, args.familyId),
      hasBusyCall(ctx, args.calleeId, args.familyId),
    ]);
    if (callerBusy || calleeBusy) {
      throw new Error("A call is already in progress");
    }

    return await ctx.db.insert("calls", {
      familyId: args.familyId,
      callerId,
      calleeId: args.calleeId,
      status: "ringing",
      offerSdp: args.offerSdp,
      createdAt: Date.now(),
    });
  },
});

export const answer = mutation({
  args: {
    callId: v.id("calls"),
    answerSdp: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const call = await getCallForUser(ctx, args.callId, userId);

    if (call.calleeId !== userId) {
      throw new Error("Only the callee can answer");
    }
    if (call.status !== "ringing") {
      throw new Error("Call is no longer ringing");
    }

    await ctx.db.patch(call._id, {
      status: "active",
      answerSdp: args.answerSdp,
      answeredAt: Date.now(),
    });

    return call._id;
  },
});

export const decline = mutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const call = await getCallForUser(ctx, args.callId, userId);

    if (call.status !== "ringing") {
      throw new Error("Call is no longer ringing");
    }

    await ctx.db.patch(call._id, {
      status: "declined",
      endedAt: Date.now(),
      endedBy: userId,
    });
    await deleteIceCandidates(ctx, call._id);

    return call._id;
  },
});

export const end = mutation({
  args: {
    callId: v.id("calls"),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const call = await getCallForUser(ctx, args.callId, userId);

    if (call.status !== "ringing" && call.status !== "active") {
      return call._id;
    }

    await ctx.db.patch(call._id, {
      status: "ended",
      endedAt: Date.now(),
      endedBy: userId,
    });
    await deleteIceCandidates(ctx, call._id);

    return call._id;
  },
});

export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [staleRingingCalls, staleActiveCalls] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_status_and_createdAt", (q) =>
          q.eq("status", "ringing").lt("createdAt", now - RINGING_TIMEOUT_MS),
        )
        .take(EXPIRY_BATCH_SIZE),
      ctx.db
        .query("calls")
        .withIndex("by_status_and_createdAt", (q) =>
          q.eq("status", "active").lt("createdAt", now - ACTIVE_CALL_TIMEOUT_MS),
        )
        .take(EXPIRY_BATCH_SIZE),
    ]);
    const staleCalls = [...staleRingingCalls, ...staleActiveCalls];

    for (const call of staleCalls) {
      await ctx.db.patch(call._id, {
        status: "ended",
        endedAt: now,
      });
      await deleteIceCandidates(ctx, call._id);
    }

    if (
      staleRingingCalls.length === EXPIRY_BATCH_SIZE ||
      staleActiveCalls.length === EXPIRY_BATCH_SIZE
    ) {
      await ctx.scheduler.runAfter(0, internal.calls.expireStale, {});
    }

    return staleCalls.length;
  },
});

export const addIceCandidate = mutation({
  args: {
    callId: v.id("calls"),
    recipientId: v.id("users"),
    candidate: v.string(),
    sdpMid: v.optional(v.string()),
    sdpMLineIndex: v.optional(v.number()),
    usernameFragment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const senderId = await requireUserId(ctx);
    const call = await getCallForUser(ctx, args.callId, senderId);
    const otherUserId =
      call.callerId === senderId ? call.calleeId : call.callerId;

    if (args.recipientId !== otherUserId) {
      throw new Error("Invalid ICE recipient");
    }
    if (call.status !== "ringing" && call.status !== "active") {
      throw new Error("Call is no longer active");
    }

    return await ctx.db.insert("callIceCandidates", {
      callId: call._id,
      recipientId: args.recipientId,
      senderId,
      candidate: args.candidate,
      sdpMid: args.sdpMid,
      sdpMLineIndex: args.sdpMLineIndex,
      usernameFragment: args.usernameFragment,
      createdAt: Date.now(),
    });
  },
});
