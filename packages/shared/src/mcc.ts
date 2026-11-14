/**
 * Merchant Category Codes (MCC, ISO 18245): what kind of merchant a card payment went to.
 *
 * The table in mcc.json is built by data/prep/build_mcc_table.py, and the Python prep reads the
 * same file. It has every general code from the public list at
 * https://github.com/greggles/mcc-codes, not only the 36 that the dataset happens to contain, so
 * a bigger dataset with more codes needs no change here. For each code it can hold:
 *
 * - `label`     always: a short description;
 * - `category`  only for codes the bank's data has shown: the category they appear under there.
 *               For any other code the category comes from the customer's own transactions;
 * - `basket`    where the merchant type says more than the category: see engine/baskets.ts.
 *
 * The codes 3000-3999 name one airline, car rental firm or hotel chain each. They are not in
 * the table; `lookupMcc` answers for them by range.
 *
 * Not every card purchase has an MCC (1.5-14% per category in the dataset have none), so
 * `category` on the transaction remains the fallback.
 */
import type { TransactionCategory } from "./schema";
import raw from "./mcc.json";

/**
 * How a merchant type decides the basket:
 *   regular   always a regular essential
 *   everyday  always everyday spending
 *   health    a regular essential under the health threshold, an unexpected necessity from it
 *   home      an unexpected necessity from the large-purchase threshold, everyday below it
 *   repair    an unexpected necessity from the repair threshold, everyday below it
 */
export type MccBasketHint = "regular" | "everyday" | "health" | "home" | "repair";

export interface MccInfo {
  /** Short English description of the merchant type. */
  label: string;
  /** The category this code appears under in the bank's data, when the data has shown it. */
  category?: TransactionCategory;
  basket?: MccBasketHint;
  /** The name of the basket rule for `regular` and `everyday` hints, e.g. "groceries", "taxi". */
  rule?: string;
}

export const MCC_CODES = raw as Readonly<Record<string, MccInfo>>;

/** The codes the bank's data has shown, each with its category: what the coach is always told about. */
export const DATASET_MCC_CODES: readonly string[] = Object.keys(MCC_CODES).filter((code) => MCC_CODES[code].category !== undefined);

const RANGES: [string, string, MccInfo][] = [
  ["3000", "3299", { label: "Airlines" }],
  ["3300", "3499", { label: "Car rental" }],
  ["3500", "3999", { label: "Hotels and lodging" }],
];

/** Look up an MCC from a transaction. Returns null for transfers and codes that are not in the list. */
export function lookupMcc(code: string | null | undefined): MccInfo | null {
  if (!code) return null;
  if (Object.hasOwn(MCC_CODES, code)) return MCC_CODES[code];
  if (!/^\d{4}$/.test(code)) return null;
  return RANGES.find(([from, to]) => code >= from && code <= to)?.[2] ?? null;
}

/** Whether `code` is a merchant category code this project knows: in the table, or in one of its ranges. */
export const isKnownMcc = (code: unknown): code is string => typeof code === "string" && lookupMcc(code) !== null;
