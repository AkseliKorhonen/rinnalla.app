"use node";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const RESOLUTION_PUSH_TTL_MS = 5 * 60 * 1_000;
const resolutionValidator = v.union(
  v.literal("answered"),
  v.literal("declined"),
  v.literal("ended"),
);

function getFcmMessaging() {
  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;

  const app = getApps().find((candidate) => candidate.name === "rinnalla-fcm") ?? initializeApp(
    { credential: cert(JSON.parse(serviceAccountJson)) },
    "rinnalla-fcm",
  );
  return getMessaging(app);
}

function getCallStateCollapseKey(payload, state) {
  return `rinnalla-call-${payload.nativeCallId ?? payload.callId}-${state}`;
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
      android: {
        collapseKey: getCallStateCollapseKey(payload, "incoming"),
        priority: "high",
        ttl: 30_000,
      },
      data: {
        callerName: payload.callerName,
        callId: payload.callId,
        familyId: payload.familyId,
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

export const sendResolved = internalAction({
  args: {
    callId: v.id("calls"),
    resolution: resolutionValidator,
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(
      internal.callNotificationData.getResolvedCallPayload,
      args,
    );
    if (payload === null || payload.tokens.length === 0) return null;

    const messaging = getFcmMessaging();
    if (messaging === null) {
      console.warn("Call-resolution push skipped: FCM_SERVICE_ACCOUNT_JSON is not configured.");
      return null;
    }

    const response = await messaging.sendEachForMulticast({
      tokens: payload.tokens,
      android: {
        collapseKey: getCallStateCollapseKey(payload, "resolved"),
        priority: "high",
        ttl: RESOLUTION_PUSH_TTL_MS,
      },
      data: {
        callId: payload.callId,
        familyId: payload.familyId,
        kind: "call-resolved",
        resolution: payload.resolution,
        ...(payload.nativeCallId === undefined
          ? {}
          : { nativeCallId: payload.nativeCallId }),
        ...(payload.answeredByDeviceId === undefined
          ? {}
          : { answeredByDeviceId: payload.answeredByDeviceId }),
      },
    });

    await Promise.all(response.responses.map(async (result, index) => {
      if (result.success || !result.error?.code.includes("registration-token-not-registered")) return;
      await ctx.runMutation(internal.pushTokens.removeInvalid, { token: payload.tokens[index] });
    }));

    return null;
  },
});
