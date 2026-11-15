/**
 * What is in the shopping, from the receipts the user has linked to card payments: sums per item
 * type or per shop (itemSpend), and per month (itemTrend). Receipts add what bank data cannot
 * know: the items inside a payment, and the name of the shop.
 *
 * Every figure says how many receipts it comes from, over which dates, and how much of the
 * spending they cover, because receipts are only ever a sample: "sweets 18 €" means something else
 * from 2 receipts than from 40. Item names never leave the engine; a search word is matched here.
 */
import { ITEM_SUBCATEGORY_LABELS, ITEM_TYPE_WORDS, type ItemSubcategory, type LinkedReceipt, type ReceiptLine } from "../receipts/types";
import type { Transaction } from "../schema";
import { EngineArgumentError } from "./args";
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
  const asked = wordsOf(query);
  if (asked.length === 0) return false; // punctuation alone asks for nothing
  const words = wordsOf(text);
  return asked.every((q) => words.some((w) => w.startsWith(q)));
}

/** A Finnish word may be this much longer than its stem: -a, -ia, -eja, -eihin. Longer is another word ("lihapullat"). */
const MAX_ENDING = 5;

const isTypeWord = (word: string, entry: string) =>
  entry.endsWith("*")
    ? word.startsWith(entry.slice(0, -1)) && word.length - (entry.length - 1) <= MAX_ENDING
    : word === entry || word === `${entry}s`;

/**
 * The kind of item a search names, when its words are an everyday name for exactly one kind:
 * "sweets" and "karkkia" are Snacks and sweets, "fuel" is Fuel. A product ("cola"), a word for
 * two kinds ("alcohol") or anything else gives none.
 */
export function itemTypeNamed(search: string): ItemSubcategory | undefined {
  const asked = wordsOf(search);
  if (asked.length === 0) return undefined;
  const named = (Object.entries(ITEM_TYPE_WORDS) as [ItemSubcategory, readonly string[]][]).filter(([, entries]) =>
    entries.some((entry) => {
      const words = entry.split(" ");
      return words.length === asked.length && words.every((w, i) => isTypeWord(asked[i], w));
    }),
  );
  return named.length === 1 ? named[0][0] : undefined;
}

/** A receipt's shop as one key: the name in lower case, or "-" when none was read. Rows per shop use it. */
export const shopKey = (merchant: string | undefined) => normalizeText(merchant ?? "") || "-";

/** The linked receipts by transaction id. */
export function receiptsByTx(ctx: EngineContext): Map<number, LinkedReceipt> {
  return new Map((ctx.receipts ?? []).map((r) => [r.txId, r]));
}

/** What narrows receipts down: the shop on them, and which of their lines count. */
interface ReceiptFilter {
  subcategory?: string;
  /** Part of the shop's name as printed on the receipt. */
  shop?: string;
  /** Exactly this shop, as its key (see shopKey): a tapped bar in a chart per shop. */
  receiptShop?: string;
  /** Part of an item line's name. */
  item?: string;
}

const lineMatches = (line: ReceiptLine, f: ReceiptFilter) =>
  line.kind === "item" && (!f.subcategory || line.subcategory === f.subcategory) && (!f.item || hasWords(line.name, f.item));

const shopMatches = (receipt: LinkedReceipt, f: ReceiptFilter) =>
  (!f.shop || hasWords(receipt.merchant ?? "", f.shop)) && (!f.receiptShop || shopKey(receipt.merchant) === f.receiptShop);

/** The lines of a receipt that count for `f`, or none when its shop does not match. */
function matchingLines(receipt: LinkedReceipt, f: ReceiptFilter): ReceiptLine[] {
  if (!shopMatches(receipt, f)) return [];
  return receipt.lines.filter((line) => lineMatches(line, f));
}

/** Whether a transaction has a receipt with lines that count for `f` (or any receipt, without a filter). */
export function hasReceipt(t: Transaction, byTx: Map<number, LinkedReceipt>, f: ReceiptFilter = {}): boolean {
  const receipt = t.tx_id === undefined ? undefined : byTx.get(t.tx_id);
  if (!receipt) return false;
  if (!f.subcategory && !f.shop && !f.item && !f.receiptShop) return true;
  return matchingLines(receipt, f).length > 0;
}

/** The receipt filter a drill-down carries. */
export const receiptFilterOf = (f: TxFilter): ReceiptFilter => ({ subcategory: f.subcategory, shop: f.shop, item: f.item, receiptShop: f.receiptShop });

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface Selected {
  t: Transaction;
  receipt: LinkedReceipt;
  /** The lines that count; none when the receipt was checked and has nothing asked for. */
  lines: ReceiptLine[];
}

