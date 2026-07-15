import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

const resolutionValidator = v.union(
  v.literal("answered"),
  v.literal("declined"),
  v.literal("ended"),
);

async function getUserTokens(ctx, userId) {
  const [androidTokens, iosTokens] = await Promise.all([
    ctx.db
      .query("pushTokens")
      .withIndex("by_userId_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", "android"),
      )
      .take(20),
    ctx.db
      .query("pushTokens")
      .withIndex("by_userId_and_platform", (q) =>
        q.eq("userId", userId).eq("platform", "ios"),
      )
      .take(20),
  ]);
  return [...androidTokens, ...iosTokens];
}

function uniqueTokens(registrations) {
  return [...new Set(registrations.map((registration) => registration.token))];
}

export const getIncomingCallPayload = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status !== "ringing" || call.nativeCallId === undefined) return null;

    const [caller, tokens] = await Promise.all([
      ctx.db.get(call.callerId),
      getUserTokens(ctx, call.calleeId),
    ]);

    return {
      callId: call._id,
      callerName: caller?.name ?? caller?.email ?? "Family member",
      familyId: call.familyId,
      nativeCallId: call.nativeCallId,
      tokens: uniqueTokens(tokens),
    };
  },
});

export const getResolvedCallPayload = internalQuery({
  args: {
    callId: v.id("calls"),
    resolution: resolutionValidator,
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    const expectedStatus =
      args.resolution === "answered"
        ? "active"
        : args.resolution === "declined"
          ? "declined"
          : "ended";
    if (call === null || call.status !== expectedStatus) return null;

    const calleeTokens = await getUserTokens(ctx, call.calleeId);
    const targetTokens = args.resolution === "ended"
      ? [...calleeTokens, ...(await getUserTokens(ctx, call.callerId))]
      : calleeTokens;
    const deliverableTokens =
      args.resolution === "answered" && call.answeredByDeviceId !== undefined
        ? targetTokens.filter(
            (registration) =>
              registration.deviceId !== call.answeredByDeviceId,
          )
        : targetTokens;

    return {
      answeredByDeviceId: call.answeredByDeviceId,
      callId: call._id,
      familyId: call.familyId,
      nativeCallId: call.nativeCallId,
      resolution: args.resolution,
      tokens: uniqueTokens(deliverableTokens),
    };
  },
});
