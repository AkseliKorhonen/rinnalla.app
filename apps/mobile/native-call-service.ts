import RNCallKeep from "react-native-callkeep";
import { AppState, Platform } from "react-native";

type NativeCall = {
  callId: string;
  nativeCallId: string;
  callerName: string;
};

type CallHandlers = {
  onAnswer: (callId: string) => boolean;
  onEnd: (callId: string) => boolean;
};

const callsByNativeId = new Map<string, NativeCall>();
const pendingEvents: Array<{ kind: "answer" | "end"; nativeCallId: string }> = [];
let handlers: CallHandlers | null = null;
let initialized: Promise<void> | null = null;

const foregroundRetryDelays = [0, 400, 1_200];

export function bringCallAppToForeground() {
  for (const delay of foregroundRetryDelays) {
    const focus = () => {
      if (delay === 0 || AppState.currentState !== "active") {
        RNCallKeep.backToForeground();
      }
    };
    if (delay === 0) focus();
    else setTimeout(focus, delay);
  }
}

export function waitForCallAppForeground(timeoutMs = 5_000) {
  if (Platform.OS !== "android" || AppState.currentState === "active") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };

    subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") finish();
    });
    timeout = setTimeout(() => {
      finish(new Error("Open rinnalla.app to enable the camera for this call."));
    }, timeoutMs);

    bringCallAppToForeground();
    if (AppState.currentState === "active") finish();
  });
}

function isMissingReactActivityError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "E_ACTIVITY_DOES_NOT_EXIST"
    && typeof candidate.message === "string"
    && /activity doesn't exist/i.test(candidate.message);
}

function queuePendingEvent(kind: "answer" | "end", nativeCallId: string) {
  if (pendingEvents.some((event) => event.kind === kind && event.nativeCallId === nativeCallId)) return;
  pendingEvents.push({ kind, nativeCallId });
}

function dispatch(kind: "answer" | "end", nativeCallId: string) {
  const call = callsByNativeId.get(nativeCallId);
  if (!call || !handlers) {
    queuePendingEvent(kind, nativeCallId);
    return;
  }

  const handled = kind === "answer"
    ? handlers.onAnswer(call.callId)
    : handlers.onEnd(call.callId);
  if (!handled) queuePendingEvent(kind, nativeCallId);
}

function flushPendingEvents() {
  for (const event of pendingEvents.splice(0)) dispatch(event.kind, event.nativeCallId);
}

function receiveNativeEvent(kind: "answer" | "end", nativeCallId: string) {
  if (kind === "answer") bringCallAppToForeground();
  dispatch(kind, nativeCallId);
}

export async function initializeNativeCallService() {
  if (initialized) return initialized;

  initialized = (async () => {
    try {
      await RNCallKeep.setup({
        ios: {
          appName: "rinnalla.app",
          includesCallsInRecents: false,
          supportsVideo: true,
        },
        android: {
          alertTitle: "Calling permission needed",
          alertDescription: "rinnalla.app needs calling access to show incoming calls.",
          cancelButton: "Not now",
          okButton: "Continue",
          additionalPermissions: ["android.permission.RECORD_AUDIO"],
          foregroundService: {
            channelId: "rinnalla-calls",
            channelName: "Calls in progress",
            notificationTitle: "A call is in progress",
          },
        },
      });
    } catch (error) {
      // Android Headless JS has no Activity. CallKeep's native setup has already
      // completed before its JS wrapper performs this foreground-only check.
      if (!isMissingReactActivityError(error)) throw error;
    }

    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => receiveNativeEvent("answer", callUUID));
    RNCallKeep.addEventListener("endCall", ({ callUUID }) => receiveNativeEvent("end", callUUID));

    const initialEvents = await RNCallKeep.getInitialEvents();
    for (const event of initialEvents) {
      if (event.name === "RNCallKeepPerformAnswerCallAction") {
        receiveNativeEvent("answer", event.data.callUUID);
      }
      if (event.name === "RNCallKeepPerformEndCallAction") {
        receiveNativeEvent("end", event.data.callUUID);
      }
    }
    RNCallKeep.clearInitialEvents();
  })();

  return initialized;
}

export function setNativeCallHandlers(nextHandlers: CallHandlers) {
  handlers = nextHandlers;
  flushPendingEvents();
  return () => {
    if (handlers === nextHandlers) handlers = null;
  };
}

export async function showIncomingNativeCall(call: NativeCall) {
  await initializeNativeCallService();
  if (!callsByNativeId.has(call.nativeCallId)) {
    callsByNativeId.set(call.nativeCallId, call);
    RNCallKeep.displayIncomingCall(
      call.nativeCallId,
      call.callerName,
      call.callerName,
      "generic",
      true,
    );
  }
  flushPendingEvents();
}

export function markNativeCallActive(nativeCallId: string) {
  if (!callsByNativeId.has(nativeCallId)) return;
  RNCallKeep.setCurrentCallActive(nativeCallId);
  bringCallAppToForeground();
}

export function dismissNativeCall(nativeCallId: string) {
  if (!callsByNativeId.has(nativeCallId)) return;
  callsByNativeId.delete(nativeCallId);
  RNCallKeep.endCall(nativeCallId);
}
