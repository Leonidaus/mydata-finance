import { DatabaseSync } from "node:sqlite";
import { wrapDatabase, type FinanceDb } from "../db";

/**
 * A small in-memory database with the same tables the routes read, so tests do
 * not need the real dataset. "Today" is 2026-09-15.
 *
 * CUST00001 has, in August 2026: two taxi rides (30.00 + 12.50), groceries 80.00,
 * rent 700.00, a dentist 250.00, one investment deposit 200.00 and salary 2500.00.
 * In September: one taxi ride on the 10th (20.00) and one on the 20th (99.00),
 * which is after today and must never show up.
 */
export function createFixtureDb(): FinanceDb {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta VALUES ('demo_today', '2026-09-15'), ('rows_customers', '2'),
      ('rows_transactions', '10'), ('built_at', '2026-11-13T00:00:00+00:00'),
      ('average_window_first_month', '2025-09'), ('average_window_last_month', '2026-08');

    CREATE TABLE transactions (
      tx_id INTEGER PRIMARY KEY, customer_id TEXT, bank_account_id TEXT, tx_date TEXT,
      tx_timestamp TEXT, category TEXT, tx_amount_eur REAL, balance_after_eur REAL,
      transaction_type TEXT, merchant_id TEXT, mcc_code TEXT,
      flow TEXT, basket TEXT, basket_rule TEXT, is_large INTEGER);
    INSERT INTO transactions VALUES
      (1, 'CUST00001', 'ACC1', '2026-08-01', '2026-08-01T09:00:00', 'Housing', -700, 1300, 'housing_payment', NULL, NULL, 'spending', 'regular', 'housing', 0),
      (2, 'CUST00001', 'ACC1', '2026-08-03', '2026-08-03T22:10:00', 'Transportation', -30, 1270, 'purchase', 'MRC-TRN-0001', '4121', 'spending', 'everyday', 'taxi', 0),
      (3, 'CUST00001', 'ACC1', '2026-08-05', '2026-08-05T17:00:00', 'Groceries', -80, 1190, 'purchase', 'MRC-GRO-0001', '5411', 'spending', 'regular', 'groceries', 0),
      (4, 'CUST00001', 'ACC1', '2026-08-10', '2026-08-10T10:00:00', 'Health', -250, 940, 'purchase', 'MRC-HEA-0001', '8021', 'spending', 'irregular', 'health_large', 0),
      (5, 'CUST00001', 'ACC1', '2026-08-15', '2026-08-15T08:00:00', 'Salary', 2500, 3440, 'salary', NULL, NULL, 'income', NULL, 'salary', 0),
      (6, 'CUST00001', 'ACC1', '2026-08-16', '2026-08-16T08:00:00', 'Invest Deposit', -200, 3240, 'investment_deposit', NULL, NULL, 'saving', NULL, 'investment_deposit', 0),
      (7, 'CUST00001', 'ACC1', '2026-08-20', '2026-08-20T23:30:00', 'Transportation', -12.5, 3227.5, 'purchase', 'MRC-TRN-0002', '4121', 'spending', 'everyday', 'taxi', 0),
      (8, 'CUST00001', 'ACC1', '2026-09-10', '2026-09-10T21:00:00', 'Transportation', -20, 3207.5, 'purchase', 'MRC-TRN-0001', '4121', 'spending', 'everyday', 'taxi', 0),
      (9, 'CUST00001', 'ACC1', '2026-09-20', '2026-09-20T21:00:00', 'Transportation', -99, 3108.5, 'purchase', 'MRC-TRN-0001', '4121', 'spending', 'everyday', 'taxi', 0),
      (10, 'CUST00002', 'ACC2', '2026-08-04', '2026-08-04T12:00:00', 'Transportation', -55, 500, 'purchase', 'MRC-TRN-0001', '4121', 'spending', 'everyday', 'taxi', 0);

    CREATE TABLE customer_profile (
      customer_id TEXT, age INTEGER, age_band TEXT, postal_code TEXT, postal_area TEXT,
      has_mortgage_application INTEGER, avg_income REAL, avg_regular REAL,
      avg_irregular REAL, avg_everyday REAL, avg_saving REAL, avg_net REAL,
      months_below_zero INTEGER);
    INSERT INTO customer_profile VALUES
      ('CUST00001', 30, '25-34', '00530', '00', 0, 2500, 780, 250, 42.5, 200, 1427.5, 0),
      ('CUST00002', 47, '45-54', '02100', '02', 1, 3000, 0, 0, 55, 0, 2945, 1);

    CREATE TABLE monthly_summary (
      customer_id TEXT, month TEXT, income REAL, regular REAL, irregular REAL,
      everyday REAL, saving REAL, saving_withdrawal REAL, net REAL, balance_change REAL,
      min_balance REAL, transactions INTEGER, is_partial INTEGER, end_balance REAL);
    INSERT INTO monthly_summary VALUES
      ('CUST00001', '2026-08', 2500, 780, 250, 42.5, 200, 0, 1427.5, 1227.5, 940, 7, 0, 3227.5),
      ('CUST00001', '2026-09', 0, 0, 0, 20, 0, 0, -20, -20, 3207.5, 1, 1, 3207.5);

    CREATE TABLE mortgage_outcomes (
      mortgage_customer_id TEXT, customer_id TEXT, final_decision TEXT, rejection_reason TEXT,
      final_property_price_eur REAL, final_requested_loan_eur REAL, final_equity_amount_eur REAL,
      final_collateral_value_eur REAL, required_monthly_income_eur REAL, lfinal_loan_to_value REAL);
    INSERT INTO mortgage_outcomes VALUES
      ('C0001', 'CUST00002', 'approved', NULL, 200000, 160000, 40000, 150000, 3000, 0.8);

    CREATE TABLE cohort_stats (
      age_band TEXT, postal_area TEXT, metric TEXT, customers INTEGER,
      p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL, mean REAL);
    INSERT INTO cohort_stats VALUES
      ('25-34', 'all', 'category:Transportation', 10, 1, 2, 3, 4, 5, 60),
      ('25-34', 'all', 'category:Groceries', 10, 1, 2, 3, 4, 5, 400),
      ('25-34', '00', 'category:Groceries', 5, 1, 2, 3, 4, 5, 999),
      ('all', 'all', 'category:Groceries', 20, 1, 2, 3, 4, 5, 450),
      ('25-34', 'all', 'income', 10, 1, 2, 3, 4, 5, 2600);
  `);
  return wrapDatabase(database);
}
