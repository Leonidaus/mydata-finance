/**
 * The three spending baskets: one rule set for the whole project.
 *
 * The same rules are applied in data prep (`classify` in data/prep/build_database.py),
 * which stores the result on every transaction. The engine uses the stored label when a
 * transaction has one and these rules otherwise, and a test checks that both agree.
 * Change the rules in both places together and bump RULES_VERSION in the Python file.
 *
 *   regular    mandatory and regular: housing, utilities, groceries, getting around,
 *              routine health costs
 *   irregular  mandatory and irregular ("unexpected necessities"): a large health or
 *              home purchase, a repair
 *   everyday   everything discretionary, large or small
 *
 * A purchase is classified by its merchant type when the code table (mcc.json) has a basket
 * hint for it, and by its category otherwise. For the 36 codes in the dataset the hints give
 * exactly what the category rules give, so nothing stored changes; they matter for codes a
 * bigger dataset brings: a bakery counts as groceries, a phone bill and insurance as regular
 * essentials, a car repair or a vet as an unexpected necessity, whatever category they sit in.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import type { Basket } from "./types";
import { isSpending } from "./util";

/** A Home & Tech purchase of this size or more counts as an unexpected necessity. */
export const LARGE_PURCHASE_EUR = 500;
/** A Health purchase of this size or more counts as an unexpected necessity. */
export const HEALTH_IRREGULAR_EUR = 100;
/** A repair (car, home, appliance, vet) of this size or more counts as an unexpected necessity. */
export const REPAIR_IRREGULAR_EUR = 100;
export const TAXI_MCC = "4121";

export const BASKET_LABELS: Record<Basket, string> = {
  regular: "Regular essentials",
  irregular: "Unexpected necessities",
  everyday: "Everyday spending",
};

/** Why a transaction is in its basket, keyed by `basket_rule`. */
export const BASKET_RULE_EXPLANATIONS: Record<string, string> = {
  housing: "Housing payments are a regular essential.",
  utilities: "Utility bills are a regular essential.",
  groceries: "Groceries are a regular essential.",
  transport: "Getting around (fuel, public transport, parking) is a regular essential.",
  taxi: "Taxis count as everyday spending, not as essential transport.",
  health_routine: `Health purchases under €${HEALTH_IRREGULAR_EUR} are routine essentials.`,
  health_large: `A health purchase of €${HEALTH_IRREGULAR_EUR} or more is an unexpected necessity.`,
  home_large: `A Home & Tech purchase of €${LARGE_PURCHASE_EUR} or more is an unexpected necessity.`,
  home_small: `Home & Tech purchases under €${LARGE_PURCHASE_EUR} are everyday spending.`,
  discretionary: "Restaurants, entertainment, lifestyle and travel are everyday spending.",
  telecom: "Phone and internet bills are a regular essential.",
  insurance: "Insurance payments are a regular essential.",
  childcare: "Child care is a regular essential.",
  education: "School and university fees are a regular essential.",
  essential_merchant: "This kind of merchant counts as a regular essential.",
  repair: `A repair or a vet bill of €${REPAIR_IRREGULAR_EUR} or more is an unexpected necessity.`,
  repair_small: `Repairs under €${REPAIR_IRREGULAR_EUR} are everyday spending.`,
};

/** The basket a merchant type's hint gives a purchase of `size` euros, or null when the code has no hint. */
function byMerchantType(mccCode: string | null, size: number): { basket: Basket; rule: string } | null {
  const hint = lookupMcc(mccCode);
  switch (hint?.basket) {
    case "regular":
      return { basket: "regular", rule: hint.rule ?? "essential_merchant" };
    case "everyday":
      return { basket: "everyday", rule: hint.rule ?? "discretionary" };
    case "health":
      return size >= HEALTH_IRREGULAR_EUR ? { basket: "irregular", rule: "health_large" } : { basket: "regular", rule: "health_routine" };
    case "home":
      return size >= LARGE_PURCHASE_EUR ? { basket: "irregular", rule: "home_large" } : { basket: "everyday", rule: "home_small" };
    case "repair":
      return size >= REPAIR_IRREGULAR_EUR ? { basket: "irregular", rule: "repair" } : { basket: "everyday", rule: "repair_small" };
    default:
      return null;
  }
}

/** Basket and rule for a spending transaction; null for income, saving and transfers. */
export function classifyBasket(t: Transaction): { basket: Basket; rule: string } | null {
  if (!isSpending(t)) return null;
  const size = -t.tx_amount_eur;
  // Housing and utilities are payments of their own type, not card purchases.
  if (t.category === "Housing") return { basket: "regular", rule: "housing" };
  if (t.category === "Utilities") return { basket: "regular", rule: "utilities" };
  const hinted = byMerchantType(t.mcc_code, size);
  if (hinted) return hinted;
  switch (t.category) {
    case "Groceries":
      return { basket: "regular", rule: "groceries" };
    case "Transportation":
      return { basket: "regular", rule: "transport" };
    case "Health":
      return size >= HEALTH_IRREGULAR_EUR
        ? { basket: "irregular", rule: "health_large" }
        : { basket: "regular", rule: "health_routine" };
    case "Home & Tech":
      return size >= LARGE_PURCHASE_EUR
        ? { basket: "irregular", rule: "home_large" }
        : { basket: "everyday", rule: "home_small" };
    default:
      return { basket: "everyday", rule: "discretionary" };
  }
}

/** Which basket a spending transaction falls in; null for income, saving and transfers. */
export function basketOf(t: Transaction): Basket | null {
  if (!isSpending(t)) return null;
  return t.basket ?? classifyBasket(t)?.basket ?? null;
}

/** The rule that put a spending transaction in its basket, for explanations. */
export function basketRuleOf(t: Transaction): string | null {
  if (!isSpending(t)) return null;
  return t.basket_rule ?? classifyBasket(t)?.rule ?? null;
}
