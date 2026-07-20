import { describe, expect, test } from "vitest";
import { getSeniorModeLayout } from "./senior-mode-layout";

describe("Senior mode responsive layout", () => {
  test.each([
    {
      expectedColumns: 1,
      height: 844,
      isLandscape: false,
      isTablet: false,
      label: "phone portrait",
      width: 390,
    },
    {
      expectedColumns: 2,
      height: 390,
      isLandscape: true,
      isTablet: false,
      label: "phone landscape",
      width: 844,
    },
    {
      expectedColumns: 2,
      height: 1024,
      isLandscape: false,
      isTablet: true,
      label: "tablet portrait",
      width: 768,
    },
    {
      expectedColumns: 3,
      height: 768,
      isLandscape: true,
      isTablet: true,
      label: "tablet or desktop landscape",
      width: 1366,
    },
  ])("uses large non-overlapping tiles on $label", ({
    expectedColumns,
    height,
    isLandscape,
    isTablet,
    width,
  }) => {
    const layout = getSeniorModeLayout({
      height,
      horizontalPadding: 48,
      isLandscape,
      isTablet,
      memberCount: 4,
      width,
    });

    expect(layout.columns).toBe(expectedColumns);
    expect(layout.tileWidth).toBeGreaterThanOrEqual(180);
    expect(layout.avatarSize).toBeGreaterThanOrEqual(132);
    expect(
      layout.tileWidth * layout.columns + layout.gap * (layout.columns - 1),
    ).toBeLessThanOrEqual(width - 48);
  });
});
