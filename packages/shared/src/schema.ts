/**
 * The 4-table schema of the Junction 2026 S-Pankki dataset.
 * This is the single source of truth shared by the app (local SQLite),
 * the backend (query validation, cohort aggregates), and data prep.
 */

export interface Transaction {
  customer_id: string;
  bank_account_id: string;
  /** ISO date, e.g. "2024-10-03" */
  tx_date: string;
  /** SAS-style timestamp in source data, e.g. "03OCT24:09:04:04" */
  tx_timestamp: string;
  category: TransactionCategory;
  /** Negative = money out, positive = money in */
  tx_amount_eur: number;
  balance_after_eur: number;
  transaction_type: TransactionType;
  merchant_id: string | null;
  mcc_code: string | null;
}

export const TRANSACTION_CATEGORIES = [
  "Groceries",
  "Restaurants",
  "Transportation",
  "Utilities",
  "Entertainment",
  "Health",
  "Salary",
  "Home & Tech",
  "Housing",
  "Lifestyle",
  "Travel",
  "Invest Deposit",
  "Other Income",
  "Salary Sweep",
  "Invest Withdraw",
] as const;
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export const TRANSACTION_TYPES = [
  "purchase",
  "utilities_payment",
  "salary",
  "housing_payment",
  "investment_deposit",
  "other_income",
  "salary_sweep",
  "investment_withdrawal",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface Customer {
  customer_id: string;
  customer_postal_code: string;
  customer_age: number;
}

export type MortgageEventType =
  | "application_created"
  | "customer_contact"
  | "expense_recorded"
  | "property_added"
  | "property_price_updated"
  | "collateral_added"
  | "collateral_valuation"
  | "additional_collateral_requested"
  | "loan_calculation"
  | "income_information_received"
  | "document_received"
  | "loan_decision";

export interface MortgageEvent {
  mortgage_customer_id: string;
  timestamp: string;
  event_type: MortgageEventType;
  property_id: string | null;
  property_type: string | null;
  property_price_estimate: number | null;
  loan_amount: number | null;
  equity_amount: number | null;
  collateral_type: string | null;
  collateral_value: number | null;
  collateral_status: string | null;
  decision: "approved" | "rejected" | null;
  rejection_reason: RejectionReason | null;
  expense_type: string | null;
  expense_amount: number | null;
  note: string | null;
}

export const REJECTION_REASONS = [
  "insufficient_collateral",
  "insufficient_income",
  "insufficient_equity",
  "existing_debt",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface MortgageOutcome {
  mortgage_customer_id: string;
  customer_id: string;
  final_decision: "approved" | "rejected";
  rejection_reason: RejectionReason | null;
  final_property_price_eur: number | null;
  final_requested_loan_eur: number | null;
  final_equity_amount_eur: number | null;
  final_collateral_value_eur: number | null;
  required_monthly_income_eur: number | null;
  /** Source column name in the CSV is "lfinal_loan_to_value" (typo preserved). */
  lfinal_loan_to_value: number | null;
}
