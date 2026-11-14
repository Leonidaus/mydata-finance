import { lookupMcc, type TransactionCategory } from "@mydata/shared";
import type { FinanceDb, SqlParams } from "../db";
import type { Period } from "./period";

export const BASKETS = ["regular", "irregular", "everyday"] as const;
export type Basket = (typeof BASKETS)[number];

export const GROUP_BY = ["category", "mcc", "basket", "month"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface SpendingQuery {
  customerId: string;
  /** Inclusive range. Anything after the demo's today is cut off. */
  period: Period;
  category?: TransactionCategory;
  /** Four-digit merchant category code, e.g. "4121" for taxis. */
  mcc?: string;
  basket?: Basket;
  groupBy?: GroupBy;
  /** Maximum number of transactions to return as evidence (default 50). */
  limit?: number;
}

export interface SpendingTransaction {
  txId: number;
  date: string;
  timestamp: string;
  category: string;
  /** Euros spent, as a positive number. */
  amount: number;
  merchantId: string | null;
  mcc: string | null;
  mccLabel: string | null;
  basket: Basket;
  /** Which rule put it in that basket, e.g. "taxi" or "home_large". */
  basketRule: string;
}

export interface SpendingGroup {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface SpendingResult {
  customerId: string;
  /** The range actually used, after cutting off at today. */
  period: Period;
  filters: { category?: string; mcc?: string; mccLabel?: string; basket?: Basket };
  /** Euros spent, as a positive number. */
  total: number;
  count: number;
  groups?: SpendingGroup[];
  /** The transactions behind the total, newest first. */
  transactions: SpendingTransaction[];
  /** True when there are more transactions than were returned. */
  truncated: boolean;
}

const GROUP_EXPRESSION: Record<GroupBy, string> = {
  category: "category",
  mcc: "coalesce(mcc_code, 'none')",
  basket: "basket",
  month: "substr(tx_date, 1, 7)",
};

function groupLabel(groupBy: GroupBy, key: string): string {
  if (groupBy === "mcc") return key === "none" ? "No merchant code" : (lookupMcc(key)?.label ?? key);
  return key;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How much a customer spent in a period, with the transactions behind the number.
 * Only spending counts: income and transfers to savings or investments are excluded.
 */
export function spending(db: FinanceDb, query: SpendingQuery): SpendingResult {
  const period: Period = {
    from: query.period.from,
    to: query.period.to > db.today ? db.today : query.period.to,
  };
  const limit = Math.min(Math.max(query.limit ?? 50, 0), 500);

  const conditions = [
    "customer_id = :customerId",
    "tx_date BETWEEN :from AND :to",
    "flow = 'spending'",
  ];
  const params: SqlParams = { customerId: query.customerId, from: period.from, to: period.to };
  if (query.category) {
    conditions.push("category = :category");
    params.category = query.category;
  }
  if (query.mcc) {
    conditions.push("mcc_code = :mcc");
    params.mcc = query.mcc;
  }
  if (query.basket) {
    conditions.push("basket = :basket");
    params.basket = query.basket;
  }
  const where = conditions.join(" AND ");

  const totals = db.get<{ total: number | null; count: number }>(
    `SELECT -sum(tx_amount_eur) AS total, count(*) AS count FROM transactions WHERE ${where}`,
    params,
  ) ?? { total: 0, count: 0 };

  const rows = db.all<{
    tx_id: number;
    tx_date: string;
    tx_timestamp: string;
    category: string;
    tx_amount_eur: number;
    merchant_id: string | null;
    mcc_code: string | null;
    basket: Basket;
    basket_rule: string;
  }>(
    `SELECT tx_id, tx_date, tx_timestamp, category, tx_amount_eur, merchant_id, mcc_code,
            basket, basket_rule
     FROM transactions WHERE ${where}
     ORDER BY tx_id DESC LIMIT :limit`,
    { ...params, limit },
  );

  const result: SpendingResult = {
    customerId: query.customerId,
    period,
    filters: {
      ...(query.category && { category: query.category }),
      ...(query.mcc && { mcc: query.mcc, mccLabel: lookupMcc(query.mcc)?.label ?? query.mcc }),
      ...(query.basket && { basket: query.basket }),
    },
    total: round2(totals.total ?? 0),
    count: totals.count,
    transactions: rows.map((row) => ({
      txId: row.tx_id,
      date: row.tx_date,
      timestamp: row.tx_timestamp,
      category: row.category,
      amount: round2(-row.tx_amount_eur),
      merchantId: row.merchant_id,
      mcc: row.mcc_code,
      mccLabel: lookupMcc(row.mcc_code)?.label ?? null,
      basket: row.basket,
      basketRule: row.basket_rule,
    })),
    truncated: totals.count > rows.length,
  };

  if (query.groupBy) {
    const expression = GROUP_EXPRESSION[query.groupBy];
    const groupBy = query.groupBy;
    result.groups = db
      .all<{ key: string; total: number; count: number }>(
        `SELECT ${expression} AS key, -sum(tx_amount_eur) AS total, count(*) AS count
         FROM transactions WHERE ${where}
         GROUP BY 1 ORDER BY ${groupBy === "month" ? "1" : "total DESC"}`,
        params,
      )
      .map((group) => ({
        key: group.key,
        label: groupLabel(groupBy, group.key),
        total: round2(group.total),
        count: group.count,
      }));
  }

  return result;
}
