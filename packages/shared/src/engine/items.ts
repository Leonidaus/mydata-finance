/**
 * What is in the shopping, from the receipts the user has linked to card payments: sums per item
 * type or per shop (itemSpend), and per month (itemTrend). Receipts add what bank data cannot
 * know: the items inside a payment, and the name of the shop.
 *
 * Every figure says how many receipts it comes from, over which dates, and how much of the
 * spending they cover, because receipts are only ever a sample: "sweets 18 €" means something else
 * from 2 receipts than from 40. Item names never leave the engine; a search word is matched here.
 */
import { ITEM_SUBCATEGORY_LABELS, type ItemSubcategory, type LinkedReceipt, type ReceiptLine } from "../receipts/types";
import type { Transaction } from "../schema";
import type { EngineContext, EngineResult, Row, TxFilter } from "./types";
import { addMonths, displayDate, inRange, isSpending, monthOf, type Period, PERIODS, resolvePeriod, round2, startOfMonth } from "./util";

const out = (t: Transaction) => -t.tx_amount_eur;
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** Lower case without accents, so "Kahvi" finds "KAHVI" and "cafe" finds "Café". */
export const normalizeText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const wordsOf = (s: string) => normalizeText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Whether every word of `query` starts a word of `text`: "tip man" finds "Tip to Man", "man" does
 * not find "Woman", and "kahvi" finds "Kahvi 500g" and "KAHVIT".
 */
export function hasWords(text: string, query: string): boolean {
  const words = wordsOf(text);
  return wordsOf(query).every((q) => words.some((w) => w.startsWith(q)));
}

/** The linked receipts by transaction id. */
export function receiptsByTx(ctx: EngineContext): Map<number, LinkedReceipt> {
  return new Map((ctx.receipts ?? []).map((r) => [r.txId, r]));
}

/** What narrows receipts down: the shop on them, and which of their lines count. */
interface ReceiptFilter {
  subcategory?: string;
  /** Part of the shop's name as printed on the receipt. */
  shop?: string;
  /** Part of an item line's name. */
  item?: string;
}

const lineMatches = (line: ReceiptLine, f: ReceiptFilter) =>
  line.kind === "item" && (!f.subcategory || line.subcategory === f.subcategory) && (!f.item || hasWords(line.name, f.item));

/** The lines of a receipt that count for `f`, or none when its shop does not match. */
function matchingLines(receipt: LinkedReceipt, f: ReceiptFilter): ReceiptLine[] {
  if (f.shop && !hasWords(receipt.merchant ?? "", f.shop)) return [];
  return receipt.lines.filter((line) => lineMatches(line, f));
}

/** Whether a transaction has a receipt with lines that count for `f` (or any receipt, without a filter). */
export function hasReceipt(t: Transaction, byTx: Map<number, LinkedReceipt>, f: ReceiptFilter = {}): boolean {
  const receipt = t.tx_id === undefined ? undefined : byTx.get(t.tx_id);
  if (!receipt) return false;
  if (!f.subcategory && !f.shop && !f.item) return true;
  return matchingLines(receipt, f).length > 0;
}

/** The receipt filter a drill-down carries. */
export const receiptFilterOf = (f: TxFilter): ReceiptFilter => ({ subcategory: f.subcategory, shop: f.shop, item: f.item });

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Selected {
  t: Transaction;
  receipt: LinkedReceipt;
  lines: ReceiptLine[];
}

/** The linked payments in [from, to] whose receipt has lines that count, with those lines. */
function select(ctx: EngineContext, from: string, to: string, category: string | undefined, f: ReceiptFilter): Selected[] {
  const byTx = receiptsByTx(ctx);
  const picked: Selected[] = [];
  for (const t of ctx.tx) {
    if (!isSpending(t) || t.tx_id === undefined || !inRange(t, from, to) || t.tx_date > ctx.today || (category && t.category !== category)) continue;
    const receipt = byTx.get(t.tx_id);
    if (!receipt) continue;
    const lines = matchingLines(receipt, f);
    if (lines.length) picked.push({ t, receipt, lines });
  }
  return picked;
}

/**
 * How many receipts, over which dates, and what share of the spending they cover: the linked
 * payments against all spending in the same bank categories over the same period.
 */
function coverageOf(ctx: EngineContext, picked: Selected[], from: string, to: string) {
  const categories = [...new Set(picked.map((s) => s.t.category))].sort();
  const covered = picked.reduce((s, p) => s + out(p.t), 0);
  const all = ctx.tx.filter((t) => isSpending(t) && inRange(t, from, to) && categories.includes(t.category)).reduce((s, t) => s + out(t), 0);
  return {
    receipts: picked.length,
    first: picked[0]?.t.tx_date ?? from,
    last: picked.at(-1)?.t.tx_date ?? to,
    categories,
    coverage: all > 0 ? Math.min(100, Math.round((covered / all) * 100)) : 100,
  };
}

/** What the filters ask for, in words: "Snacks and sweets", "at Alko", "lines with "cola"". */
function describeFilter(subcategory: ItemSubcategory | undefined, f: ReceiptFilter): string {
  return [subcategory && ITEM_SUBCATEGORY_LABELS[subcategory], f.shop && `at "${f.shop}"`, f.item && `lines with "${f.item}"`].filter(Boolean).join(", ");
}

/** Nothing to show: why, so the coach can say it. */
function noReceipts(ctx: EngineContext, asked: string, filter: TxFilter, caption: string): EngineResult {
  return {
    rows: [],
    caption,
    assumptions: [
      !ctx.receipts?.length
        ? "The user has not linked any receipts to card payments yet. Item and shop figures come only from receipts: suggest photographing the next one."
        : asked
          ? `No linked receipt in this period has ${asked}. Another period, or a broader search, may have some.`
          : "No receipt linked to a card payment falls in this period. Another period may have some.",
    ],
    filter,
    facts: { receipts: 0 },
  };
}

