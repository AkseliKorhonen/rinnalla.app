"use node";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

function getFcmMessaging() {
  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;

  const app = getApps().find((candidate) => candidate.name === "rinnalla-fcm") ?? initializeApp(
    { credential: cert(JSON.parse(serviceAccountJson)) },
    "rinnalla-fcm",
  );
  return getMessaging(app);
}

export const sendIncoming = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.callNotificationData.getIncomingCallPayload, args);
    if (payload === null || payload.tokens.length === 0) return null;

    const messaging = getFcmMessaging();
    if (messaging === null) {
      console.warn("Incoming-call push skipped: FCM_SERVICE_ACCOUNT_JSON is not configured.");
      return null;
    }

    const response = await messaging.sendEachForMulticast({
      tokens: payload.tokens,
      android: { priority: "high", ttl: 30_000 },
      data: {
        callerName: payload.callerName,
        callId: payload.callId,
        kind: "incoming-call",
        nativeCallId: payload.nativeCallId,
      },
    });

    await Promise.all(response.responses.map(async (result, index) => {
      if (result.success || !result.error?.code.includes("registration-token-not-registered")) return;
      await ctx.runMutation(internal.pushTokens.removeInvalid, { token: payload.tokens[index] });
    }));

    return null;
  },
});
