/**
 * What is in the shopping: sums per item sub-category, from the receipts the user has linked to
 * card payments. Every figure says how much of the spending it covers, because receipts are only
 * ever a sample: "sweets 18 €" means something else from 2 receipts than from 40.
 */
import { ITEM_SUBCATEGORY_LABELS, type ItemSubcategory, type LinkedReceipt } from "../receipts/types";
import type { Transaction } from "../schema";
import type { EngineContext, EngineResult, Row } from "./types";
import { inRange, isSpending, type Period, PERIODS, resolvePeriod, round2 } from "./util";

const out = (t: Transaction) => -t.tx_amount_eur;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

/** The linked receipts by transaction id. */
export function receiptsByTx(ctx: EngineContext): Map<number, LinkedReceipt> {
  return new Map((ctx.receipts ?? []).map((r) => [r.txId, r]));
}

/** Whether a transaction has a receipt with a line of `subcategory` (or any receipt, without one). */
export function hasReceipt(t: Transaction, byTx: Map<number, LinkedReceipt>, subcategory?: string): boolean {
  const receipt = t.tx_id === undefined ? undefined : byTx.get(t.tx_id);
  if (!receipt) return false;
  return subcategory === undefined || receipt.lines.some((l) => l.kind === "item" && l.subcategory === subcategory);
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function itemSpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const byTx = receiptsByTx(ctx);
  const subcategory = str(args.subcategory) as ItemSubcategory | undefined;
  const category = str(args.category);
  const linked = ctx.tx.filter((t) => isSpending(t) && hasReceipt(t, byTx) && t.tx_date <= ctx.today && (!category || t.category === category));
  // Without a period: everything since the first receipt, so a handful of receipts is not cut in half.
  const p = args.period as Period | undefined;
  const [from, to] = p ? resolvePeriod(p, ctx.today) : [linked[0]?.tx_date ?? ctx.today, ctx.today];
  const when = p ? PERIODS[p] : `Since ${from}`;
  const inPeriod = linked.filter((t) => inRange(t, from, to));
  const filter = { from, to, kind: "spending" as const, withReceipt: true, ...(category && { category }), ...(subcategory && { subcategory }) };

  if (inPeriod.length === 0) {
    return {
      rows: [],
      caption: `${when}: no receipts`,
      assumptions: [
        ctx.receipts?.length
          ? "No receipt linked to a card payment falls in this period. Another period may have some."
          : "The user has not linked any receipts to card payments yet. Item figures come only from receipts: suggest photographing the next one.",
      ],
      filter,
    };
  }

  const groups = new Map<ItemSubcategory, { amount: number; count: number; trips: number }>();
  let itemsTotal = 0;
  for (const t of inPeriod) {
    const receipt = byTx.get(t.tx_id as number) as LinkedReceipt;
    const seen = new Set<ItemSubcategory>();
    for (const line of receipt.lines) {
      if (line.kind !== "item") continue;
      itemsTotal += line.amount;
      const g = groups.get(line.subcategory) ?? { amount: 0, count: 0, trips: 0 };
      g.amount += line.amount;
      g.count += 1;
      if (!seen.has(line.subcategory)) g.trips += 1;
      seen.add(line.subcategory);
      groups.set(line.subcategory, g);
    }
  }

  // Coverage: the linked payments against all spending in the same categories and period.
  const categories = [...new Set(inPeriod.map((t) => t.category))].sort();
  const covered = inPeriod.reduce((s, t) => s + out(t), 0);
  const all = ctx.tx.filter((t) => isSpending(t) && inRange(t, from, to) && categories.includes(t.category)).reduce((s, t) => s + out(t), 0);
  const coverage = all > 0 ? Math.round((covered / all) * 100) : 100;
  const receipts = inPeriod.length;

  const rows: Row[] = [...groups.entries()]
    .filter(([key]) => !subcategory || key === subcategory)
    .map(([key, g]) => ({
      key,
      label: ITEM_SUBCATEGORY_LABELS[key],
      amount: round2(g.amount),
      count: g.count,
      trips: g.trips,
      share: itemsTotal > 0 ? Math.round((g.amount / itemsTotal) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const value = subcategory ? round2((rows[0]?.amount as number | undefined) ?? 0) : round2(itemsTotal);
  const coverageNote = `From ${receipts} receipt${receipts === 1 ? "" : "s"}, which cover ${coverage}% of the ${list(categories)} spending in this period. Spending without a receipt is not itemised.`;
  return {
    rows,
    value,
    unit: "€",
    caption: `${when}${subcategory ? `, ${ITEM_SUBCATEGORY_LABELS[subcategory]}` : ""}, from ${receipts} receipt${receipts === 1 ? "" : "s"} (${coverage}% of ${list(categories)})`,
    assumptions: [
      coverageNote,
      ...(subcategory && rows.length === 0 ? [`None of these receipts has ${ITEM_SUBCATEGORY_LABELS[subcategory].toLowerCase()}.`] : []),
    ],
    filter,
  };
}
