import { describe, expect, it } from "vitest";
import { engineCatalogText } from "./agent/catalog";
import { buildSystemPrompt } from "./agent/prompt";
import { usedMerchantTypes } from "./agent/snapshot";
import { TOOL_DECLARATIONS } from "./agent/tools";
import { EngineArgumentError, validateEngineArgs } from "./engine/args";
import { BASKET_RULE_EXPLANATIONS, classifyBasket } from "./engine/baskets";
import { DATASET_MCC_CODES, isKnownMcc, lookupMcc, MCC_CODES } from "./mcc";
import { applyProtections, ProtectedCategoryError } from "./profile";
import type { Transaction, TransactionCategory } from "./schema";

const purchase = (category: TransactionCategory, mcc: string | null, amount: number): Transaction => ({
  customer_id: "C",
  bank_account_id: "A",
  tx_date: "2026-09-01",
  tx_timestamp: "2026-09-01T10:00:00",
  category,
  tx_amount_eur: amount,
  balance_after_eur: 1000,
  transaction_type: "purchase",
  merchant_id: "M",
  mcc_code: mcc,
});

describe("merchant category codes", () => {
  it("knows the whole general list, not only the codes in the dataset", () => {
    expect(Object.keys(MCC_CODES).length).toBeGreaterThan(280);
    expect(DATASET_MCC_CODES).toHaveLength(36);
    for (const code of DATASET_MCC_CODES) expect(MCC_CODES[code].category).toBeDefined();
    // A code the dataset does not have: a label, and no category until the data shows one.
    expect(lookupMcc("5462")).toEqual({ label: "Bakeries", basket: "regular", rule: "groceries" });
    expect(lookupMcc("4121")).toMatchObject({ label: "Taxis and limousines", category: "Transportation", basket: "everyday", rule: "taxi" });
    // One airline, car rental firm or hotel chain each: answered by range.
    expect(lookupMcc("3008")?.label).toBe("Airlines");
    expect(lookupMcc("3357")?.label).toBe("Car rental");
    expect(lookupMcc("3501")?.label).toBe("Hotels and lodging");
    expect([lookupMcc("9999"), lookupMcc("12"), lookupMcc("taxi"), lookupMcc(null)]).toEqual([null, null, null, null]);
    expect([isKnownMcc("5462"), isKnownMcc("3008"), isKnownMcc("9999"), isKnownMcc(5462)]).toEqual([true, true, false, false]);
  });

  it("explains every basket rule a hint can give", () => {
    const rules = new Set(Object.values(MCC_CODES).flatMap((info) => (info.rule ? [info.rule] : [])));
    for (const rule of [...rules, "essential_merchant", "repair", "repair_small"]) expect(BASKET_RULE_EXPLANATIONS[rule], rule).toBeDefined();
  });

  it("classifies by merchant type where the table has a hint, and by category otherwise", () => {
    // The same cases, with the same results, as data/prep/build_database.py gives.
    const cases: [TransactionCategory, string | null, number, string, string][] = [
      ["Transportation", "4121", -30, "everyday", "taxi"],
      ["Transportation", "4111", -30, "regular", "transport"],
      ["Transportation", null, -30, "regular", "transport"],
      ["Health", "5912", -40, "regular", "health_routine"],
      ["Health", "5912", -140, "irregular", "health_large"],
      ["Home & Tech", "5732", -700, "irregular", "home_large"],
      // Codes the dataset does not have, in whatever category a bank might put them.
      ["Lifestyle", "7538", -320, "irregular", "repair"],
      ["Lifestyle", "7538", -40, "everyday", "repair_small"],
      ["Lifestyle", "4814", -35, "regular", "telecom"],
      ["Restaurants", "5462", -6, "regular", "groceries"],
      ["Lifestyle", "5977", -60, "everyday", "discretionary"],
      ["Travel", "3008", -200, "everyday", "discretionary"],
    ];
    for (const [category, mcc, amount, basket, rule] of cases) {
      expect(classifyBasket(purchase(category, mcc, amount)), `${category} ${mcc} ${amount}`).toEqual({ basket, rule });
    }
  });

  it("accepts any known code as an argument and still refuses nonsense", () => {
    expect(validateEngineArgs("spendBy", { mcc: "5462" })).toEqual({ mcc: "5462" });
    expect(validateEngineArgs("spendBy", { mcc: "3008", category: "Travel" })).toEqual({ mcc: "3008", category: "Travel" });
    expect(() => validateEngineArgs("spendBy", { mcc: "9999" })).toThrow(EngineArgumentError);
    expect(() => validateEngineArgs("spendBy", { mcc: "taxis" })).toThrow(/four-digit merchant category code/);
    // Where the bank's data has shown the category, a mismatch is still an error.
    expect(() => validateEngineArgs("spendBy", { mcc: "4121", category: "Groceries" })).toThrow(/belongs to Transportation/);
  });

  it("tells the coach about the dataset's codes and the customer's own, not the whole list", async () => {
    const used = await usedMerchantTypes(() => ({
      rows: [
        { key: "5462", label: "Bakeries", category: "Groceries", amount: 300, count: 40 },
        { key: "4121", label: "Taxis and limousines", category: "Transportation", amount: 120, count: 6 },
        { key: "none:Groceries", label: "Groceries (no merchant type)", category: "Groceries", amount: 50, count: 3 },
      ],
    }));
    expect(used).toEqual([
      { code: "5462", label: "Bakeries", category: "Groceries" },
      { code: "4121", label: "Taxis and limousines", category: "Transportation" },
    ]);
    const text = engineCatalogText(used);
    const listed = text.split("\n").filter((line) => /^- \d{4}: /.test(line));
    expect(listed).toHaveLength(37); // the 36 the data is known to contain, and the bakery
    expect(text).toContain("- 5462: Bakeries (Groceries), which this customer has used");
    expect(text).toContain("- 4121: Taxis and limousines (Transportation)");
    expect(text).not.toContain("Veterinary");
    expect(buildSystemPrompt([], "2026-09-15", { merchantTypes: used })).toContain("- 5462: Bakeries (Groceries), which this customer has used");
    // A failing lookup leaves the coach with the known codes.
    expect(await usedMerchantTypes(() => { throw new Error("no data"); })).toEqual([]);
    // The tool definition no longer carries a fixed list of codes.
    const mcc = (TOOL_DECLARATIONS.find((t) => t.name === "use_component")!.parametersJsonSchema as any).properties.args.properties.mcc;
    expect(mcc.enum).toBeUndefined();
    expect(mcc.pattern).toBe("^\\d{4}$");
  });

  it("protects a merchant type by the category it has in the customer's own data when the table has none", () => {
    const protectedCategories = ["Groceries" as const];
    const categoryOfMcc = (mcc: string) => (mcc === "5462" ? ("Groceries" as const) : undefined);
    expect(() => applyProtections("whatIf", { mcc: "5462", cutPct: 20 }, { protectedCategories, categoryOfMcc })).toThrow(ProtectedCategoryError);
    // A code whose category nobody knows is not blocked.
    expect(applyProtections("whatIf", { mcc: "5977", cutPct: 20 }, { protectedCategories, categoryOfMcc })).toEqual({ mcc: "5977", cutPct: 20 });
    // Known from the bank's data: no need to ask.
    expect(() => applyProtections("whatIf", { mcc: "5411", cutPct: 20 }, { protectedCategories })).toThrow(ProtectedCategoryError);
  });
});
