import RNCallKeep from "react-native-callkeep";

type NativeCall = {
  callId: string;
  nativeCallId: string;
  callerName: string;
};

type CallHandlers = {
  onAnswer: (callId: string) => void;
  onEnd: (callId: string) => void;
};

const callsByNativeId = new Map<string, NativeCall>();
const pendingEvents: Array<{ kind: "answer" | "end"; nativeCallId: string }> = [];
let handlers: CallHandlers | null = null;
let initialized: Promise<void> | null = null;

function dispatch(kind: "answer" | "end", nativeCallId: string) {
  const call = callsByNativeId.get(nativeCallId);
  if (!call) {
    pendingEvents.push({ kind, nativeCallId });
    return;
  }

  if (kind === "answer") handlers?.onAnswer(call.callId);
  else handlers?.onEnd(call.callId);
}

export async function initializeNativeCallService() {
  if (initialized) return initialized;

  initialized = (async () => {
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

    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => dispatch("answer", callUUID));
    RNCallKeep.addEventListener("endCall", ({ callUUID }) => dispatch("end", callUUID));

    const initialEvents = await RNCallKeep.getInitialEvents();
    for (const event of initialEvents) {
      if (event.name === "RNCallKeepPerformAnswerCallAction") {
        dispatch("answer", event.data.callUUID);
      }
      if (event.name === "RNCallKeepPerformEndCallAction") {
        dispatch("end", event.data.callUUID);
      }
    }
    RNCallKeep.clearInitialEvents();
  })();

  return initialized;
}

export function setNativeCallHandlers(nextHandlers: CallHandlers) {
  handlers = nextHandlers;
  for (const event of pendingEvents.splice(0)) dispatch(event.kind, event.nativeCallId);
  return () => {
    if (handlers === nextHandlers) handlers = null;
  };
}

export async function showIncomingNativeCall(call: NativeCall) {
  await initializeNativeCallService();
  if (callsByNativeId.has(call.nativeCallId)) return;
  callsByNativeId.set(call.nativeCallId, call);
  RNCallKeep.displayIncomingCall(
    call.nativeCallId,
    call.callerName,
    call.callerName,
    "generic",
    true,
  );
}

export async function showOutgoingNativeCall(call: NativeCall) {
  await initializeNativeCallService();
  if (callsByNativeId.has(call.nativeCallId)) return;
  callsByNativeId.set(call.nativeCallId, call);
  RNCallKeep.startCall(call.nativeCallId, call.callerName, call.callerName, "generic", true);
}

export function markNativeCallActive(nativeCallId: string) {
  RNCallKeep.setCurrentCallActive(nativeCallId);
}

export function dismissNativeCall(nativeCallId: string) {
  callsByNativeId.delete(nativeCallId);
  RNCallKeep.endCall(nativeCallId);
}
