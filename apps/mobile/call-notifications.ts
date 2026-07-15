import messaging, { type FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import { PermissionsAndroid, Platform } from "react-native";
import {
  areCallNotificationsEnabled,
  getDeviceId,
  isNativeCallResolved,
  recordResolvedNativeCallId,
  setCallNotificationsEnabled,
} from "./device-identity";
import {
  dismissResolvedIncomingCall,
  showIncomingNativeCall,
} from "./native-call-service";

type IncomingCallMessage = FirebaseMessagingTypes.RemoteMessage;
type ForegroundIncomingCallRouter = (familyId?: string) => void;
type CallResolution = "answered" | "declined" | "ended";
type RegisterPushToken = (args: {
  deviceId: string;
  platform: "android" | "ios";
  token: string;
}) => Promise<unknown>;

let notificationHandlingQueue = Promise.resolve();

function enqueueNotificationHandling(operation: () => Promise<void>) {
  const next = notificationHandlingQueue
    .catch(() => undefined)
    .then(operation);
  notificationHandlingQueue = next.catch(() => undefined);
  return next;
}

function incomingCallFromMessage(message: IncomingCallMessage) {
  const { callId, callerName, familyId, kind, nativeCallId } = message.data ?? {};
  if (
    kind !== "incoming-call" ||
    typeof callId !== "string" ||
    (familyId !== undefined && typeof familyId !== "string") ||
    typeof nativeCallId !== "string" ||
    typeof callerName !== "string"
  ) return null;
  return {
    callId,
    familyId: typeof familyId === "string" ? familyId : undefined,
    nativeCallId,
    callerName,
  };
}

function resolvedCallFromMessage(message: IncomingCallMessage) {
  const { answeredByDeviceId, kind, nativeCallId, resolution } =
    message.data ?? {};
  if (
    kind !== "call-resolved" ||
    typeof nativeCallId !== "string" ||
    nativeCallId.length === 0 ||
    (resolution !== "answered" &&
      resolution !== "declined" &&
      resolution !== "ended") ||
    (answeredByDeviceId !== undefined &&
      (typeof answeredByDeviceId !== "string" ||
        answeredByDeviceId.length === 0))
  ) return null;

  return {
    answeredByDeviceId:
      typeof answeredByDeviceId === "string" ? answeredByDeviceId : undefined,
    nativeCallId,
    resolution: resolution as CallResolution,
  };
}

async function handleResolvedCallMessage(message: IncomingCallMessage) {
  const resolvedCall = resolvedCallFromMessage(message);
  if (resolvedCall === null) return false;

  if (
    resolvedCall.resolution === "answered" &&
    resolvedCall.answeredByDeviceId !== undefined
  ) {
    try {
      if (resolvedCall.answeredByDeviceId === await getDeviceId()) return true;
    } catch {
      // If local identity storage is unavailable, continue with the safe
      // losing-device behavior instead of leaving a native call ringing.
    }
  }

  // Persist first so a delayed incoming-call push cannot resurrect the native
  // surface after this device has already learned that the call was resolved.
  try {
    await recordResolvedNativeCallId(resolvedCall.nativeCallId);
  } finally {
    await dismissResolvedIncomingCall(
      resolvedCall.nativeCallId,
      resolvedCall.resolution,
    );
  }
  return true;
}

export function installBackgroundCallNotificationHandler() {
  messaging().setBackgroundMessageHandler(async (message) => {
    await enqueueNotificationHandling(async () => {
      if (await handleResolvedCallMessage(message)) return;

      const call = incomingCallFromMessage(message);
      if (!call) return;
      if (!(await areCallNotificationsEnabled())) return;
      if (await isNativeCallResolved(call.nativeCallId)) return;

      await showIncomingNativeCall(call);
      // Also close the narrow race where a resolution was recorded while the
      // native call surface was being initialized.
      if (
        !(await areCallNotificationsEnabled()) ||
        await isNativeCallResolved(call.nativeCallId)
      ) {
        await dismissResolvedIncomingCall(call.nativeCallId, "answered");
      }
    });
  });
}

export async function registerIncomingCallNotifications(
  registerToken: RegisterPushToken,
  routeForegroundCall: ForegroundIncomingCallRouter,
  deviceId: string,
  isSessionActive: () => boolean = () => true,
) {
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  await messaging().requestPermission();
  const token = await messaging().getToken();
  const platform = Platform.OS === "ios" ? "ios" : "android";
  await registerToken({ deviceId, platform, token });
  if (!isSessionActive()) return () => undefined;
  await setCallNotificationsEnabled(true);

  const unsubscribeForeground = messaging().onMessage(async (message) => {
    await enqueueNotificationHandling(async () => {
      if (await handleResolvedCallMessage(message)) return;

      const call = incomingCallFromMessage(message);
      if (!call || !(await areCallNotificationsEnabled())) return;
      if (await isNativeCallResolved(call.nativeCallId)) return;

      // The selected family's Convex subscription owns foreground presentation,
      // so a delayed push cannot leave an orphaned ringtone behind or create a
      // Telecom surface while the application is visible.
      routeForegroundCall(call.familyId);
    });
  });
  const unsubscribeRefresh = messaging().onTokenRefresh((nextToken) => {
    void (async () => {
      await registerToken({ deviceId, platform, token: nextToken });
      if (isSessionActive()) await setCallNotificationsEnabled(true);
    })().catch(() => undefined);
  });
  return () => { unsubscribeForeground(); unsubscribeRefresh(); };
}
