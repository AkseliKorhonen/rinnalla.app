import RNCallKeep from "react-native-callkeep";
import { AppState, NativeModules, Platform } from "react-native";

type NativeCall = {
  callId: string;
  familyId?: string;
  nativeCallId: string;
  callerName: string;
};

type CallHandlers = {
  onAnswer: (callId: string, familyId?: string) => boolean;
  onEnd: (callId: string, familyId?: string) => boolean;
};

type CallPresentation =
  | "foreground-answering"
  | "foreground-ringing"
  | "in-app-active"
  | "native-active"
  | "native-demoting"
  | "native-ringing";

const callsByNativeId = new Map<string, NativeCall>();
type PendingNativeEvent = {
  kind: "answer" | "end";
  nativeCallId: string;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingEvents = new Map<string, PendingNativeEvent>();
const presentationsByNativeId = new Map<string, CallPresentation>();
const inAppEligibleNativeIds = new Set<string>();
const resolvedNativeIds = new Set<string>();
const callLaunchListeners = new Set<() => void>();
let handlers: CallHandlers | null = null;
let initialized: Promise<void> | null = null;
let callLaunchRequested = false;
let lockScreenCallOwner: string | null = null;
let orphanedNativeLaunchTimeout: ReturnType<typeof setTimeout> | null = null;

type CallKeepLockScreenModule = {
  disconnectResolvedIncomingCall?: (
    nativeCallId: string,
    disconnectReason: number,
  ) => Promise<boolean>;
  dismissIncomingCallForForeground?: (nativeCallId: string) => Promise<boolean>;
  getCallAppVisibleOverLockScreen?: () => Promise<boolean>;
  getNativeCallMetadata?: (nativeCallId: string) => Promise<{
    callId?: string;
    familyId?: string;
  } | null>;
  removeNativeCallMetadata?: (nativeCallId: string) => void;
  setCallAppVisibleOverLockScreen?: (visible: boolean) => void;
  startIncomingRingtone?: (nativeCallId: string) => void;
  stopIncomingRingtone?: (nativeCallId: string) => void;
  storeNativeCallMetadata?: (
    nativeCallId: string,
    callId: string,
    familyId: string | null,
  ) => Promise<void>;
};

const callKeepLockScreenModule = NativeModules.RNCallKeep as CallKeepLockScreenModule | undefined;

const foregroundRetryDelays = [0, 400, 1_200];
const nativeDemotionRetryDelays = [0, 150, 450, 900];
const PENDING_NATIVE_EVENT_TIMEOUT_MS = 20_000;
const MAX_RESOLVED_NATIVE_IDS = 100;

export type CallResolution = "answered" | "declined" | "ended";

const resolvedCallDisconnectReasons: Record<CallResolution, number> = {
  answered: 4,
  declined: 5,
  ended: 2,
};

function rememberResolvedNativeId(nativeCallId: string) {
  resolvedNativeIds.delete(nativeCallId);
  resolvedNativeIds.add(nativeCallId);
  while (resolvedNativeIds.size > MAX_RESOLVED_NATIVE_IDS) {
    const oldestNativeCallId = resolvedNativeIds.values().next().value;
    if (oldestNativeCallId === undefined) break;
    resolvedNativeIds.delete(oldestNativeCallId);
  }
}

function isForegroundCallPresentationAvailable() {
  return Platform.OS === "android"
    && AppState.currentState === "active"
    && typeof callKeepLockScreenModule?.startIncomingRingtone === "function"
    && typeof callKeepLockScreenModule?.stopIncomingRingtone === "function";
}

function stopIncomingRingtone(nativeCallId: string) {
  callKeepLockScreenModule?.stopIncomingRingtone?.(nativeCallId);
}

export function getCallAppLockScreenVisibility() {
  return callLaunchRequested;
}

export function subscribeToCallAppLockScreenVisibility(listener: () => void) {
  callLaunchListeners.add(listener);
  return () => callLaunchListeners.delete(listener);
}

function notifyCallLaunchListeners() {
  for (const listener of callLaunchListeners) listener();
}

function clearOrphanedNativeLaunchTimeout() {
  if (!orphanedNativeLaunchTimeout) return;
  clearTimeout(orphanedNativeLaunchTimeout);
  orphanedNativeLaunchTimeout = null;
}

function scheduleOrphanedNativeLaunchTimeout() {
  clearOrphanedNativeLaunchTimeout();
  orphanedNativeLaunchTimeout = setTimeout(() => {
    orphanedNativeLaunchTimeout = null;
    forceClearCallAppLockScreenVisibility();
  }, PENDING_NATIVE_EVENT_TIMEOUT_MS);
}

function setCallAppVisibleOverLockScreen(visible: boolean, nativeCallId?: string) {
  if (!visible && lockScreenCallOwner) {
    if (!nativeCallId || lockScreenCallOwner !== nativeCallId) return;
  }

  const previousVisibility = callLaunchRequested;
  if (visible && nativeCallId) lockScreenCallOwner = nativeCallId;
  if (!visible) {
    lockScreenCallOwner = null;
    clearOrphanedNativeLaunchTimeout();
  }
  callLaunchRequested = visible;
  if (Platform.OS === "android") {
    callKeepLockScreenModule?.setCallAppVisibleOverLockScreen?.(visible);
  }
  if (previousVisibility !== visible) notifyCallLaunchListeners();
}

export function forceClearCallAppLockScreenVisibility() {
  lockScreenCallOwner = null;
  setCallAppVisibleOverLockScreen(false);
}

export function clearCallAppLockScreenVisibility(nativeCallId?: string) {
  setCallAppVisibleOverLockScreen(false, nativeCallId);
}

export function bringCallAppToForeground(nativeCallId?: string) {
  setCallAppVisibleOverLockScreen(true, nativeCallId);
  for (const delay of foregroundRetryDelays) {
    const focus = () => {
      if (!callLaunchRequested) return;
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
    const resources: {
      timeout?: ReturnType<typeof setTimeout>;
      subscription?: ReturnType<typeof AppState.addEventListener>;
    } = {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (resources.timeout) clearTimeout(resources.timeout);
      resources.subscription?.remove();
      if (error) reject(error);
      else resolve();
    };

    resources.subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") finish();
    });
    resources.timeout = setTimeout(() => {
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

function pendingEventKey(kind: "answer" | "end", nativeCallId: string) {
  return `${kind}:${nativeCallId}`;
}

function removePendingEvent(kind: "answer" | "end", nativeCallId: string) {
  const key = pendingEventKey(kind, nativeCallId);
  const pending = pendingEvents.get(key);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingEvents.delete(key);
}

function queuePendingEvent(kind: "answer" | "end", nativeCallId: string) {
  const key = pendingEventKey(kind, nativeCallId);
  if (pendingEvents.has(key)) return;
  const timeout = setTimeout(() => {
    pendingEvents.delete(key);
    if (kind === "answer") dismissNativeCall(nativeCallId);
  }, PENDING_NATIVE_EVENT_TIMEOUT_MS);
  pendingEvents.set(key, { kind, nativeCallId, timeout });
}

function dispatch(kind: "answer" | "end", nativeCallId: string) {
  const call = callsByNativeId.get(nativeCallId);
  if (!call) {
    if (kind === "answer") queuePendingEvent(kind, nativeCallId);
    return;
  }
  if (!handlers) {
    queuePendingEvent(kind, nativeCallId);
    return;
  }

  const handled = kind === "answer"
    ? handlers.onAnswer(call.callId, call.familyId)
    : handlers.onEnd(call.callId, call.familyId);
  if (handled) removePendingEvent(kind, nativeCallId);
  else queuePendingEvent(kind, nativeCallId);
}

function flushPendingEvents() {
  for (const event of pendingEvents.values()) dispatch(event.kind, event.nativeCallId);
}

async function restoreNativeCall(nativeCallId: string) {
  if (
    resolvedNativeIds.has(nativeCallId)
    || callsByNativeId.has(nativeCallId)
  ) return;
  try {
    const metadata = await callKeepLockScreenModule?.getNativeCallMetadata?.(nativeCallId);
    if (metadata && typeof metadata.callId === "string") {
      callsByNativeId.set(nativeCallId, {
        callId: metadata.callId,
        familyId: typeof metadata.familyId === "string" ? metadata.familyId : undefined,
        nativeCallId,
        callerName: "Family member",
      });
      if (!presentationsByNativeId.has(nativeCallId)) {
        presentationsByNativeId.set(nativeCallId, "native-ringing");
      }
    }
  } catch {
    // receiveNativeEvent consumes cold-start events whose metadata is gone.
  }
}

async function receiveNativeEvent(kind: "answer" | "end", nativeCallId: string) {
  // A legitimate cold-start event has persisted metadata. Restore it before
  // doing anything visible; resolved calls remove that metadata and must not
  // relaunch the app or leave a 20-second pending answer behind.
  await restoreNativeCall(nativeCallId);
  if (
    resolvedNativeIds.has(nativeCallId)
    || !callsByNativeId.has(nativeCallId)
  ) {
    stopIncomingRingtone(nativeCallId);
    presentationsByNativeId.delete(nativeCallId);
    clearCallAppLockScreenVisibility(nativeCallId);
    removePendingEvent("answer", nativeCallId);
    removePendingEvent("end", nativeCallId);
    callKeepLockScreenModule?.removeNativeCallMetadata?.(nativeCallId);
    return;
  }

  if (kind === "answer") {
    clearOrphanedNativeLaunchTimeout();
    if (presentationsByNativeId.get(nativeCallId) === "native-ringing") {
      presentationsByNativeId.set(nativeCallId, "native-active");
    }
    bringCallAppToForeground(nativeCallId);
  }
  else {
    stopIncomingRingtone(nativeCallId);
    presentationsByNativeId.delete(nativeCallId);
    clearCallAppLockScreenVisibility(nativeCallId);
  }
  if (kind === "answer") {
    presentationsByNativeId.set(nativeCallId, "native-active");
  } else {
    presentationsByNativeId.delete(nativeCallId);
  }
  dispatch(kind, nativeCallId);
}

export async function initializeNativeCallService() {
  if (initialized) return initialized;

  initialized = (async () => {
    RNCallKeep.addEventListener("answerCall", ({ callUUID }) => {
      void receiveNativeEvent("answer", callUUID);
    });
    RNCallKeep.addEventListener("endCall", ({ callUUID }) => {
      void receiveNativeEvent("end", callUUID);
    });

    if (Platform.OS === "android") {
      if (!callKeepLockScreenModule?.getCallAppVisibleOverLockScreen) {
        throw new Error("The native call lock-screen bridge is unavailable.");
      }
      const nativeVisibility =
        await callKeepLockScreenModule.getCallAppVisibleOverLockScreen();
      if (nativeVisibility && !callLaunchRequested) {
        setCallAppVisibleOverLockScreen(true);
        scheduleOrphanedNativeLaunchTimeout();
      }
    }

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

    const initialEvents = await RNCallKeep.getInitialEvents();
    for (const event of initialEvents) {
      if (event.name === "RNCallKeepPerformAnswerCallAction") {
        await receiveNativeEvent("answer", event.data.callUUID);
      }
      if (event.name === "RNCallKeepPerformEndCallAction") {
        await receiveNativeEvent("end", event.data.callUUID);
      }
    }
    RNCallKeep.clearInitialEvents();

    if (Platform.OS === "android") {
      AppState.addEventListener("change", (state) => {
        if (state === "active") {
          for (const [nativeCallId, presentation] of presentationsByNativeId) {
            if (
              presentation !== "native-ringing"
              || !inAppEligibleNativeIds.has(nativeCallId)
            ) continue;
            const call = callsByNativeId.get(nativeCallId);
            if (call) void moveNativeIncomingCallToForeground(call);
          }
          return;
        }

        if (state === "background") {
          for (const [nativeCallId, presentation] of presentationsByNativeId) {
            if (presentation !== "foreground-ringing") continue;
            const call = callsByNativeId.get(nativeCallId);
            if (call) void presentNativeIncomingCall(call);
          }
        }
      });
    }
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

function rememberCall(call: NativeCall) {
  const existingCall = callsByNativeId.get(call.nativeCallId);
  const rememberedCall = {
    ...existingCall,
    ...call,
    familyId: call.familyId ?? existingCall?.familyId,
  };
  callsByNativeId.set(call.nativeCallId, rememberedCall);
  return rememberedCall;
}

async function storeNativeCallMetadata(call: NativeCall) {
  try {
    await callKeepLockScreenModule?.storeNativeCallMetadata?.(
      call.nativeCallId,
      call.callId,
      call.familyId ?? null,
    );
  } catch {
    // CallKeep can still present the call; cold-start recovery will use its timeout fallback.
  }
}

async function presentNativeIncomingCall(
  call: NativeCall,
  allowForegroundFallback = true,
) {
  if (resolvedNativeIds.has(call.nativeCallId)) return;
  const currentPresentation = presentationsByNativeId.get(call.nativeCallId);
  if (
    currentPresentation === "native-ringing"
    || currentPresentation === "native-active"
    || currentPresentation === "native-demoting"
  ) {
    return;
  }

  stopIncomingRingtone(call.nativeCallId);
  presentationsByNativeId.set(call.nativeCallId, "native-ringing");
  await storeNativeCallMetadata(call);

  const rememberedCall = callsByNativeId.get(call.nativeCallId);
  if (
    resolvedNativeIds.has(call.nativeCallId)
    || rememberedCall?.callId !== call.callId
    || presentationsByNativeId.get(call.nativeCallId) !== "native-ringing"
  ) return;

  if (allowForegroundFallback && isForegroundCallPresentationAvailable()) {
    presentationsByNativeId.delete(call.nativeCallId);
    callKeepLockScreenModule?.removeNativeCallMetadata?.(call.nativeCallId);
    presentForegroundIncomingCall(rememberedCall);
    return;
  }

  try {
    RNCallKeep.displayIncomingCall(
      call.nativeCallId,
      call.callerName,
      call.callerName,
      "generic",
      true,
    );
  } catch (error) {
    presentationsByNativeId.delete(call.nativeCallId);
    throw error;
  }
}

function presentForegroundIncomingCall(call: NativeCall) {
  const currentPresentation = presentationsByNativeId.get(call.nativeCallId);
  if (currentPresentation) return true;
  presentationsByNativeId.set(call.nativeCallId, "foreground-ringing");
  try {
    callKeepLockScreenModule?.startIncomingRingtone?.(call.nativeCallId);
    return true;
  } catch {
    presentationsByNativeId.delete(call.nativeCallId);
    return false;
  }
}

async function moveNativeIncomingCallToForeground(call: NativeCall) {
  const dismissIncomingCall =
    callKeepLockScreenModule?.dismissIncomingCallForForeground;
  if (
    typeof dismissIncomingCall !== "function"
    || presentationsByNativeId.get(call.nativeCallId) !== "native-ringing"
  ) return false;

  presentationsByNativeId.set(call.nativeCallId, "native-demoting");
  for (const delay of nativeDemotionRetryDelays) {
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    if (presentationsByNativeId.get(call.nativeCallId) !== "native-demoting") {
      return false;
    }
    if (!isForegroundCallPresentationAvailable()) {
      presentationsByNativeId.set(call.nativeCallId, "native-ringing");
      return false;
    }

    let dismissed = false;
    try {
      dismissed = await dismissIncomingCall(call.nativeCallId);
    } catch {
      // Telecom creates its connection asynchronously; retry while the app
      // remains ready to present the call itself.
    }
    if (!dismissed) continue;
    if (presentationsByNativeId.get(call.nativeCallId) !== "native-demoting") {
      return false;
    }

    presentationsByNativeId.delete(call.nativeCallId);
    callKeepLockScreenModule?.removeNativeCallMetadata?.(call.nativeCallId);
    if (isForegroundCallPresentationAvailable()) {
      return presentForegroundIncomingCall(call);
    }

    await presentNativeIncomingCall(call, false);
    return false;
  }

  if (presentationsByNativeId.get(call.nativeCallId) === "native-demoting") {
    presentationsByNativeId.set(call.nativeCallId, "native-ringing");
  }
  return false;
}

export async function showIncomingCall(call: NativeCall) {
  if (resolvedNativeIds.has(call.nativeCallId)) return;
  const rememberedCall = rememberCall(call);
  inAppEligibleNativeIds.add(call.nativeCallId);
  await initializeNativeCallService();
  if (
    callsByNativeId.get(call.nativeCallId)?.callId !== call.callId
    || resolvedNativeIds.has(call.nativeCallId)
    || !inAppEligibleNativeIds.has(call.nativeCallId)
  ) return;
  if (isForegroundCallPresentationAvailable()) {
    const presentation = presentationsByNativeId.get(call.nativeCallId);
    if (presentation === "native-ringing") {
      await moveNativeIncomingCallToForeground(rememberedCall);
    } else if (!presentForegroundIncomingCall(rememberedCall)) {
      await presentNativeIncomingCall(rememberedCall, false);
    }
  } else {
    await presentNativeIncomingCall(rememberedCall);
  }
  flushPendingEvents();
}

export async function showIncomingNativeCall(call: NativeCall) {
  if (resolvedNativeIds.has(call.nativeCallId)) return;
  const rememberedCall = rememberCall(call);
  await initializeNativeCallService();
  if (
    resolvedNativeIds.has(call.nativeCallId)
    || callsByNativeId.get(call.nativeCallId)?.callId !== call.callId
  ) return;

  const presentation = presentationsByNativeId.get(call.nativeCallId);
  if (
    AppState.currentState === "active"
    && (
      presentation === "foreground-ringing"
      || presentation === "foreground-answering"
      || presentation === "in-app-active"
    )
  ) {
    flushPendingEvents();
    return;
  }

  await presentNativeIncomingCall(rememberedCall, false);
  if (
    !resolvedNativeIds.has(call.nativeCallId)
    && AppState.currentState === "active"
    && inAppEligibleNativeIds.has(call.nativeCallId)
    && presentationsByNativeId.get(call.nativeCallId) === "native-ringing"
  ) {
    await moveNativeIncomingCallToForeground(rememberedCall);
  }
  flushPendingEvents();
}

export function claimIncomingCallInApp(nativeCallId: string) {
  if (presentationsByNativeId.get(nativeCallId) !== "foreground-ringing") return false;
  stopIncomingRingtone(nativeCallId);
  presentationsByNativeId.set(nativeCallId, "foreground-answering");
  return true;
}

export async function resumeIncomingCallAlert(call: NativeCall) {
  const presentation = presentationsByNativeId.get(call.nativeCallId);
  if (presentation && presentation !== "foreground-answering") return;
  presentationsByNativeId.delete(call.nativeCallId);
  await showIncomingCall(call);
}

export function markNativeCallActive(nativeCallId: string) {
  if (!callsByNativeId.has(nativeCallId)) return;
  stopIncomingRingtone(nativeCallId);
  const presentation = presentationsByNativeId.get(nativeCallId);
  if (
    presentation === "native-ringing"
    || presentation === "native-active"
    || presentation === "native-demoting"
  ) {
    presentationsByNativeId.set(nativeCallId, "native-active");
    RNCallKeep.setCurrentCallActive(nativeCallId);
    bringCallAppToForeground(nativeCallId);
  } else {
    presentationsByNativeId.set(nativeCallId, "in-app-active");
  }
}

export function dismissNativeCall(nativeCallId: string) {
  const presentation = presentationsByNativeId.get(nativeCallId);
  stopIncomingRingtone(nativeCallId);
  presentationsByNativeId.delete(nativeCallId);
  clearCallAppLockScreenVisibility(nativeCallId);
  callsByNativeId.delete(nativeCallId);
  inAppEligibleNativeIds.delete(nativeCallId);
  removePendingEvent("answer", nativeCallId);
  removePendingEvent("end", nativeCallId);
  callKeepLockScreenModule?.removeNativeCallMetadata?.(nativeCallId);
  if (
    presentation === "native-ringing"
    || presentation === "native-active"
    || presentation === "native-demoting"
  ) {
    RNCallKeep.endCall(nativeCallId);
  }
}

export async function dismissResolvedIncomingCall(
  nativeCallId: string,
  resolution: CallResolution,
) {
  rememberResolvedNativeId(nativeCallId);
  stopIncomingRingtone(nativeCallId);
  presentationsByNativeId.set(nativeCallId, "native-demoting");
  clearCallAppLockScreenVisibility(nativeCallId);
  callsByNativeId.delete(nativeCallId);
  inAppEligibleNativeIds.delete(nativeCallId);
  removePendingEvent("answer", nativeCallId);
  removePendingEvent("end", nativeCallId);
  callKeepLockScreenModule?.removeNativeCallMetadata?.(nativeCallId);

  const dismissIncomingCall =
    callKeepLockScreenModule?.disconnectResolvedIncomingCall;
  if (typeof dismissIncomingCall === "function") {
    for (const delay of nativeDemotionRetryDelays) {
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      try {
        if (
          await dismissIncomingCall(
            nativeCallId,
            resolvedCallDisconnectReasons[resolution],
          )
        ) break;
      } catch {
        // Telecom may still be creating the connection after a cold JS start.
        // Retrying disconnects it without generating ACTION_END_CALL.
      }
    }
  } else {
    // Keep older development builds safe during a rolling JS/native update.
    // The legacy bridge is silent but can only report "answered elsewhere".
    const legacyDismiss =
      callKeepLockScreenModule?.dismissIncomingCallForForeground;
    if (typeof legacyDismiss === "function") {
      for (const delay of nativeDemotionRetryDelays) {
        if (delay > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
        try {
          if (await legacyDismiss(nativeCallId)) break;
        } catch {
          // Retry while Telecom finishes creating the connection.
        }
      }
    }
  }

  presentationsByNativeId.delete(nativeCallId);
  removePendingEvent("answer", nativeCallId);
  removePendingEvent("end", nativeCallId);
  // A presentation that was still persisting metadata when resolution arrived
  // may have recreated it after the first removal. Clear it again after retries.
  callKeepLockScreenModule?.removeNativeCallMetadata?.(nativeCallId);
}
