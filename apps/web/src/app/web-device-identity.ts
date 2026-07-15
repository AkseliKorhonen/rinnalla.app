const DEVICE_ID_STORAGE_KEY = "rinnalla.app.web-device-id.v1";

let sessionDeviceId: string | null = null;

function createDeviceId() {
  if (typeof crypto.randomUUID === "function") {
    return `web-${crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function getOrCreateWebDeviceId() {
  if (sessionDeviceId !== null) return sessionDeviceId;

  try {
    const storedDeviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (storedDeviceId) {
      sessionDeviceId = storedDeviceId;
      return storedDeviceId;
    }

    const deviceId = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    sessionDeviceId = deviceId;
    return deviceId;
  } catch {
    sessionDeviceId = createDeviceId();
    return sessionDeviceId;
  }
}
