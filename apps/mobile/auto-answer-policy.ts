export function shouldAutoAnswerCall(
  enabled: boolean,
  appState: string | null | undefined,
) {
  return enabled && appState === "active";
}
