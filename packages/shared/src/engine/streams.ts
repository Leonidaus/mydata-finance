/**
 * Recurring payment streams: bills and saving transfers that repeat every month.
 *
 * A stream is a group of outflows to the same merchant (or the same category when there
 * is no merchant) that repeats roughly monthly at a similar amount. Housing, Utilities and
 * saving transfers are always treated as streams. In the synthetic dataset no merchant is
 * paid a steady amount month after month, so in practice these forced streams are the
 * only ones; the detection stays for data where subscriptions exist.
 *
 * Streams drive planning (what is still due before payday). They do not decide baskets;
 * see baskets.ts for that.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import type { EngineContext } from "./types";
import { addMonths, dayOfMonth, isSaving, isSpending, median, monthOf, startOfMonth } from "./util";

export interface Stream {
  key: string;
  label: string;
  category: string;
  /** Typical (median) single payment, positive euros. */
  amount: number;
  /** Typical (median) total per month, positive euros. Differs from `amount` when a bill is paid several times a month. */
  monthlyAmount: number;
  /** Average number of payments in a month that has any. */
  paymentsPerMonth: number;
  /** Typical day of month it is paid. */
  day: number;
  months: number;
  lastDate: string;
  /** Payment dates in the last 12 months, oldest first. */
  dates: string[];
  /** Payment amounts matching `dates`, positive euros. */
  amounts: number[];
  saving: boolean;
}

const ALWAYS_STREAMS = new Set(["Housing", "Utilities"]);

export const streamKey = (t: Transaction) => `${t.category}|${t.merchant_id ?? "-"}`;

/** A stream paid more often than this per month is treated as one monthly total, not one bill. */
export const SINGLE_PAYMENT_MAX_PER_MONTH = 1.5;

const cache = new WeakMap<EngineContext, Stream[]>();

export function detectStreams(ctx: EngineContext): Stream[] {
  const hit = cache.get(ctx);
  if (hit) return hit;

  const since = addMonths(startOfMonth(ctx.today), -12);
  const groups = new Map<string, Transaction[]>();
  for (const t of ctx.tx) {
    if (t.tx_date < since || !(isSpending(t) || isSaving(t))) continue;
    const k = streamKey(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }

  const streams: Stream[] = [];
  for (const [key, txs] of groups) {
    const amounts = txs.map((t) => -t.tx_amount_eur);
    const perMonth = new Map<string, number>();
    for (const t of txs) perMonth.set(monthOf(t.tx_date), (perMonth.get(monthOf(t.tx_date)) ?? 0) - t.tx_amount_eur);
    const months = perMonth.size;
    const med = median(amounts);
    const spread = med > 0 ? median(amounts.map((a) => Math.abs(a - med))) / med : 1;
    const category = txs[0].category;
    const forced = ALWAYS_STREAMS.has(category) || isSaving(txs[0]);
    const looksMonthly = months >= 6 && txs.length / months <= SINGLE_PAYMENT_MAX_PER_MONTH && spread < 0.15;
    if (!forced && !looksMonthly) continue;
    const mcc = lookupMcc(txs[0].mcc_code);
    streams.push({
      key,
      label: mcc?.label ?? category,
      category,
      amount: Math.round(med * 100) / 100,
      monthlyAmount: Math.round(median([...perMonth.values()]) * 100) / 100,
      paymentsPerMonth: txs.length / months,
      day: Math.round(median(txs.map((t) => dayOfMonth(t.tx_date)))),
      months,
      lastDate: txs[txs.length - 1].tx_date,
      dates: txs.map((t) => t.tx_date),
      amounts,
      saving: isSaving(txs[0]),
    });
  }
  streams.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
  cache.set(ctx, streams);
  return streams;
}
