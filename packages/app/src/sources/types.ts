/**
 * The app's data contract. Everything the UI shows about a customer goes through a DataSource,
 * so it works the same against the backend (API mode) and on the demo fixtures (fixture mode).
 */
import type { DataRequest, EngineResult, Transaction, TxFilter } from "@mydata/shared";

export type DataMode = "api" | "fixtures";

/** What the dashboard needs to know about a customer before it can show blocks. */
export interface CustomerInfo {
  customerId: string;
  age: number;
  /** The demo's fixed "today", ISO date. */
  today: string;
}

export interface TransactionPage {
  /** How many transactions match the filter in total. */
  count: number;
  /** The newest `limit` of them, newest first. */
  transactions: Transaction[];
}

/** Calls reject with an Error whose message can be shown to the user. A signal aborts the request. */
export interface DataSource {
  readonly mode: DataMode;
  customer(customerId: string, signal?: AbortSignal): Promise<CustomerInfo>;
  /** Runs a block's data request. */
  runData(customerId: string, request: DataRequest, signal?: AbortSignal): Promise<EngineResult>;
  /** The transactions behind a result: pass the result's filter, plus what was tapped. */
  transactions(customerId: string, filter: TxFilter, limit?: number, signal?: AbortSignal): Promise<TransactionPage>;
}

/** Same defaults and cap as the backend's POST /api/transactions. */
export const DEFAULT_TX_LIMIT = 200;
export const MAX_TX_LIMIT = 1000;
