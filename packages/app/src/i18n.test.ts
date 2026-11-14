import { describe, expect, it } from "vitest";
import { LOCALES, translate, type TranslationKey } from "./i18n";

describe("translations", () => {
  it("renders representative messages in every supported locale", () => {
    const keys: TranslationKey[] = ["app.title", "chat.ask", "coach.settings", "drawer.empty"];
    for (const locale of LOCALES) for (const key of keys) expect(translate(locale, key)).not.toContain(key);
  });

  it("interpolates values without changing the key", () => {
    expect(translate("fi", "card.remove", { title: "Ruokaostokset" })).toBe("Poista Ruokaostokset");
  });
});
