/**
 * Runs the finance engine from @mydata/shared (safe to spend, what-if, baskets,
 * forecasts, ...) for any customer in the database.
 *
 * The engine is pure: it works on an EngineContext holding one customer's
 * transactions. This module builds that context from SQLite and keeps recent
 * ones in memory, since the engine caches its own intermediate results per context.
 */
import {
  ENGINE_FNS,
  filterTransactions,
  runEngine,
  type Cohorts,
  type Customer,
  type EngineContext,
  type EngineFn,
  type EngineResult,
  type MortgageOutcome,
  type Transaction,
  type TxFilter,
} from "@mydata/shared";
import type { FinanceDb } from "../db";

const MAX_CACHED_CONTEXTS = 200;

interface EngineState {
  cohorts: Cohorts | null;
  contexts: Map<string, EngineContext>;
}

const states = new WeakMap<FinanceDb, EngineState>();

/** Average monthly spend per category for each age band, from the cohort_stats table. */
function loadCohorts(db: FinanceDb): Cohorts | null {
  const rows = db.all<{ age_band: string; metric: string; mean: number }>(
    `SELECT age_band, metric, mean FROM cohort_stats
     WHERE postal_area = 'all' AND age_band <> 'all' AND metric LIKE 'category:%'`,
  );
  if (rows.length === 0) return null;
  const bands: Cohorts["bands"] = {};
  for (const row of rows) {
    (bands[row.age_band] ??= {})[row.metric.slice("category:".length)] = row.mean;
  }
  // The averaging window from the build: first day of its first month to last day of its last.
  const windowEnd = new Date(`${db.meta.average_window_last_month ?? db.today.slice(0, 7)}-01T00:00:00Z`);
  windowEnd.setUTCMonth(windowEnd.getUTCMonth() + 1, 0);
  return {
    source: `Synthetic S-Pankki dataset, all ${Number(db.meta.rows_customers ?? 0).toLocaleString("en-US")} customers`,
    window: [`${db.meta.average_window_first_month ?? ""}-01`, windowEnd.toISOString().slice(0, 10)],
    bands,
  };
}

function state(db: FinanceDb): EngineState {
  let current = states.get(db);
  if (!current) {
    current = { cohorts: loadCohorts(db), contexts: new Map() };
    states.set(db, current);
  }
  return current;
}

/** Everything the engine needs about one customer, or null if the customer does not exist. */
export function loadEngineContext(db: FinanceDb, customerId: string): EngineContext | null {
  const { cohorts, contexts } = state(db);
  const cached = contexts.get(customerId);
  if (cached) {
    // Re-insert so the map stays ordered by most recent use.
    contexts.delete(customerId);
    contexts.set(customerId, cached);
    return cached;
  }

  const customer = db.get<Customer>(
    `SELECT customer_id, postal_code AS customer_postal_code, age AS customer_age
     FROM customer_profile WHERE customer_id = :customerId`,
    { customerId },
  );
  if (!customer) return null;

  const mortgage =
    db.get<MortgageOutcome>(
      `SELECT mortgage_customer_id, customer_id, final_decision, rejection_reason,
              final_property_price_eur, final_requested_loan_eur, final_equity_amount_eur,
              final_collateral_value_eur, required_monthly_income_eur, lfinal_loan_to_value
       FROM mortgage_outcomes WHERE customer_id = :customerId`,
      { customerId },
    ) ?? null;

  // Source order is chronological and the running balance follows it.
  const tx = db.all<Transaction>(
    `SELECT customer_id, bank_account_id, tx_date, tx_timestamp, category, tx_amount_eur,
            balance_after_eur, transaction_type, merchant_id, mcc_code, basket, basket_rule
     FROM transactions
     WHERE customer_id = :customerId AND tx_date <= :today
     ORDER BY tx_id`,
    { customerId, today: db.today },
  );

  // Plain objects: the driver returns rows without a prototype.
  const context: EngineContext = {
    customer: { ...customer },
    mortgage: mortgage && { ...mortgage },
    tx: tx.map((row) => ({ ...row })),
    today: db.today,
    cohorts,
  };
  contexts.set(customerId, context);
  if (contexts.size > MAX_CACHED_CONTEXTS) {
    contexts.delete(contexts.keys().next().value as string);
  }
  return context;
}

export function isEngineFn(name: string): name is EngineFn {
  return (ENGINE_FNS as readonly string[]).includes(name);
}

export function runEngineFor(
  db: FinanceDb,
  customerId: string,
  fn: EngineFn,
  args: Record<string, unknown> = {},
): EngineResult | null {
  const context = loadEngineContext(db, customerId);
  return context && runEngine(context, fn, args);
}

/** The transactions behind an engine result, newest first. */
export function transactionsFor(
  db: FinanceDb,
  customerId: string,
  filter: TxFilter,
  limit = 200,
): { count: number; transactions: Transaction[] } | null {
  const context = loadEngineContext(db, customerId);
  if (!context) return null;
  const matching = filterTransactions(context, filter);
  const take = Math.min(Math.max(limit, 0), 1000);
  return {
    count: matching.length,
    transactions: take === 0 ? [] : matching.slice(-take).reverse(),
  };
}
