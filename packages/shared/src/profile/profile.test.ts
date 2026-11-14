import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, applyProfileUpdate, parseCategoryList, parseProfileUpdate } from "./index";

describe("coaching profile validation", () => {
  it("accepts additive changes and keeps category order", () => {
    const update = parseProfileUpdate({ style: "direct", protect: { add: ["Travel", "Restaurants"] } });
    expect(applyProfileUpdate(DEFAULT_PROFILE, update, "2026-11-14T00:00:00.000Z")).toEqual({
      version: 1,
      style: "direct",
      protectedCategories: ["Restaurants", "Travel"],
      updatedAt: "2026-11-14T00:00:00.000Z",
    });
  });

  it("never removes protection without protect.remove", () => {
    const current = { ...DEFAULT_PROFILE, protectedCategories: ["Travel" as const] };
    expect(applyProfileUpdate(current, parseProfileUpdate({ style: "exploratory" }), "now").protectedCategories).toEqual(["Travel"]);
  });

  it("rejects replacement, empty and malformed changes", () => {
    for (const body of [{}, { protectedCategories: [] }, { style: "strict" }, { protect: [] }, { protect: { add: ["Travel"], remove: ["Travel"] } }]) {
      expect(() => parseProfileUpdate(body)).toThrow();
    }
    expect(() => parseCategoryList(["Unknown"], "allowProtected")).toThrow();
  });
});
