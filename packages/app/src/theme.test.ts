import { describe, expect, it } from "vitest";
import { themeFromUrl } from "./theme";

describe("theme", () => {
  it("is light unless the address asks for dark", () => {
    expect(themeFromUrl("")).toBe("light");
    expect(themeFromUrl("?dev")).toBe("light");
    expect(themeFromUrl("?theme=light")).toBe("light");
    expect(themeFromUrl("?theme=auto")).toBe("light");
    expect(themeFromUrl("?dev&theme=dark")).toBe("dark");
  });
});
