import type { LinkedReceipt } from "../receipts/types";
import type { Customer, MortgageOutcome, Transaction } from "../schema";

/** Average monthly spend per category for one age band, e.g. bands["25-34"]["Groceries"]. */
export interface Cohorts {
  source: string;
  window: [string, string];
  bands: Record<string, Record<string, number>>;
}

/** Everything the engine needs about one customer. Pure data, no I/O. */
export interface EngineContext {
  customer: Customer;
  mortgage: MortgageOutcome | null;
  /** Chronological (source order). Only rows on or before `today`. */
  tx: Transaction[];
  /** The demo's fixed "today", ISO date. */
  today: string;
  cohorts: Cohorts | null;
  /** Receipts the user has linked to card payments. Absent where there are none (the fixtures). */
  receipts?: LinkedReceipt[];
}

export type Basket = "regular" | "irregular" | "everyday";

/** Narrows transactions for a drill-down. All fields optional and combined with AND. */
export interface TxFilter {
  from?: string;
  to?: string;
  /** "net" is income and spending together, without transfers to or from savings. */
  kind?: "spending" | "income" | "saving" | "net" | "all";
  category?: string;
  mcc?: string;
  basket?: Basket;
  /** "YYYY-MM" */
  month?: string;
  /** "YYYY-MM-DD" */
  date?: string;
  /** Only payments with a linked receipt. */
  withReceipt?: boolean;
  /** Only payments whose receipt has a line of this item sub-category (implies withReceipt). */
  subcategory?: string;
  /** Only payments whose receipt is from a shop with this in its name (implies withReceipt). */
  shop?: string;
  /** Only payments whose receipt has a line with this in its name (implies withReceipt). */
  item?: string;
}

export type Row = Record<string, string | number | null>;

export interface EngineResult {
  rows: Row[];
  /** Headline figure for stat-like blocks. */
  value?: number;
  unit?: string;
  caption?: string;
  /** Plain-language assumptions behind an estimate, for explanations. */
  assumptions?: string[];
  /** Filter for the transactions behind this result; templates add the clicked datum. */
  filter?: TxFilter;
  /** The figures behind the caption as data, so the app can word it in the user's language. */
  facts?: Record<string, string | number>;
}

export const ENGINE_FNS = [
  "spendBy",
  "monthlyTrend",
  "baskets",
  "safeToSpend",
  "safeToSave",
  "balanceForecast",
  "whatIf",
  "peerCompare",
  "nationalCompare",
  "dailySpend",
  "recurring",
  "goalProgress",
  "goalPlan",
  "savingsOptions",
  "monthSoFar",
  "goalReview",
  "afford",
  "itemSpend",
  "itemTrend",
] as const;
export type EngineFn = (typeof ENGINE_FNS)[number];
