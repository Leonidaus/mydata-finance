import type { Transaction, TransactionCategory } from "../schema";

export const INCOME_CATEGORIES: readonly TransactionCategory[] = ["Salary", "Other Income"];
export const SAVING_CATEGORIES: readonly TransactionCategory[] = ["Invest Deposit", "Salary Sweep"];
const NOT_SPENDING = new Set<string>([...INCOME_CATEGORIES, ...SAVING_CATEGORIES, "Invest Withdraw"]);

export const SPENDING_CATEGORIES: readonly TransactionCategory[] = [
  "Housing",
  "Utilities",
  "Groceries",
  "Restaurants",
  "Transportation",
  "Health",
  "Home & Tech",
  "Lifestyle",
  "Entertainment",
  "Travel",
];

export const isSpending = (t: Transaction) => !NOT_SPENDING.has(t.category) && t.tx_amount_eur < 0;
export const isIncome = (t: Transaction) => (INCOME_CATEGORIES as readonly string[]).includes(t.category);
export const isSaving = (t: Transaction) => (SAVING_CATEGORIES as readonly string[]).includes(t.category);

// ---- dates (ISO strings, UTC arithmetic) ----

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIso(d);
}

export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
export const monthOf = (iso: string) => iso.slice(0, 7);
export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export const endOfMonth = (iso: string) => addDays(addMonths(startOfMonth(iso), 1), -1);
export const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));

export const PERIODS = {
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  last_12_months: "Last 12 months",
} as const;
export type Period = keyof typeof PERIODS;

/** Inclusive [from, to] for a named period relative to `today`. Full months exclude the current one. */
export function resolvePeriod(period: Period, today: string): [string, string] {
  const thisMonth = startOfMonth(today);
  switch (period) {
    case "last_30_days":
      return [addDays(today, -29), today];
    case "this_month":
      return [thisMonth, today];
    case "last_month":
      return [addMonths(thisMonth, -1), addDays(thisMonth, -1)];
    case "last_3_months":
      return [addMonths(thisMonth, -3), addDays(thisMonth, -1)];
    case "last_12_months":
      return [addMonths(thisMonth, -12), addDays(thisMonth, -1)];
  }
}

export const inRange = (t: Transaction, from: string, to: string) => t.tx_date >= from && t.tx_date <= to;

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
