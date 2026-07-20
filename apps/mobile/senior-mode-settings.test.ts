import { describe, expect, test } from "vitest";
import {
  availableSeniorModeMembers,
  normalizeSeniorModeSettings,
  toggleSeniorModeMember,
} from "./senior-mode-settings";

describe("Senior mode settings", () => {
  test("normalizes invalid stored settings to a safe disabled state", () => {
    expect(normalizeSeniorModeSettings(null)).toEqual({
      enabled: false,
      familyId: null,
      memberIds: [],
    });
    expect(normalizeSeniorModeSettings({
      enabled: true,
      familyId: 42,
      memberIds: ["a", "a", "", 7],
    })).toEqual({
      enabled: true,
      familyId: null,
      memberIds: ["a"],
    });
  });

  test("adds and removes selected family members", () => {
    expect(toggleSeniorModeMember(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSeniorModeMember(["a", "b"], "a")).toEqual(["b"]);
  });

  test("keeps only selected members who remain in the configured family", () => {
    const settings = {
      enabled: true,
      familyId: "family-a",
      memberIds: ["member-a", "member-gone", "member-b"],
    };

    expect(availableSeniorModeMembers(
      settings,
      "family-a",
      ["member-b", "member-a"],
    )).toEqual(["member-a", "member-b"]);
    expect(availableSeniorModeMembers(
      settings,
      "family-b",
      ["member-a"],
    )).toEqual([]);
  });
});
