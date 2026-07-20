import { describe, expect, test } from "vitest";
import {
  FINNISH_TRANSLATIONS,
  detectLanguage,
  translate,
  translateError,
} from "./i18n";

describe("localization", () => {
  test("detects Finnish and otherwise defaults to English", () => {
    expect(detectLanguage("fi-FI")).toBe("fi");
    expect(detectLanguage("en-US")).toBe("en");
    expect(detectLanguage(undefined)).toBe("en");
  });

  test("provides a non-empty Finnish value with matching placeholders", () => {
    for (const [english, finnish] of Object.entries(FINNISH_TRANSLATIONS)) {
      expect(finnish.trim(), english).not.toBe("");
      const placeholders = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(finnish), english).toEqual(placeholders(english));
    }
  });

  test("interpolates translated text and hides unknown English errors in Finnish", () => {
    expect(translate("fi", "Call {name}", { name: "Aino" }))
      .toBe("Soita henkilölle Aino");
    expect(translateError("fi", new Error("Unknown server detail"), "Something went wrong."))
      .toBe("Jokin meni pieleen.");
  });
});
