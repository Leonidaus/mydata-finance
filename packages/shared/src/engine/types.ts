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
}

export type Basket = "regular" | "irregular" | "everyday";

/** Narrows transactions for a drill-down. All fields optional and combined with AND. */
export interface TxFilter {
  from?: string;
  to?: string;
  kind?: "spending" | "income" | "saving" | "all";
  category?: string;
  mcc?: string;
  basket?: Basket;
  /** "YYYY-MM" */
  month?: string;
  /** "YYYY-MM-DD" */
  date?: string;
}

export type Row = Record<string, string | number | null>;

export interface EngineResult {
  rows: Row[];
  /** Headline figure for stat-like blocks. */
  value?: number;
  unit?: string;
  caption?: string;
  /** Filter for the transactions behind this result; templates add the clicked datum. */
  filter?: TxFilter;
}

export const ENGINE_FNS = [
  "spendBy",
  "monthlyTrend",
  "baskets",
  "safeToSpend",
  "balanceForecast",
  "whatIf",
  "peerCompare",
  "dailySpend",
  "recurring",
  "goalProgress",
] as const;
export type EngineFn = (typeof ENGINE_FNS)[number];
