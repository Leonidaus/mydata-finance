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
 *              home purchase
 *   everyday   everything discretionary, large or small
 */
import type { Transaction } from "../schema";
import type { Basket } from "./types";
import { isSpending } from "./util";

/** A Home & Tech purchase of this size or more counts as an unexpected necessity. */
export const LARGE_PURCHASE_EUR = 500;
/** A Health purchase of this size or more counts as an unexpected necessity. */
export const HEALTH_IRREGULAR_EUR = 100;
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
};

/** Basket and rule for a spending transaction; null for income, saving and transfers. */
export function classifyBasket(t: Transaction): { basket: Basket; rule: string } | null {
  if (!isSpending(t)) return null;
  const size = -t.tx_amount_eur;
  switch (t.category) {
    case "Housing":
      return { basket: "regular", rule: "housing" };
    case "Utilities":
      return { basket: "regular", rule: "utilities" };
    case "Groceries":
      return { basket: "regular", rule: "groceries" };
    case "Transportation":
      return t.mcc_code === TAXI_MCC
        ? { basket: "everyday", rule: "taxi" }
        : { basket: "regular", rule: "transport" };
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
