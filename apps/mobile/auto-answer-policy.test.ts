import { describe, expect, test } from "vitest";
import {
  AUTO_ANSWER_DELAY_MS,
  canOfferAutoAnswer,
  shouldAcceptAutoAnswer,
} from "./auto-answer-policy";

describe("canOfferAutoAnswer", () => {
  test("offers automatic answering only while the application is active", () => {
    expect(canOfferAutoAnswer(true, "active")).toBe(true);
    expect(canOfferAutoAnswer(true, "background")).toBe(false);
    expect(canOfferAutoAnswer(true, "inactive")).toBe(false);
  });

  test("does not offer automatic answering when the setting is disabled", () => {
    expect(canOfferAutoAnswer(false, "active")).toBe(false);
  });

  test("waits ten seconds before offering automatic answering", () => {
    expect(AUTO_ANSWER_DELAY_MS).toBe(10_000);
  });

  test("accepts only after the caller requests the offer from this active device", () => {
    expect(shouldAcceptAutoAnswer(
      true,
      "active",
      "tablet",
      "tablet",
      undefined,
    )).toBe(false);
    expect(shouldAcceptAutoAnswer(
      true,
      "active",
      "tablet",
      "phone",
      Date.now(),
    )).toBe(false);
    expect(shouldAcceptAutoAnswer(
      true,
      "background",
      "tablet",
      "tablet",
      Date.now(),
    )).toBe(false);
    expect(shouldAcceptAutoAnswer(
      true,
      "active",
      "tablet",
      "tablet",
      Date.now(),
    )).toBe(true);
  });
});
