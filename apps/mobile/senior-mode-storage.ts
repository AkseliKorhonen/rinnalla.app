import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_SENIOR_MODE_SETTINGS,
  normalizeSeniorModeSettings,
  type SeniorModeSettings,
} from "./senior-mode-settings";

const SENIOR_MODE_STORAGE_KEY_PREFIX = "rinnalla.senior-mode.v1";

function seniorModeStorageKey(userId: string) {
  return `${SENIOR_MODE_STORAGE_KEY_PREFIX}.${userId}`;
}

export async function getSeniorModeSettings(userId: string) {
  const stored = await SecureStore.getItemAsync(seniorModeStorageKey(userId));
  if (!stored) return { ...DEFAULT_SENIOR_MODE_SETTINGS };

  try {
    return normalizeSeniorModeSettings(JSON.parse(stored) as unknown);
  } catch {
    return { ...DEFAULT_SENIOR_MODE_SETTINGS };
  }
}

export async function setSeniorModeSettings(
  userId: string,
  settings: SeniorModeSettings,
) {
  const normalized = normalizeSeniorModeSettings(settings);
  await SecureStore.setItemAsync(
    seniorModeStorageKey(userId),
    JSON.stringify(normalized),
  );
  return normalized;
}
