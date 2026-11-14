import type { FinanceDb } from "../db";

export interface CustomerProfile {
  customerId: string;
  age: number;
  ageBand: string;
  postalCode: string;
  /** First two digits of the postal code; the cohort area. */
  postalArea: string;
  hasMortgageApplication: boolean;
  /** Account balance after the latest transaction up to today. */
  balance: number | null;
  /** Averages per month over the last 12 complete months before today, in euros. */
  monthlyAverages: {
    income: number;
    regular: number;
    irregular: number;
    everyday: number;
    saving: number;
    /** Income minus spending, before any transfer to or from savings. */
    net: number;
  };
  /** In how many of those months the balance went below zero. */
  monthsBelowZero: number;
}

export interface MonthlySummaryRow {
  /** YYYY-MM */
  month: string;
  income: number;
  regular: number;
  irregular: number;
  everyday: number;
  saving: number;
  savingWithdrawal: number;
  /** Income minus spending, before any transfer to or from savings. */
  net: number;
  /** Everything that moved the account balance in the month, saving transfers included. */
  balanceChange: number;
  minBalance: number;
  endBalance: number;
  /** True for the current month, which only runs up to today. */
  isPartial: boolean;
}

interface ProfileRow {
  customer_id: string;
  age: number;
  age_band: string;
  postal_code: string;
  postal_area: string;
  has_mortgage_application: number;
  avg_income: number;
  avg_regular: number;
  avg_irregular: number;
  avg_everyday: number;
  avg_saving: number;
  avg_net: number;
  months_below_zero: number;
}

function toProfile(row: ProfileRow, balance: number | null): CustomerProfile {
  return {
    customerId: row.customer_id,
    age: row.age,
    ageBand: row.age_band,
    postalCode: row.postal_code,
    postalArea: row.postal_area,
    hasMortgageApplication: row.has_mortgage_application === 1,
    balance,
    monthlyAverages: {
      income: row.avg_income,
      regular: row.avg_regular,
      irregular: row.avg_irregular,
      everyday: row.avg_everyday,
      saving: row.avg_saving,
      net: row.avg_net,
    },
    monthsBelowZero: row.months_below_zero,
  };
}

function currentBalance(db: FinanceDb, customerId: string): number | null {
  const row = db.get<{ balance_after_eur: number }>(
    `SELECT balance_after_eur FROM transactions
     WHERE customer_id = :customerId AND tx_date <= :today
     ORDER BY tx_id DESC LIMIT 1`,
    { customerId, today: db.today },
  );
  return row?.balance_after_eur ?? null;
}

export function getCustomer(db: FinanceDb, customerId: string): CustomerProfile | null {
  const row = db.get<ProfileRow>(
    "SELECT * FROM customer_profile WHERE customer_id = :customerId",
    { customerId },
  );
  return row ? toProfile(row, currentBalance(db, customerId)) : null;
}

export interface ListCustomersQuery {
  limit?: number;
  /** Only customers with (true) or without (false) a mortgage application. */
  hasMortgageApplication?: boolean;
}

/** A page of customers for the demo's customer picker, ordered by id. */
export function listCustomers(db: FinanceDb, query: ListCustomersQuery = {}): CustomerProfile[] {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const filter =
    query.hasMortgageApplication === undefined
      ? ""
      : `WHERE has_mortgage_application = ${query.hasMortgageApplication ? 1 : 0}`;
  return db
    .all<ProfileRow>(`SELECT * FROM customer_profile ${filter} ORDER BY customer_id LIMIT :limit`, {
      limit,
    })
    .map((row) => toProfile(row, currentBalance(db, row.customer_id)));
}

/** The latest `months` months of the customer's summary, oldest first. */
export function monthlySummary(
  db: FinanceDb,
  customerId: string,
  months = 12,
): MonthlySummaryRow[] {
  const limit = Math.min(Math.max(months, 1), 36);
  return db
    .all<{
      month: string;
      income: number;
      regular: number;
      irregular: number;
      everyday: number;
      saving: number;
      saving_withdrawal: number;
      net: number;
      balance_change: number;
      min_balance: number;
      end_balance: number;
      is_partial: number;
    }>(
      `SELECT * FROM (
         SELECT month, income, regular, irregular, everyday, saving, saving_withdrawal,
                net, balance_change, min_balance, end_balance, is_partial
         FROM monthly_summary WHERE customer_id = :customerId
         ORDER BY month DESC LIMIT :limit
       ) ORDER BY month`,
      { customerId, limit },
    )
    .map((row) => ({
      month: row.month,
      income: row.income,
      regular: row.regular,
      irregular: row.irregular,
      everyday: row.everyday,
      saving: row.saving,
      savingWithdrawal: row.saving_withdrawal,
      net: row.net,
      balanceChange: row.balance_change,
      minBalance: row.min_balance,
      endBalance: row.end_balance,
      isPartial: row.is_partial === 1,
    }));
}
