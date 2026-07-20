import { describe, expect, test } from "vitest";
import { formatSeniorDateTime } from "./senior-date-time";

const MONDAY_AFTERNOON = new Date("2026-07-20T12:34:00.000Z");

describe("Senior mode date and time", () => {
  test("formats English using English conventions", () => {
    expect(formatSeniorDateTime(MONDAY_AFTERNOON, "en", "UTC")).toEqual({
      date: "July 20, 2026",
      time: "12:34 PM",
      weekday: "Monday",
    });
  });

  test("formats Finnish using Finnish conventions", () => {
    expect(formatSeniorDateTime(MONDAY_AFTERNOON, "fi", "UTC")).toEqual({
      date: "20. heinäkuuta 2026",
      time: "12.34",
      weekday: "Maanantai",
    });
  });
});