/**
 * The sample: every linked payment in [from, to] (in the bank category asked about), with the
 * lines of its receipt that count: from the shop asked about, of the kind or with the words asked
 * about. A receipt without such lines still belongs to the sample: it was checked, and had none.
 * So a filter never makes the receipts look like a smaller share of the spending than they are.
 */
function select(ctx: EngineContext, from: string, to: string, category: string | undefined, f: ReceiptFilter): Selected[] {
  const byTx = receiptsByTx(ctx);
  const sample: Selected[] = [];
  for (const t of ctx.tx) {
    if (!isSpending(t) || t.tx_id === undefined || !inRange(t, from, to) || t.tx_date > ctx.today || (category && t.category !== category)) continue;
    const receipt = byTx.get(t.tx_id);
    if (!receipt) continue;
    sample.push({ t, receipt, lines: matchingLines(receipt, f) });
  }
  return sample;
}

/**
 * How many receipts were checked, over which dates, how many had what was asked, and what share
 * of the spending they cover: the linked payments against all spending in the same bank
 * categories over the same period.
 */
function coverageOf(ctx: EngineContext, sample: Selected[], from: string, to: string) {
  const categories = [...new Set(sample.map((s) => s.t.category))].sort();
  const covered = sample.reduce((s, p) => s + out(p.t), 0);
  const all = ctx.tx.filter((t) => isSpending(t) && inRange(t, from, to) && categories.includes(t.category)).reduce((s, t) => s + out(t), 0);
  return {
    receipts: sample.length,
    matching: sample.filter((s) => s.lines.length > 0).length,
    first: sample[0]?.t.tx_date ?? from,
    last: sample.at(-1)?.t.tx_date ?? to,
    categories,
    coverage: all > 0 ? Math.min(100, Math.round((covered / all) * 100)) : 100,
  };
}

/** What was asked, in words, after a count: `from "Alko"`, `with Snacks and sweets`, `with lines with "cola"`. Empty when nothing narrows it. */
function describeLines(subcategory: ItemSubcategory | undefined, f: ReceiptFilter): string {
  const kinds = [subcategory && ITEM_SUBCATEGORY_LABELS[subcategory], f.item && `lines with "${f.item}"`].filter(Boolean).join(", ");
  return [f.shop && `from "${f.shop}"`, kinds && `with ${kinds}`].filter(Boolean).join(" ");
}

/** What the filters ask for, in words: "Snacks and sweets", "at Alko", "lines with "cola"". */
function describeFilter(subcategory: ItemSubcategory | undefined, f: ReceiptFilter): string {
  return [subcategory && ITEM_SUBCATEGORY_LABELS[subcategory], f.shop && `at "${f.shop}"`, f.item && `lines with "${f.item}"`].filter(Boolean).join(", ");
}

