import { describe, expect, test } from "vitest";
import { shouldAutoAnswerCall } from "./auto-answer-policy";

describe("shouldAutoAnswerCall", () => {
  test("answers automatically only while the application is active", () => {
    expect(shouldAutoAnswerCall(true, "active")).toBe(true);
    expect(shouldAutoAnswerCall(true, "background")).toBe(false);
    expect(shouldAutoAnswerCall(true, "inactive")).toBe(false);
  });

  test("does not answer when the setting is disabled", () => {
    expect(shouldAutoAnswerCall(false, "active")).toBe(false);
  });
});
