import { describe, expect, it } from "vitest";
import { applyProtections, ProtectedCategoryError } from "./protect";

describe("profile protections", () => {
  it("unions saved protections with model exclusions", () => {
    expect(applyProtections("savingsOptions", { protect: ["Travel"] }, { protectedCategories: ["Transportation"] })).toEqual({
      protect: ["Travel", "Transportation"],
    });
    expect(applyProtections("savingsOptions", { protect: "" }, { protectedCategories: ["Transportation"] })).toEqual({ protect: ["Transportation"] });
  });

  it("refuses direct, default and merchant-category what-if calls", () => {
    expect(() => applyProtections("whatIf", { category: "Travel" }, { protectedCategories: ["Travel"] })).toThrow(ProtectedCategoryError);
    expect(() => applyProtections("whatIf", {}, { protectedCategories: ["Restaurants"] })).toThrow(ProtectedCategoryError);
    expect(() => applyProtections("whatIf", { mcc: "4121" }, { protectedCategories: ["Transportation"] })).toThrow(ProtectedCategoryError);
    expect(applyProtections("whatIf", { category: "Travel" }, { protectedCategories: ["Travel"], allow: ["Travel"] })).toEqual({ category: "Travel" });
  });
});