/** Nothing to show: why, so the coach can say it. */
function noReceipts(ctx: EngineContext, filter: TxFilter, caption: string): EngineResult {
  return {
    rows: [],
    caption,
    assumptions: [
      !ctx.receipts?.length
        ? "The user has not linked any receipts to card payments yet. Item and shop figures come only from receipts: suggest photographing the next one."
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
  for (const [name, value] of [["shop", f.shop], ["search", f.item]] as const) {
    if (value !== undefined && wordsOf(value).length === 0) throw new EngineArgumentError(`${name} must contain at least one word.`);
  }
  // The kind of item together with a search for its own name ("snacks_sweets" and "sweets") asks one
  // thing twice, and the word would find nothing on lines that print product names: the kind is enough.
  if (subcategory && f.item && itemTypeNamed(f.item) === subcategory) f.item = undefined;
  return { subcategory, category: str(args.category), f };
}

/**
 * A search that found no line, though its word is an everyday name for a kind of item: the lines
 * print product names in the shop's language, so "sweets" is not on them. The question is then
 * answered with that kind, and the result says so. Null when the search stands as it is.
 */
function kindInsteadOfSearch<T extends Record<string, unknown>>(args: T, sample: Selected[], subcategory: ItemSubcategory | undefined, f: ReceiptFilter): { args: T; note: string } | null {
  if (!f.item || subcategory || sample.length === 0 || sample.some((s) => s.lines.length > 0)) return null;
  const kind = itemTypeNamed(f.item);
  if (!kind) return null;
  const { search: _search, ...rest } = args;
  return {
    args: { ...rest, subcategory: kind } as unknown as T,
    note: `No line on these receipts has the word "${f.item}": lines print product names in the shop's language. This shows the kind of item, ${ITEM_SUBCATEGORY_LABELS[kind]}, instead.`,
  };
}

/** What to tell the coach when a search found nothing and names no kind of item. */
const SEARCH_HINT = "A search looks for words printed on the item lines, which are product names in the shop's language. For a kind of item (sweets, fuel, ready meals), use subcategory instead of search.";

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
  // Without a period: everything since the first receipt checked, so a handful of receipts is not cut in half.
  const p = args.period as Period | undefined;
  const all = p ? null : select(ctx, "0000-01-01", ctx.today, category, f);
  const [from, to] = p ? resolvePeriod(p, ctx.today) : [all?.[0]?.t.tx_date ?? ctx.today, ctx.today];
  const sample = all ?? select(ctx, from, to, category, f);
  const swap = kindInsteadOfSearch(args, sample, subcategory, f);
  if (swap) {
    const shown = itemSpend(ctx, swap.args);
    return { ...shown, assumptions: [swap.note, ...(shown.assumptions ?? [])] };
  }
  const filter = drillFilter(from, to, category, f);
  if (sample.length === 0) return noReceipts(ctx, filter, `${p ? PERIODS[p] : "So far"}: no receipts`);

  const groups = new Map<string, { label: string; amount: number; count: number; trips: number }>();
  for (const { receipt, lines } of sample) {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = perShop ? shopKey(receipt.merchant) : line.subcategory;
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
  const c = coverageOf(ctx, sample, from, to);
  const span = c.first === c.last ? `on ${displayDate(c.first)}` : `from ${displayDate(c.first)} to ${displayDate(c.last)}`;
  const lines = describeLines(subcategory, f);
  // A search or one kind of item: how many of the receipts checked had it. Receipts without it still count as checked.
  const found = lines ? `, ${c.matching} ${lines}` : "";
  return {
    rows,
    value: round2(rows.reduce((s, r) => s + (r.amount as number), 0)),
    unit: "€",
    caption: `${plural(c.receipts, "receipt")} ${span}${found} (${c.coverage}% of ${list(c.categories)} spending)`,
    assumptions: [
      `${plural(c.receipts, "receipt")} checked, ${span}${found}. Payments with a receipt are ${c.coverage}% of the ${list(c.categories)} spending ${p ? `in ${PERIODS[p].toLowerCase()}` : `from ${displayDate(from)} to ${displayDate(to)}`}; spending without a receipt is not itemised.`,
      ...(lines && c.matching === 0 ? [`No receipt here matches what was asked (${lines}).`] : []),
      ...(f.item && c.matching === 0 ? [SEARCH_HINT] : []),
    ],
    filter,
    facts: { receipts: c.receipts, matching: c.matching, first: c.first, last: c.last, coverage: c.coverage, categories: c.categories.join(","), ...structured(subcategory, f) },
  };
}

export function itemTrend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const { subcategory, category, f } = readFilters(args);
  const months = typeof args.months === "number" ? args.months : 12;
  // This month counts too: receipts are often recent.
  const from = startOfMonth(addMonths(startOfMonth(ctx.today), -(months - 1)));
  const to = ctx.today;
  const sample = select(ctx, from, to, category, f);
  const swap = kindInsteadOfSearch(args, sample, subcategory, f);
  if (swap) {
    const shown = itemTrend(ctx, swap.args);
    return { ...shown, assumptions: [swap.note, ...(shown.assumptions ?? [])] };
  }
  const asked = describeFilter(subcategory, f);
  const filter = drillFilter(from, to, category, f);
  if (sample.length === 0) return noReceipts(ctx, filter, `Last ${months} months: no receipts`);

  // receipts: how many were checked that month, also those without what was asked.
  const totals = new Map<string, { amount: number; receipts: number }>();
  for (let i = 0; i < months; i++) totals.set(monthOf(addMonths(from, i)), { amount: 0, receipts: 0 });
  for (const { t, lines } of sample) {
    const m = totals.get(monthOf(t.tx_date));
    if (!m) continue;
    m.amount += lines.reduce((s, l) => s + l.amount, 0);
    m.receipts += 1;
  }
  const rows: Row[] = [...totals.entries()].map(([month, m]) => ({ month, amount: round2(m.amount), receipts: m.receipts }));
  const c = coverageOf(ctx, sample, from, to);
  const withReceipts = rows.filter((r) => (r.receipts as number) > 0).length;
  const lines = describeLines(subcategory, f);
  return {
    rows,
    value: round2(rows.reduce((s, r) => s + (r.amount as number), 0)),
    unit: "€",
    caption: `Per month, last ${months} months${asked ? `, ${asked}` : ""}: ${plural(c.receipts, "receipt")} in ${plural(withReceipts, "month")}${lines ? `, ${c.matching} ${lines}` : ""}`,
    assumptions: [
      "A month without receipts shows 0: nothing was photographed, which does not mean nothing was spent.",
      `Payments with a receipt are ${c.coverage}% of the ${list(c.categories)} spending in these months.`,
      ...(f.item && c.matching === 0 ? [SEARCH_HINT] : []),
    ],
    filter,
    facts: { receipts: c.receipts, matching: c.matching, months, monthsWithReceipts: withReceipts, coverage: c.coverage, categories: c.categories.join(","), ...structured(subcategory, f) },
  };
}
