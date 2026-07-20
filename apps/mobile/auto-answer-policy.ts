export const AUTO_ANSWER_DELAY_MS = 10_000;

export function canOfferAutoAnswer(
  enabled: boolean,
  appState: string | null | undefined,
) {
  return enabled && appState === "active";
}

export function shouldAcceptAutoAnswer(
  enabled: boolean,
  appState: string | null | undefined,
  deviceId: string,
  offeredByDeviceId: string | undefined,
  requestedAt: number | undefined,
) {
  return (
    canOfferAutoAnswer(enabled, appState)
    && offeredByDeviceId === deviceId
    && requestedAt !== undefined
  );
}
