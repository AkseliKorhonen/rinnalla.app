import messaging, { type FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import { PermissionsAndroid, Platform } from "react-native";
import { showIncomingNativeCall } from "./native-call-service";

type IncomingCallMessage = FirebaseMessagingTypes.RemoteMessage;

async function showIncomingCallFromMessage(message: IncomingCallMessage) {
  const { callId, callerName, kind, nativeCallId } = message.data ?? {};
  if (
    kind !== "incoming-call" ||
    typeof callId !== "string" ||
    typeof nativeCallId !== "string" ||
    typeof callerName !== "string"
  ) return;
  await showIncomingNativeCall({ callId, nativeCallId, callerName: callerName ?? "Family member" });
}

export function installBackgroundCallNotificationHandler() {
  messaging().setBackgroundMessageHandler(async (message) => {
    await showIncomingCallFromMessage(message);
  });
}

export async function registerIncomingCallNotifications(registerToken: (args: { platform: "android" | "ios"; token: string }) => Promise<unknown>) {
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  await messaging().requestPermission();
  const token = await messaging().getToken();
  await registerToken({ platform: Platform.OS === "ios" ? "ios" : "android", token });

  const unsubscribeForeground = messaging().onMessage(async (message) => showIncomingCallFromMessage(message));
  const unsubscribeRefresh = messaging().onTokenRefresh((nextToken) => {
    void registerToken({ platform: Platform.OS === "ios" ? "ios" : "android", token: nextToken });
  });
  return () => { unsubscribeForeground(); unsubscribeRefresh(); };
}
