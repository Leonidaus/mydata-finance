/**
 * Demo fixtures written by data/prep/build_fixtures.py (packages/app/public/fixtures/).
 * Used by the app until the backend exists, and by tests.
 */
import type { Customer, MortgageOutcome, Transaction } from "../schema";
import type { Cohorts, EngineContext } from "./types";

export interface FixtureIndex {
  today: string;
  presets: { customer_id: string; label: string; blurb: string }[];
  pool: string[];
}

export interface FixtureBundle {
  customer: Customer;
  mortgage: MortgageOutcome | null;
  fields: string[];
  rows: (string | number | null)[][];
}

export function contextFromFixture(bundle: FixtureBundle, cohorts: Cohorts | null, today: string): EngineContext {
  const idx = Object.fromEntries(bundle.fields.map((f, i) => [f, i]));
  const tx: Transaction[] = bundle.rows
    .map((r) => ({
      customer_id: bundle.customer.customer_id,
      bank_account_id: "",
      tx_date: r[idx.tx_date] as string,
      tx_timestamp: r[idx.tx_timestamp] as string,
      category: r[idx.category] as Transaction["category"],
      tx_amount_eur: r[idx.tx_amount_eur] as number,
      balance_after_eur: r[idx.balance_after_eur] as number,
      transaction_type: r[idx.transaction_type] as Transaction["transaction_type"],
      merchant_id: r[idx.merchant_id] as string | null,
      mcc_code: r[idx.mcc_code] as string | null,
    }))
    .filter((t) => t.tx_date <= today);
  return { customer: bundle.customer, mortgage: bundle.mortgage, tx, today, cohorts };
}
