import { useWindowDimensions } from "react-native";

const TABLET_SHORTEST_EDGE = 600;
const WIDE_LAYOUT_WIDTH = 900;
const COMPACT_LANDSCAPE_HEIGHT = 500;

export function useResponsiveLayout() {
  const { fontScale, height, width } = useWindowDimensions();
  const shortestEdge = Math.min(width, height);
  const isLandscape = width > height;
  const isTablet = shortestEdge >= TABLET_SHORTEST_EDGE;
  const isWide = isTablet && width >= WIDE_LAYOUT_WIDTH;
  const isCompactLandscape = isLandscape && height < COMPACT_LANDSCAPE_HEIGHT;

  return {
    fontScale,
    height,
    isCompactLandscape,
    isLandscape,
    isTablet,
    isWide,
    shortestEdge,
    width,
  };
}