/** The filters as data, for an app that words the caption in another language. */
const structured = (subcategory: ItemSubcategory | undefined, f: ReceiptFilter) => ({
  ...(subcategory && { subcategory }),
  ...(f.shop && { shop: f.shop }),
  ...(f.item && { search: f.item }),
});

function readFilters(args: Record<string, unknown>) {
  const subcategory = str(args.subcategory) as ItemSubcategory | undefined;
  const f: ReceiptFilter = { subcategory, shop: str(args.shop), item: str(args.search) };
  return { subcategory, category: str(args.category), f };
}

const drillFilter = (from: string, to: string, category: string | undefined, f: ReceiptFilter): TxFilter => ({
  from,
  to,
  kind: "spending",
  withReceipt: true,
  ...(category && { category }),
  ...(f.subcategory && { subcategory: f.subcategory }),
  ...(f.shop && { shop: f.shop }),
  ...(f.item && { item: f.item }),
});

export function itemSpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const { subcategory, category, f } = readFilters(args);
  const perShop = args.per === "shop";
  // Without a period: everything since the first matching receipt, so a handful of receipts is not cut in half.
  const p = args.period as Period | undefined;
  const all = p ? null : select(ctx, "0000-01-01", ctx.today, category, f);
  const [from, to] = p ? resolvePeriod(p, ctx.today) : [all?.[0]?.t.tx_date ?? ctx.today, ctx.today];
  const picked = all ?? select(ctx, from, to, category, f);
  const asked = describeFilter(subcategory, f);
  const filter = drillFilter(from, to, category, f);
  if (picked.length === 0) return noReceipts(ctx, asked, filter, `${p ? PERIODS[p] : "So far"}: no receipts${asked ? ` with ${asked}` : ""}`);

  const groups = new Map<string, { label: string; amount: number; count: number; trips: number }>();
  for (const { receipt, lines } of picked) {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = perShop ? normalizeText(receipt.merchant || "?") : line.subcategory;
      const label = perShop ? receipt.merchant || "Unknown shop" : ITEM_SUBCATEGORY_LABELS[line.subcategory];
      const g = groups.get(key) ?? { label, amount: 0, count: 0, trips: 0 };
      g.amount += line.amount;
      g.count += 1;
      if (!seen.has(key)) g.trips += 1;
      seen.add(key);
      groups.set(key, g);
    }
  }
  const rows: Row[] = [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, amount: round2(g.amount), count: g.count, trips: g.trips }))
    .sort((a, b) => b.amount - a.amount);
  const c = coverageOf(ctx, picked, from, to);
  const span = c.first === c.last ? `on ${displayDate(c.first)}` : `from ${displayDate(c.first)} to ${displayDate(c.last)}`;
  return {
    rows,
    value: round2(rows.reduce((s, r) => s + (r.amount as number), 0)),
    unit: "€",
    caption: `${plural(c.receipts, "receipt")} ${span}${asked ? `, ${asked}` : ""} (${c.coverage}% of ${list(c.categories)} spending)`,
    assumptions: [
      `From ${plural(c.receipts, "receipt")} ${span}. Payments with a receipt are ${c.coverage}% of the ${list(c.categories)} spending ${p ? `in ${PERIODS[p].toLowerCase()}` : `from ${displayDate(from)} to ${displayDate(to)}`}; spending without a receipt is not itemised.`,
    ],
    filter,
    facts: { receipts: c.receipts, first: c.first, last: c.last, coverage: c.coverage, categories: c.categories.join(","), ...structured(subcategory, f) },
  };
}

export function itemTrend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const { subcategory, category, f } = readFilters(args);
  const months = typeof args.months === "number" ? args.months : 12;
  // This month counts too: receipts are often recent.
  const from = startOfMonth(addMonths(startOfMonth(ctx.today), -(months - 1)));
  const to = ctx.today;
  const picked = select(ctx, from, to, category, f);
  const asked = describeFilter(subcategory, f);
  const filter = drillFilter(from, to, category, f);
  if (picked.length === 0) return noReceipts(ctx, asked, filter, `Last ${months} months: no receipts${asked ? ` with ${asked}` : ""}`);

  const totals = new Map<string, { amount: number; receipts: number }>();
  for (let i = 0; i < months; i++) totals.set(monthOf(addMonths(from, i)), { amount: 0, receipts: 0 });
  for (const { t, lines } of picked) {
    const m = totals.get(monthOf(t.tx_date));
    if (!m) continue;
    m.amount += lines.reduce((s, l) => s + l.amount, 0);
    m.receipts += 1;
  }
  const rows: Row[] = [...totals.entries()].map(([month, m]) => ({ month, amount: round2(m.amount), receipts: m.receipts }));
  const c = coverageOf(ctx, picked, from, to);
  const withReceipts = rows.filter((r) => (r.receipts as number) > 0).length;
  return {
    rows,
    value: round2(rows.reduce((s, r) => s + (r.amount as number), 0)),
    unit: "€",
    caption: `Per month, last ${months} months${asked ? `, ${asked}` : ""}: ${plural(c.receipts, "receipt")} in ${plural(withReceipts, "month")}`,
    assumptions: [
      "A month without receipts shows 0: nothing was photographed, which does not mean nothing was spent.",
      `Payments with a receipt are ${c.coverage}% of the ${list(c.categories)} spending in these months.`,
    ],
    filter,
    facts: { receipts: c.receipts, months, monthsWithReceipts: withReceipts, coverage: c.coverage, categories: c.categories.join(","), ...structured(subcategory, f) },
  };
}
