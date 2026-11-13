/**
 * Meanings of the 36 Merchant Category Codes (MCC, ISO 18245) that occur in the
 * dataset, and the transaction category each one appears under.
 *
 * The data lives in mcc.json so the Python prep scripts can read the same file.
 * Labels are shortened from the public list at
 * https://github.com/greggles/mcc-codes. Each code occurs under exactly one
 * category in the data.
 *
 * Not every card purchase has an MCC (1.5–14% per category have none), so
 * `category` on the transaction remains the fallback.
 */
import type { TransactionCategory } from "./schema";
import raw from "./mcc.json";

export interface MccInfo {
  /** Short English description of the merchant type. */
  label: string;
  /** The dataset category this code appears under. */
  category: TransactionCategory;
}

export const MCC_CODES = raw as Readonly<Record<string, MccInfo>>;

/** Look up an MCC from a transaction. Returns null for transfers and unknown codes. */
export function lookupMcc(code: string | null | undefined): MccInfo | null {
  if (!code) return null;
  return MCC_CODES[code] ?? null;
}
