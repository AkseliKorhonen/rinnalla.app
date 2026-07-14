import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getIncomingCallPayload = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (call === null || call.status !== "ringing" || call.nativeCallId === undefined) return null;

    const [caller, tokens] = await Promise.all([
      ctx.db.get(call.callerId),
      ctx.db
        .query("pushTokens")
        .withIndex("by_userId_and_platform", (q) => q.eq("userId", call.calleeId).eq("platform", "android"))
        .take(20),
    ]);

    return {
      callId: call._id,
      callerName: caller?.name ?? caller?.email ?? "Family member",
      nativeCallId: call.nativeCallId,
      tokens: tokens.map((token) => token.token),
    };
  },
});
