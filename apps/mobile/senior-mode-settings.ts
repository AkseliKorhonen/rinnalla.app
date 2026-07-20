export type SeniorModeSettings = {
  enabled: boolean;
  familyId: string | null;
  memberIds: string[];
};

export const DEFAULT_SENIOR_MODE_SETTINGS: SeniorModeSettings = {
  enabled: false,
  familyId: null,
  memberIds: [],
};

export function normalizeSeniorModeSettings(
  value: unknown,
): SeniorModeSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SENIOR_MODE_SETTINGS };
  }

  const candidate = value as Partial<SeniorModeSettings>;
  const memberIds = Array.isArray(candidate.memberIds)
    ? [...new Set(candidate.memberIds.filter(
        (memberId): memberId is string =>
          typeof memberId === "string" && memberId.length > 0,
      ))]
    : [];

  return {
    enabled: candidate.enabled === true,
    familyId:
      typeof candidate.familyId === "string" && candidate.familyId.length > 0
        ? candidate.familyId
        : null,
    memberIds,
  };
}

export function toggleSeniorModeMember(
  memberIds: string[],
  memberId: string,
) {
  return memberIds.includes(memberId)
    ? memberIds.filter((candidate) => candidate !== memberId)
    : [...memberIds, memberId];
}

export function availableSeniorModeMembers(
  settings: SeniorModeSettings,
  familyId: string,
  availableMemberIds: string[],
) {
  if (settings.familyId !== familyId) return [];
  const available = new Set(availableMemberIds);
  return settings.memberIds.filter((memberId) => available.has(memberId));
}
