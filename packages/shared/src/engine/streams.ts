/**
 * Recurring payment streams and the three spending baskets.
 *
 * A stream is a group of outflows to the same merchant (or the same category when there
 * is no merchant) that repeats roughly monthly at a similar amount. Housing, Utilities and
 * saving transfers are always treated as streams.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import type { Basket, EngineContext } from "./types";
import { addMonths, dayOfMonth, isSaving, isSpending, median, monthOf, startOfMonth } from "./util";

export interface Stream {
  key: string;
  label: string;
  category: string;
  /** Typical (median) outflow, positive euros. */
  amount: number;
  /** Typical day of month it is paid. */
  day: number;
  months: number;
  lastDate: string;
  /** Payment dates in the last 12 months. */
  dates: string[];
  saving: boolean;
}

const ALWAYS_REGULAR = new Set(["Housing", "Utilities"]);
const IRREGULAR_CATEGORIES = new Set(["Home & Tech", "Lifestyle", "Travel", "Health"]);
/**
 * A purchase in an IRREGULAR_CATEGORIES category is an "unexpected necessity" when it is at least
 * IRREGULAR_MULTIPLE times this customer's typical (median) purchase in that category, and at least
 * IRREGULAR_MIN_EUR. Relative, because "large" depends on the person: amounts in the data rarely
 * exceed a few hundred euros.
 */
export const IRREGULAR_MULTIPLE = 2.5;
export const IRREGULAR_MIN_EUR = 100;

export const streamKey = (t: Transaction) => `${t.category}|${t.merchant_id ?? "-"}`;

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
    const months = new Set(txs.map((t) => monthOf(t.tx_date))).size;
    const med = median(amounts);
    const spread = med > 0 ? median(amounts.map((a) => Math.abs(a - med))) / med : 1;
    const category = txs[0].category;
    const forced = ALWAYS_REGULAR.has(category) || isSaving(txs[0]);
    const looksMonthly = months >= 6 && txs.length / months <= 1.5 && spread < 0.15;
    if (!forced && !looksMonthly) continue;
    const mcc = lookupMcc(txs[0].mcc_code);
    streams.push({
      key,
      label: mcc?.label ?? category,
      category,
      amount: Math.round(med * 100) / 100,
      day: Math.round(median(txs.map((t) => dayOfMonth(t.tx_date)))),
      months,
      lastDate: txs[txs.length - 1].tx_date,
      dates: txs.map((t) => t.tx_date),
      saving: isSaving(txs[0]),
    });
  }
  streams.sort((a, b) => b.amount - a.amount);
  cache.set(ctx, streams);
  return streams;
}

const regularKeysCache = new WeakMap<EngineContext, Set<string>>();
const thresholdCache = new WeakMap<EngineContext, Map<string, number>>();

/** Per-category amount at or above which a purchase counts as an unexpected necessity. */
export function irregularThresholds(ctx: EngineContext): Map<string, number> {
  const hit = thresholdCache.get(ctx);
  if (hit) return hit;
  const amounts = new Map<string, number[]>();
  for (const t of ctx.tx) {
    if (!isSpending(t) || !IRREGULAR_CATEGORIES.has(t.category)) continue;
    const a = amounts.get(t.category) ?? [];
    a.push(-t.tx_amount_eur);
    amounts.set(t.category, a);
  }
  const out = new Map([...amounts].map(([c, a]) => [c, Math.max(IRREGULAR_MIN_EUR, IRREGULAR_MULTIPLE * median(a))]));
  thresholdCache.set(ctx, out);
  return out;
}

/** Which basket a spending transaction falls in; null for income, saving and transfers. */
export function basketOf(ctx: EngineContext, t: Transaction): Basket | null {
  if (!isSpending(t)) return null;
  let keys = regularKeysCache.get(ctx);
  if (!keys) {
    keys = new Set(detectStreams(ctx).filter((s) => !s.saving).map((s) => s.key));
    regularKeysCache.set(ctx, keys);
  }
  if (ALWAYS_REGULAR.has(t.category) || keys.has(streamKey(t))) return "regular";
  const threshold = irregularThresholds(ctx).get(t.category);
  if (threshold !== undefined && -t.tx_amount_eur >= threshold) return "irregular";
  return "everyday";
}

export const BASKET_LABELS: Record<Basket, string> = {
  regular: "Regular essentials",
  irregular: "Unexpected necessities",
  everyday: "Everyday spending",
};
