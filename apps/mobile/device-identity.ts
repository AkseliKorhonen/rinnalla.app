import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_STORAGE_KEY = "rinnalla.device-id.v1";
const CALL_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "rinnalla.call-notifications-enabled.v1";
const RESOLVED_CALLS_STORAGE_KEY = "rinnalla.resolved-native-calls.v1";
const RESOLVED_CALL_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESOLVED_CALLS = 20;

type ResolvedCallTombstone = {
  nativeCallId: string;
  resolvedAt: number;
};

let cachedDeviceId: string | null = null;
let deviceIdPromise: Promise<string> | null = null;
let callNotificationsEnabledCache: boolean | null = null;
let callNotificationsEnabledLoad: Promise<boolean> | null = null;
let callNotificationsEnabledWrites = Promise.resolve();
let resolvedCallCache: ResolvedCallTombstone[] | null = null;
let resolvedCallLoad: Promise<ResolvedCallTombstone[]> | null = null;
let resolvedCallWrites = Promise.resolve();

export async function getDeviceId() {
  if (cachedDeviceId !== null) return cachedDeviceId;
  if (deviceIdPromise !== null) return await deviceIdPromise;

  deviceIdPromise = (async () => {
    const storedDeviceId = await SecureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
    if (storedDeviceId) {
      cachedDeviceId = storedDeviceId;
      return storedDeviceId;
    }

    const nextDeviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, nextDeviceId);
    cachedDeviceId = nextDeviceId;
    return nextDeviceId;
  })();

  try {
    return await deviceIdPromise;
  } finally {
    deviceIdPromise = null;
  }
}

export async function setCallNotificationsEnabled(enabled: boolean) {
  // Update the in-process guard immediately. This is especially important on
  // sign-out, when a queued FCM callback may already be waiting to run.
  callNotificationsEnabledCache = enabled;
  callNotificationsEnabledWrites = callNotificationsEnabledWrites
    .catch(() => undefined)
    .then(async () => {
      await SecureStore.setItemAsync(
        CALL_NOTIFICATIONS_ENABLED_STORAGE_KEY,
        enabled ? "true" : "false",
      );
    });
  await callNotificationsEnabledWrites;
}

export async function areCallNotificationsEnabled() {
  if (callNotificationsEnabledCache !== null) {
    return callNotificationsEnabledCache;
  }
  if (callNotificationsEnabledLoad !== null) {
    return await callNotificationsEnabledLoad;
  }

  callNotificationsEnabledLoad = (async () => {
    const stored = await SecureStore.getItemAsync(
      CALL_NOTIFICATIONS_ENABLED_STORAGE_KEY,
    );
    const enabled = stored === "true";
    // A concurrent sign-out may already have changed the cache while the
    // SecureStore read was in flight. Never overwrite that newer value.
    if (callNotificationsEnabledCache === null) {
      callNotificationsEnabledCache = enabled;
    }
    return callNotificationsEnabledCache;
  })();

  try {
    return await callNotificationsEnabledLoad;
  } finally {
    callNotificationsEnabledLoad = null;
  }
}

function pruneResolvedCalls(value: unknown, now = Date.now()) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .filter((entry): entry is ResolvedCallTombstone => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Partial<ResolvedCallTombstone>;
      if (
        typeof candidate.nativeCallId !== "string" ||
        candidate.nativeCallId.length === 0 ||
        typeof candidate.resolvedAt !== "number" ||
        !Number.isFinite(candidate.resolvedAt) ||
        now - candidate.resolvedAt > RESOLVED_CALL_TTL_MS ||
        seen.has(candidate.nativeCallId)
      ) {
        return false;
      }
      seen.add(candidate.nativeCallId);
      return true;
    })
    .sort((left, right) => right.resolvedAt - left.resolvedAt)
    .slice(0, MAX_RESOLVED_CALLS);
}

async function loadResolvedCalls() {
  if (resolvedCallCache !== null) {
    resolvedCallCache = pruneResolvedCalls(resolvedCallCache);
    return resolvedCallCache;
  }
  if (resolvedCallLoad !== null) return await resolvedCallLoad;

  resolvedCallLoad = (async () => {
    const stored = await SecureStore.getItemAsync(RESOLVED_CALLS_STORAGE_KEY);
    let parsed: unknown = [];
    if (stored) {
      try {
        parsed = JSON.parse(stored) as unknown;
      } catch {
        parsed = [];
      }
    }
    const entries = pruneResolvedCalls(parsed);
    if (resolvedCallCache === null) resolvedCallCache = entries;
    return resolvedCallCache;
  })();

  try {
    return await resolvedCallLoad;
  } finally {
    resolvedCallLoad = null;
  }
}

export async function recordResolvedNativeCallId(nativeCallId: string) {
  resolvedCallWrites = resolvedCallWrites
    .catch(() => undefined)
    .then(async () => {
      const current = await loadResolvedCalls();
      const next = pruneResolvedCalls([
        { nativeCallId, resolvedAt: Date.now() },
        ...current.filter((entry) => entry.nativeCallId !== nativeCallId),
      ]);
      resolvedCallCache = next;
      await SecureStore.setItemAsync(
        RESOLVED_CALLS_STORAGE_KEY,
        JSON.stringify(next),
      );
    });
  await resolvedCallWrites;
}

export async function isNativeCallResolved(nativeCallId: string) {
  await resolvedCallWrites.catch(() => undefined);
  const resolvedCalls = await loadResolvedCalls();
  return resolvedCalls.some((entry) => entry.nativeCallId === nativeCallId);
}
