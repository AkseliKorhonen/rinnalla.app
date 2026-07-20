type SeniorModeLayoutInput = {
  height: number;
  horizontalPadding: number;
  isLandscape: boolean;
  isTablet: boolean;
  memberCount: number;
  width: number;
};

const GRID_GAP = 20;

export function getSeniorModeLayout({
  height,
  horizontalPadding,
  isLandscape,
  isTablet,
  memberCount,
  width,
}: SeniorModeLayoutInput) {
  const maximumColumns = isLandscape ? (isTablet ? 3 : 2) : (isTablet ? 2 : 1);
  const columns = Math.max(1, Math.min(memberCount, maximumColumns));
  const availableWidth = width
    - horizontalPadding
    - Math.max(0, columns - 1) * GRID_GAP;
  const tileWidth = Math.max(180, Math.floor(availableWidth / columns));
  const avatarSize = Math.max(
    132,
    Math.min(tileWidth - 32, isLandscape ? height * 0.46 : 260),
  );

  return { avatarSize, columns, gap: GRID_GAP, tileWidth };
}
