/**
 * Finance engine: deterministic functions over one customer's transactions.
 * The AI chooses which function to call with which arguments; it never does the arithmetic.
 */
import { ageBandLabel, type BenchmarkBasis, nationalBenchmark, STATFIN } from "../benchmark/statfin";
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import { EngineArgumentError, type TREND_METRICS, validateEngineArgs } from "./args";
import { BASKET_LABELS, basketOf } from "./baskets";
import { hasReceipt, itemSpend, receiptsByTx } from "./items";
import { detectStreams, SINGLE_PAYMENT_MAX_PER_MONTH, type Stream, streamKey } from "./streams";
import type { Basket, EngineContext, EngineFn, EngineResult, Row, TxFilter } from "./types";
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysBetween,
  displayDate,
  endOfMonth,
  euros,
  inRange,
  isIncome,
  isSaving,
  isSpending,
  median,
  monthOf,
  type Period,
  PERIODS,
  resolvePeriod,
  round2,
  startOfMonth,
  sum,
} from "./util";

const out = (t: Transaction) => -t.tx_amount_eur;
// Arguments are checked in runEngine (see args.ts); these helpers only apply defaults.
const period = (args: Record<string, unknown>, fallback: Period): Period => (args.period as Period | undefined) ?? fallback;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * How many of the last 12 full months the customer has data for (at least 1), so monthly
 * averages are not diluted for someone with a short history.
 */
function monthsOfHistory(ctx: EngineContext): number {
  const first = ctx.tx[0]?.tx_date;
  if (!first) return 12;
  const [from] = resolvePeriod("last_12_months", ctx.today);
  let months = 0;
  for (let i = 0; i < 12; i++) if (endOfMonth(addMonths(from, i)) >= first) months++;
  return Math.max(1, months);
}

export function ageBand(age: number): string {
  const bands: [number, number][] = [[18, 24], [25, 34], [35, 44], [45, 54], [55, 64]];
  for (const [lo, hi] of bands) if (age >= lo && age <= hi) return `${lo}-${hi}`;
  return "65+";
}

// ---------- spending breakdowns ----------

function spendBy(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = period(args, "last_month");
  const [from, to] = resolvePeriod(p, ctx.today);
  const merchantType = str(args.mcc);
  // Asking about one merchant type implies looking at merchant types.
  const by = args.by === "merchant_type" || (merchantType && args.by === undefined) ? "merchant_type" : "category";
  const category = str(args.category);
  const groups = new Map<string, { label: string; category: string; amount: number; count: number }>();
  for (const t of ctx.tx) {
    if (!isSpending(t) || !inRange(t, from, to) || (category && t.category !== category)) continue;
    if (merchantType && t.mcc_code !== merchantType) continue;
    const mcc = lookupMcc(t.mcc_code);
    const key = by === "category" ? t.category : (t.mcc_code ?? `none:${t.category}`);
    // A code that is not in the list keeps its number as the label, so it is still told apart.
    const label = by === "category" ? t.category : t.mcc_code ? (mcc?.label ?? `Merchant type ${t.mcc_code}`) : `${t.category} (no merchant type)`;
    // The category the bank gave the payments: for a merchant type, the first one seen.
    const g = groups.get(key) ?? { label, category: t.category, amount: 0, count: 0 };
    g.amount += out(t);
    g.count += 1;
    groups.set(key, g);
  }
  const rows: Row[] = [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, category: g.category, amount: round2(g.amount), count: g.count }))
    .sort((a, b) => (b.amount as number) - (a.amount as number));
  return {
    rows,
    value: round2(sum(rows.map((r) => r.amount as number))),
    unit: "€",
    caption: `${PERIODS[p]}${merchantType ? `, ${lookupMcc(merchantType)?.label ?? merchantType}` : category ? `, ${category}` : ""}`,
    filter: { from, to, kind: "spending", category, ...(merchantType && { mcc: merchantType }) },
  };
}

function monthlyTrend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const months = num(args.months, 12);
  const metric = (args.metric as (typeof TREND_METRICS)[number] | undefined) ?? "spending";
  const category = str(args.category);
  const merchantType = str(args.mcc);
  const subject = merchantType ? (lookupMcc(merchantType)?.label ?? merchantType) : category;
  const thisMonth = startOfMonth(ctx.today);
  const from = addMonths(thisMonth, -months);
  const to = addDays(thisMonth, -1);
  const totals = new Map<string, number>();
  for (let i = 0; i < months; i++) totals.set(monthOf(addMonths(from, i)), 0);
  for (const t of ctx.tx) {
    if (!inRange(t, from, to) || (category && t.category !== category)) continue;
    if (merchantType && t.mcc_code !== merchantType) continue;
    const m = monthOf(t.tx_date);
    let v = 0;
    if (metric === "spending" && isSpending(t)) v = out(t);
    else if (metric === "income" && isIncome(t)) v = t.tx_amount_eur;
    else if (metric === "saving" && isSaving(t)) v = out(t);
    else if (metric === "net" && (isIncome(t) || isSpending(t))) v = t.tx_amount_eur;
    totals.set(m, (totals.get(m) ?? 0) + v);
  }
  const rows = [...totals.entries()].map(([month, amount]) => ({ month, amount: round2(amount) }));
  return {
    rows,
    value: round2(sum(rows.map((r) => r.amount)) / rows.length),
    unit: "€/month",
    caption:
      metric === "net"
        ? `Average left over per month (income minus spending, before saving), last ${months} full months`
        : `Average ${metric}${subject ? ` on ${subject}` : ""} per month, last ${months} full months`,
    filter: { from, to, kind: metric, category, ...(merchantType && { mcc: merchantType }) },
  };
}

function baskets(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = period(args, "last_3_months");
  const [from, to] = resolvePeriod(p, ctx.today);
  const totals: Record<Basket, { amount: number; count: number }> = {
    regular: { amount: 0, count: 0 },
    irregular: { amount: 0, count: 0 },
    everyday: { amount: 0, count: 0 },
  };
  for (const t of ctx.tx) {
    if (!inRange(t, from, to)) continue;
    const b = basketOf(t);
    if (!b) continue;
    totals[b].amount += out(t);
    totals[b].count += 1;
  }
  const rows = (Object.keys(totals) as Basket[]).map((basket) => ({
    basket,
    label: BASKET_LABELS[basket],
    amount: round2(totals[basket].amount),
    count: totals[basket].count,
  }));
  return {
    rows,
    value: round2(sum(rows.map((r) => r.amount))),
    unit: "€",
    caption: PERIODS[p],
    filter: { from, to, kind: "spending" },
  };
}

function dailySpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = period(args, "last_3_months");
  const [from, to] = resolvePeriod(p, ctx.today);
  const days = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, 0);
  for (const t of ctx.tx) if (isSpending(t) && inRange(t, from, to)) days.set(t.tx_date, (days.get(t.tx_date) ?? 0) + out(t));
  const rows = [...days.entries()].map(([date, amount]) => ({ date, amount: round2(amount) }));
  return { rows, unit: "€", caption: PERIODS[p], filter: { from, to, kind: "spending" } };
}

// ---------- payday, safe to spend, forecast ----------

/** The day of the month in `monthStart`'s month, clamped to that month's length. */
function dayIn(monthStart: string, day: number): string {
  const last = dayOfMonth(endOfMonth(monthStart));
  return `${monthStart.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * The usual salary day (median over the whole history) and the latest day it has arrived
 * in the last 12 months. In the dataset salaries mostly come on one day but now and then
 * at the end of the month instead, so both matter.
 */
function salaryDays(ctx: EngineContext): { usual: number; latest: number } {
  const salaries = ctx.tx.filter((t) => t.category === "Salary");
  const usual = Math.round(median(salaries.map((t) => dayOfMonth(t.tx_date)))) || 1;
  const since = addMonths(startOfMonth(ctx.today), -12);
  const recent = salaries.filter((t) => t.tx_date >= since).map((t) => dayOfMonth(t.tx_date));
  return { usual, latest: Math.max(usual, ...recent) };
}

/**
 * When the next salary is expected, and the latest date it might plausibly arrive instead.
 * If the usual day has passed this month with no salary, it is expected on the late day.
 */
function nextPayday(ctx: EngineContext): { payday: string; latePayday: string } {
  const { usual, latest } = salaryDays(ctx);
  const thisMonth = startOfMonth(ctx.today);
  const paidThisMonth = ctx.tx.some((t) => t.category === "Salary" && t.tx_date >= thisMonth);
  if (!paidThisMonth) {
    const late = dayIn(thisMonth, latest);
    if (dayIn(thisMonth, usual) > ctx.today) return { payday: dayIn(thisMonth, usual), latePayday: late };
    if (late > ctx.today) return { payday: late, latePayday: late };
  }
  const nextMonth = addMonths(thisMonth, 1);
  return { payday: dayIn(nextMonth, usual), latePayday: dayIn(nextMonth, latest) };
}

/**
 * When a stream is next paid before `payday`, or null if it was already paid in the current
 * pay cycle (the month before payday). Payment days drift, so "paid" is judged per cycle.
 */
function dueDate(ctx: EngineContext, s: Stream, payday: string): string | null {
  const cycleStart = addMonths(payday, -1);
  if (s.dates.some((d) => d >= cycleStart && d <= ctx.today)) return null;
  for (let m = 0; m <= 1; m++) {
    const monthStart = addMonths(startOfMonth(ctx.today), m);
    const last = dayOfMonth(endOfMonth(monthStart));
    const due = `${monthStart.slice(0, 8)}${String(Math.min(s.day, last)).padStart(2, "0")}`;
    if (due > ctx.today) return due <= payday ? due : payday;
  }
  return payday;
}

function currentBalance(ctx: EngineContext): number {
  for (let i = ctx.tx.length - 1; i >= 0; i--) if (ctx.tx[i].tx_date <= ctx.today) return ctx.tx[i].balance_after_eur;
  return 0;
}

/** Average monthly total of one basket over the last 12 full months (fewer for a short history). */
function monthlyBasket(ctx: EngineContext, basket: Basket): number {
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  return sum(ctx.tx.filter((t) => inRange(t, from, to) && basketOf(t) === basket).map(out)) / monthsOfHistory(ctx);
}

/** The median size of the customer's unexpected-necessity purchases in the last 12 full months, or 0. */
function typicalIrregularPurchase(ctx: EngineContext): number {
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  return median(ctx.tx.filter((t) => inRange(t, from, to) && basketOf(t) === "irregular").map(out));
}

/** Average spend per day over the last 3 full months for the transactions `pick` selects. */
function dailyRate(ctx: EngineContext, pick: (t: Transaction) => boolean): number {
  const [from, to] = resolvePeriod("last_3_months", ctx.today);
  return sum(ctx.tx.filter((t) => inRange(t, from, to) && pick(t)).map(out)) / Math.max(1, daysBetween(from, to) + 1);
}

/** The amount of the customer's typical salary payment (median of the last three), or 0. */
function typicalSalary(ctx: EngineContext): number {
  return median(ctx.tx.filter((t) => t.category === "Salary").slice(-3).map((t) => t.tx_amount_eur));
}

interface DueItem {
  stream: Stream;
  /** When it is expected; for `spread` items this is payday and the amount falls evenly over the days left. */
  date: string;
  amount: number;
  spread: boolean;
}

interface Plan {
  balance: number;
  payday: string;
  daysLeft: number;
  due: DueItem[];
  /** Housing, utilities and other bills still expected before payday. */
  billsDue: number;
  savingDue: number;
  /** Regular essentials that are not bills (groceries, transport, routine health), per day. */
  essentialsPerDay: number;
  essentialsDue: number;
  everydayPerDay: number;
  /** Held back for unexpected necessities: at least one typical such purchase. */
  buffer: number;
  /** What unexpected necessities are expected to cost until payday on average; used by the forecast. */
  expectedIrregular: number;
  /** The latest date the salary might plausibly arrive; equals `payday` when it never comes late. */
  latePayday: string;
  /** Essentials and buffer for the days between `payday` and `latePayday`, kept back in case the salary is late. */
  lateMargin: number;
  /**
   * What is expected to be on the account at payday before any everyday spending: the balance less
   * bills, essentials and planned saving. Expected activity only, no precautions.
   */
  expectedLeft: number;
  /** `expectedLeft` less the reserve: what is left of this pay period's money after expected costs. */
  periodLeft: number;
  /** What the account could bear in everyday spending until payday: `expectedLeft` less the buffer and the late-salary margin. */
  available: number;
  /**
   * What was on the account just before the latest salary came in: money left from earlier pay
   * periods. It is the customer's to use, but it is not this period's money, so safe to spend
   * leaves it out. Never negative.
   */
  reserve: number;
  /**
   * The parts of `buffer` and `lateMargin` that the reserve does not cover and that therefore come out
   * of this pay period's money. Precautions are what a reserve is for, so it pays for them first.
   */
  bufferCharged: number;
  lateMarginCharged: number;
  /**
   * What is left of this pay period's money for everyday spending until payday: `available` less the
   * part of `reserve` that is not standing in for the precautions.
   */
  spendable: number;
}

/** The balance just before the latest salary was booked, or 0 when there was none or the account was overdrawn. */
function reserveBeforeLastSalary(ctx: EngineContext): number {
  for (let i = ctx.tx.length - 1; i >= 0; i--) {
    const t = ctx.tx[i];
    if (t.category === "Salary" && t.tx_date <= ctx.today) return Math.max(0, t.balance_after_eur - t.tx_amount_eur);
  }
  return 0;
}

/**
 * `statedReserve` is how much of the account the customer says is savings. Without it the
 * reserve is what was on the account before the last salary.
 */
function plan(ctx: EngineContext, statedReserve?: number): Plan {
  const balance = currentBalance(ctx);
  const { payday, latePayday } = nextPayday(ctx);
  const daysLeft = Math.max(1, daysBetween(ctx.today, payday));
  const cycleStart = addMonths(payday, -1);
  const streams = detectStreams(ctx);
  const due: DueItem[] = [];
  for (const stream of streams) {
    if (stream.paymentsPerMonth <= SINGLE_PAYMENT_MAX_PER_MONTH) {
      const date = dueDate(ctx, stream, payday);
      if (date) due.push({ stream, date, amount: stream.amount, spread: false });
      continue;
    }
    // Paid several times a month (utilities): what is left of a typical month's total.
    let paid = 0;
    stream.dates.forEach((d, i) => {
      if (d >= cycleStart && d <= ctx.today) paid += stream.amounts[i];
    });
    const remaining = round2(stream.monthlyAmount - paid);
    if (remaining > 0) due.push({ stream, date: payday, amount: remaining, spread: true });
  }
  const streamKeys = new Set(streams.map((s) => s.key));
  const billsDue = sum(due.filter((d) => !d.stream.saving).map((d) => d.amount));
  const savingDue = sum(due.filter((d) => d.stream.saving).map((d) => d.amount));
  const essentialsPerDay = dailyRate(ctx, (t) => basketOf(t) === "regular" && !streamKeys.has(streamKey(t)));
  const essentialsDue = essentialsPerDay * daysLeft;
  const everydayPerDay = dailyRate(ctx, (t) => basketOf(t) === "everyday");
  const irregularPerDay = monthlyBasket(ctx, "irregular") / 30;
  // Unexpected necessities come as single large purchases, so the buffer is at least the
  // size of one typical such purchase, not only the monthly average spread over the days left.
  const buffer = Math.max(irregularPerDay * daysLeft, typicalIrregularPurchase(ctx));
  const lateMargin = (essentialsPerDay + irregularPerDay) * Math.max(0, daysBetween(payday, latePayday));
  const available = balance - billsDue - essentialsDue - savingDue - buffer - lateMargin;
  // A stated reserve cannot be more than what is on the account.
  const reserve = statedReserve === undefined ? reserveBeforeLastSalary(ctx) : Math.min(statedReserve, Math.max(0, balance));
  const bufferCharged = Math.max(0, buffer - reserve);
  const lateMarginCharged = Math.max(0, lateMargin - Math.max(0, reserve - buffer));
  const expectedLeft = balance - billsDue - essentialsDue - savingDue;
  return {
    balance,
    payday,
    daysLeft,
    due,
    billsDue,
    savingDue,
    essentialsPerDay,
    essentialsDue,
    everydayPerDay,
    buffer,
    expectedIrregular: irregularPerDay * daysLeft,
    latePayday,
    lateMargin,
    expectedLeft,
    periodLeft: expectedLeft - reserve,
    available,
    reserve,
    bufferCharged,
    lateMarginCharged,
    spendable: balance - reserve - billsDue - essentialsDue - savingDue - bufferCharged - lateMarginCharged,
  };
}

/** The plan behind safe to spend and the forecast, exported for backtesting. */
export { plan as planUntilPayday };
export type { Plan };

/** The assumptions behind a plan, in plain language. */
function planAssumptions(ctx: EngineContext, p: Plan): string[] {
  const bills = p.due.filter((d) => !d.stream.saving).map((d) => `${d.stream.label} about ${euros(d.amount)}`);
  return [
    `Payday is taken to be ${displayDate(p.payday)}, from the day of the month your salary usually arrives.`,
    ...(p.lateMargin > 0
      ? [`Your salary has sometimes arrived as late as day ${Number(p.latePayday.slice(8))} of the month, so essentials for those extra days are kept back as a margin.`]
      : []),
    bills.length
      ? `Bills still expected before then: ${bills.join(", ")}.`
      : "No bills are expected before then: this pay cycle's housing and utilities are already paid.",
    `Groceries, transport and routine health costs are set aside at your average of the last 3 full months, about ${euros(p.essentialsPerDay)} a day.`,
    `The buffer covers unexpected necessities: your average of the last 12 months (about ${euros(monthlyBasket(ctx, "irregular"))} a month) for the days left, or one typical such purchase if that is more.`,
    p.savingDue > 0
      ? `Your usual saving transfer of about ${euros(p.savingDue)} is treated as already committed.`
      : "No regular saving transfer is expected before payday.",
    "This is an estimate from past patterns, not a guarantee. An unusually large bill would change it.",
  ];
}

/**
 * A precaution as a row: money the app suggests keeping available, not a bill and not spending.
 * `amount` is the part that comes out of this pay period's money; the rest is covered by the reserve.
 */
const precaution = (term: string, planned: number, charged: number): Row[] =>
  planned > 0 ? [{ term, amount: round2(-charged), kind: "precaution", planned: round2(planned), coveredByReserve: round2(planned - charged) }] : [];

function safeToSpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const stated = typeof args.reserve === "number";
  const p = plan(ctx, stated ? (args.reserve as number) : undefined);
  const horizon = args.horizon === "until_payday" ? "until_payday" : "week";
  const perDay = p.spendable / p.daysLeft;
  const value = horizon === "week" ? Math.min(p.spendable, perDay * Math.min(7, p.daysLeft)) : p.spendable;
  // Recorded and expected amounts first, then a subtotal, then the precautions and the suggestion.
  // The precautions are planning allowances: a card shows them in its calculation, not among the costs.
  const precautions = [
    ...precaution("Money kept available for unexpected costs", p.buffer, p.bufferCharged),
    ...precaution("Extra allowance for a later payday", p.lateMargin, p.lateMarginCharged),
  ];
  const rows: Row[] = [
    { term: "Balance today", amount: round2(p.balance), kind: "balance" },
    ...(p.reserve > 0 ? [{ term: stated ? "Savings you keep on this account" : "Reserve from before your last salary", amount: round2(-p.reserve), kind: "reserve" }] : []),
    { term: "Bills due before payday", amount: round2(-p.billsDue), kind: "expected" },
    { term: "Groceries and other essentials until payday", amount: round2(-p.essentialsDue), kind: "expected" },
    { term: "Planned saving before payday", amount: round2(-p.savingDue), kind: "expected" },
    ...(precautions.length ? [{ term: "Left of this pay period's money after expected costs", amount: round2(p.periodLeft), kind: "subtotal" }, ...precautions] : []),
    { term: `Safe to spend until payday (${displayDate(p.payday)})`, amount: round2(p.spendable), kind: "result" },
  ];
  const payday = displayDate(p.payday);
  // Why the suggestion is low, when it is. A shortfall that only the precautions cause is not a cash-flow problem.
  const caption =
    p.expectedLeft < 0
      ? `Expected bills and living costs until payday on ${payday} come to ${euros(-p.expectedLeft)} more than is on the account.`
      : p.periodLeft <= 0
        ? p.reserve > 0
          ? `This pay period's money is used up or spoken for until payday on ${payday}. Spending more would come out of the ${euros(p.reserve)} ${stated ? "you keep as savings" : "you had before your last salary"}.`
          : `This pay period's money is all spoken for by expected bills and living costs until payday on ${payday}.`
        : p.spendable <= 0
          ? `Your expected costs fit within the available money. The suggestion is to keep the remaining ${euros(p.periodLeft)} available for unexpected costs${p.lateMarginCharged > 0 ? " and a possible later payday" : ""}.`
          : `${horizon === "week" ? "This week" : `Until payday ${payday}`} · about ${euros(perDay)} a day for everyday spending`;
  return {
    rows,
    value: round2(Math.max(0, value)),
    unit: "€",
    caption,
    assumptions: [
      stated
        ? `The ${euros(p.reserve)} you said you keep on this account as savings is left out. It also stands in for the buffer and for a late salary, as far as it reaches.`
        : p.reserve > 0
        ? `Only this pay period's money counts. The ${euros(p.reserve)} that was on the account just before your last salary came in is treated as a reserve and left out: it is yours to use, but it is not this month's income. The reserve also stands in for the buffer and for a late salary, as far as it reaches, so those are not taken from this month's money. If a different amount of this account is savings, tell the coach.`
        : "Nothing was left on the account before your last salary came in, so the whole balance is this pay period's money.",
      ...(precautions.length
        ? ["The money kept available for unexpected costs and for a later payday is a planning allowance. It is not a bill, a payment or spending, and nothing has been charged."]
        : []),
      ...planAssumptions(ctx, p),
    ],
    filter: { from: addDays(ctx.today, -29), to: ctx.today, kind: "all" },
  };
}

function safeToSave(ctx: EngineContext): EngineResult {
  const p = plan(ctx);
  const everydayUntilPayday = p.everydayPerDay * p.daysLeft;
  const cushion = monthlyBasket(ctx, "regular");
  const left = p.available - everydayUntilPayday - cushion;

  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const months = monthsOfHistory(ctx);
  const inWindow = ctx.tx.filter((t) => inRange(t, from, to));
  const income = sum(inWindow.filter(isIncome).map((t) => t.tx_amount_eur)) / months;
  const spending = sum(inWindow.filter(isSpending).map(out)) / months;
  const saving = sum(inWindow.filter(isSaving).map(out)) / months;
  const surplus = income - spending - saving;
  const surplusText =
    surplus >= 0
      ? `Over the last ${months} months about ${euros(surplus)} a month was left after spending and your existing saving.`
      : `Over the last ${months} months you spent about ${euros(-surplus)} a month more than came in.`;

  const rows: Row[] = [
    { term: `Expected on the account at payday (${displayDate(p.payday)}), reserve included`, amount: round2(p.expectedLeft), kind: "balance" },
    { term: "Everyday spending at your usual pace", amount: round2(-everydayUntilPayday), kind: "expected" },
    ...(p.buffer + p.lateMargin > 0
      ? [{ term: "Money kept available for unexpected costs and a later payday", amount: round2(-(p.buffer + p.lateMargin)), kind: "precaution" }]
      : []),
    { term: "Cushion kept: one month of regular essentials", amount: round2(-cushion), kind: "precaution" },
    { term: left > 0 ? "Safe to move to savings now" : "Short of the cushion", amount: round2(left), kind: "result" },
  ];
  return {
    rows,
    value: round2(Math.max(0, left)),
    unit: "€",
    caption:
      left > 0
        ? `You could move about ${euros(left)} to savings now and still keep a cushion. ${surplusText}`
        : `Nothing is safe to move right now: after your usual spending you would be below a one-month cushion. ${surplusText}`,
    assumptions: [
      "This looks at the whole account, including money left from earlier pay periods: what is not needed before payday is what could be saved. Safe to spend counts this pay period's money only.",
      ...planAssumptions(ctx, p),
      `Everyday spending is assumed to continue at your average of the last 3 full months, about ${euros(p.everydayPerDay)} a day.`,
      `The cushion is one month of your regular essentials, about ${euros(cushion)}, kept in the account.`,
      saving > 0
        ? `Your existing saving, about ${euros(saving)} a month, is counted as already committed.`
        : "You have no regular saving transfer yet.",
    ],
    filter: { from, to, kind: "net" },
  };
}

function balanceForecast(ctx: EngineContext): EngineResult {
  const p = plan(ctx);
  const rows: Row[] = [];
  // Actual end-of-day balance for the last 30 days.
  const start = addDays(ctx.today, -30);
  let bal = 0;
  let i = 0;
  for (; i < ctx.tx.length && ctx.tx[i].tx_date < start; i++) bal = ctx.tx[i].balance_after_eur;
  for (let d = start; d <= ctx.today; d = addDays(d, 1)) {
    for (; i < ctx.tx.length && ctx.tx[i].tx_date === d; i++) bal = ctx.tx[i].balance_after_eur;
    rows.push({ date: d, balance: round2(bal), kind: "Actual" });
  }
  // Forecast (a best estimate, without the safety margins safe-to-spend holds back): everyday
  // spending and non-bill essentials at the recent daily rate, single bills on their due dates,
  // and average unexpected necessities and several-times-a-month bills spread evenly.
  const spreadPerDay = sum(p.due.filter((x) => x.spread).map((x) => x.amount)) / p.daysLeft;
  const perDay = p.everydayPerDay + p.essentialsPerDay + p.expectedIrregular / p.daysLeft + spreadPerDay;
  let projected = p.balance;
  for (let d = addDays(ctx.today, 1); d <= p.payday; d = addDays(d, 1)) {
    projected -= perDay + sum(p.due.filter((x) => !x.spread && x.date === d).map((x) => x.amount));
    rows.push({ date: d, balance: round2(projected), kind: "Forecast" });
  }
  const salary = typicalSalary(ctx);
  return {
    rows,
    value: round2(projected),
    unit: "€",
    caption: `Projected balance on payday ${displayDate(p.payday)}, before your salary${salary > 0 ? ` of about ${euros(salary)}` : ""} arrives`,
    assumptions: [
      ...planAssumptions(ctx, p),
      `Everyday spending is assumed to continue at your average of the last 3 full months, about ${euros(p.everydayPerDay)} a day.`,
      "The forecast stops just before payday and does not include the incoming salary.",
    ],
    filter: { from: start, to: ctx.today, kind: "all" },
  };
}

// ---------- what-if, peers, recurring, goals ----------

export const WHATIF_DEFAULT_CATEGORY = "Restaurants";

function whatIf(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const merchantType = str(args.mcc);
  // One merchant type (e.g. fast food) when given, otherwise a whole category.
  const category = merchantType ? undefined : (str(args.category) ?? WHATIF_DEFAULT_CATEGORY);
  const subject = merchantType ? (lookupMcc(merchantType)?.label ?? merchantType) : (category as string);
  const cutPct = num(args.cutPct, 20);
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const months = monthsOfHistory(ctx);
  const matches = (t: Transaction) => (merchantType ? t.mcc_code === merchantType : t.category === category);
  const monthly = sum(ctx.tx.filter((t) => isSpending(t) && matches(t) && inRange(t, from, to)).map(out)) / months;
  const perMonth = (monthly * cutPct) / 100;
  const rows: Row[] = Array.from({ length: 12 }, (_, k) => ({ month: k + 1, saved: round2(perMonth * (k + 1)) }));
  return {
    rows,
    value: round2(perMonth * 12),
    unit: "€ / year",
    caption: `Cutting ${subject} by ${cutPct}% (now about ${euros(monthly)}/month) saves about ${euros(perMonth)} a month`,
    assumptions: [`Based on your average ${subject} spending over the last ${months} full months continuing unchanged.`],
    filter: { from, to, kind: "spending", category, ...(merchantType && { mcc: merchantType }) },
  };
}

function peerCompare(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const band = ageBand(ctx.customer.customer_age);
  const peers = ctx.cohorts?.bands[band] ?? {};
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const months = monthsOfHistory(ctx);
  const own = new Map<string, number>();
  for (const t of ctx.tx) if (isSpending(t) && inRange(t, from, to)) own.set(t.category, (own.get(t.category) ?? 0) + out(t) / months);
  const only = str(args.category);
  const categories = [...new Set([...own.keys(), ...Object.keys(peers)])].filter((c) => !only || c === only).sort();
  const rows: Row[] = categories.flatMap((category) => [
    { category, who: "You", amount: round2(own.get(category) ?? 0) },
    { category, who: `Peers ${band}`, amount: round2(peers[category] ?? 0) },
  ]);
  const window = ctx.cohorts ? `${ctx.cohorts.window[0]} to ${ctx.cohorts.window[1]}` : null;
  return {
    rows,
    unit: "€/month",
    caption: `Your monthly average vs customers aged ${band} in the synthetic dataset, ${window ?? `${from} to ${to}`}`,
    assumptions: [
      "Peers are the synthetic customers in this dataset, not a representative sample of people in Finland.",
      "A peer with no spending in a category counts as zero in the average.",
      ...(window && window !== `${from} to ${to}` ? [`Your own average covers ${from} to ${to}; the peer average covers ${window}.`] : []),
    ],
    filter: { from, to, kind: "spending" },
  };
}

const monthLabel = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/**
 * The customer's monthly average per category next to what people in Finland spend, from
 * Statistics Finland's consumption survey raised to current prices (benchmark/statfin.ts).
 */
function nationalCompare(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const basis = (args.basis as BenchmarkBasis | undefined) ?? "one_adult";
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const months = monthsOfHistory(ctx);
  const national = nationalBenchmark(ctx.customer.customer_age, basis, monthOf(from), monthOf(to));
  const band = ageBandLabel(national.band);
  const own = new Map<string, number>();
  for (const t of ctx.tx) if (isSpending(t) && inRange(t, from, to)) own.set(t.category, (own.get(t.category) ?? 0) + out(t) / months);
  const only = str(args.category);
  const figures = national.figures.filter((f) => !only || f.category === only);
  const rows = figures.flatMap((f): Row[] => {
    const mine = round2(own.get(f.category) ?? 0);
    const theirs = round2(f.amount);
    return [
      { category: f.category, who: "You", amount: mine, difference: round2(mine - theirs) },
      { category: f.category, who: `Finland ${band}`, amount: theirs, in2022Prices: f.surveyAmount, covers: f.covers },
    ];
  });
  const who = basis === "household" ? `the average household in Finland in the ${band} age group` : `the Finnish average for one adult in the ${band} age group`;
  const priceWindow = `${monthLabel(national.priceWindow[0])} to ${monthLabel(national.priceWindow[1])}`;
  return {
    rows,
    unit: "€/month",
    caption: `Your monthly average next to ${who} (Statistics Finland, ${STATFIN.surveyYear} survey in today's prices)`,
    assumptions: [
      `Source: Statistics Finland, Households' consumption ${STATFIN.surveyYear}, by the age of the household member with the highest income. Each figure is raised from ${STATFIN.surveyYear} prices to those of ${priceWindow} with the consumer price index of its own category.`,
      basis === "household"
        ? "The national figure is for a whole household, whatever its size, and this is one account: it fits when this account pays for the whole household."
        : "The national figure is per adult-equivalent member of a household (consumption unit): roughly what one adult living alone spends. If this account pays for a whole family, compare with a whole household instead.",
      "Only prices are brought up to date; what people buy is as it was in the survey year.",
      ...figures.map((f) => f.note).filter(Boolean),
      "The customers in this demo are synthetic, so the comparison shows how the feature works, not how real customers spend.",
    ],
    filter: { from, to, kind: "spending" },
  };
}

function recurring(ctx: EngineContext): EngineResult {
  const streams = detectStreams(ctx);
  const rows: Row[] = streams.map((s) => ({
    label: s.label,
    category: s.category,
    amount: s.monthlyAmount,
    payments: Math.round(s.paymentsPerMonth),
    day: s.day,
    months: s.months,
    lastDate: s.lastDate,
    type: s.saving ? "Saving" : "Bill",
  }));
  return {
    rows,
    value: round2(sum(streams.filter((s) => !s.saving).map((s) => s.monthlyAmount))),
    unit: "€/month",
    caption: "Bills and saving transfers that repeat every month, with the typical monthly total (last 12 months)",
    filter: { from: addMonths(startOfMonth(ctx.today), -12), to: ctx.today, kind: "all" },
  };
}

function goalProgress(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const [from12, to12] = resolvePeriod("last_12_months", ctx.today);
  const monthlySpend = sum(ctx.tx.filter((t) => isSpending(t) && inRange(t, from12, to12)).map(out)) / monthsOfHistory(ctx);
  let target = num(args.target, NaN);
  let label = str(args.label);
  if (!Number.isFinite(target)) {
    if (ctx.mortgage?.final_equity_amount_eur) {
      target = ctx.mortgage.final_equity_amount_eur;
      label ??= "Mortgage down payment";
    } else {
      // At least €1 so a customer with no spending history still gets a finite percentage.
      target = Math.max(1, Math.round(monthlySpend * 3));
      label ??= "Emergency fund (3 months of spending)";
    }
  }
  const net = (t: Transaction) => (isSaving(t) ? out(t) : t.category === "Invest Withdraw" ? -t.tx_amount_eur : 0);
  const saved = Math.max(0, sum(ctx.tx.map(net)));
  // Average net saving over the last 6 full months.
  const from6 = addMonths(startOfMonth(ctx.today), -6);
  const rate = sum(ctx.tx.filter((t) => inRange(t, from6, to12)).map(net)) / 6;
  const remaining = Math.max(0, target - saved);
  const monthsLeft = remaining === 0 ? 0 : rate > 0 ? Math.ceil(remaining / rate) : null;
  return {
    rows: [{ label: label ?? "Goal", saved: round2(Math.min(saved, target)), target: round2(target), rate: round2(rate) }],
    value: round2((Math.min(saved, target) / target) * 100),
    unit: "%",
    caption:
      monthsLeft === 0
        ? "Goal reached"
        : monthsLeft === null
          ? "No regular saving yet: start with a small monthly transfer"
          : `About ${monthsLeft} months to go at ${euros(rate)}/month`,
    assumptions: [
      "Every transfer to savings or investments in this account's history counts toward the goal, starting from zero, minus withdrawals.",
      "Money saved before the data starts, or held elsewhere, is not visible here.",
    ],
    filter: { kind: "saving" },
  };
}

// ---------- planning towards a goal ----------

/** Average net transfer to savings per month over the last 6 full months (withdrawals count against it). */
function savingPace(ctx: EngineContext): number {
  const from = addMonths(startOfMonth(ctx.today), -6);
  const to = addDays(startOfMonth(ctx.today), -1);
  const net = (t: Transaction) => (isSaving(t) ? out(t) : t.category === "Invest Withdraw" ? -t.tx_amount_eur : 0);
  return sum(ctx.tx.filter((t) => inRange(t, from, to)).map(net)) / 6;
}

/** What has been left of the income after spending, per month, over the last 12 full months. Saving comes out of this. */
function leftAfterSpending(ctx: EngineContext): number {
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const inWindow = ctx.tx.filter((t) => inRange(t, from, to));
  return (sum(inWindow.filter(isIncome).map((t) => t.tx_amount_eur)) - sum(inWindow.filter(isSpending).map(out))) / monthsOfHistory(ctx);
}

/**
 * A plan towards a savings goal from figures the user gives: how long it takes at a monthly
 * amount, what a change to that amount does to the date, what a deadline needs, and whether
 * each of those fits what is left over after spending. No interest is assumed.
 *
 * Unlike goalProgress, nothing in the account counts as "already saved" here: a transfer to
 * investments does not show how much is set aside for this goal, so that comes from the user.
 */
function goalPlan(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const target = num(args.target, NaN);
  if (!Number.isFinite(target)) {
    throw new EngineArgumentError("goalPlan needs target: the amount to reach, in euros. Ask the user for it; do not guess.");
  }
  const saved = Math.min(num(args.saved, 0), target);
  const remaining = target - saved;
  const chosen = typeof args.monthly === "number";
  const pace = chosen ? (args.monthly as number) : Math.max(0, savingPace(ctx));
  const extra = num(args.extra, 0);
  const byMonths = typeof args.byMonths === "number" ? args.byMonths : null;
  const room = leftAfterSpending(ctx);
  const thisMonth = startOfMonth(ctx.today);

  const monthsAt = (monthly: number) => (remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null);
  const baseline = monthsAt(pace);
  // Extra saving that comes from a spending cut is paid for by the cut: it leaves as much over as before.
  const fundedByCut = args.extraFrom === "spending_cut" ? extra : 0;
  const scenario = (name: string, monthly: number, funded = 0): Row => {
    const months = monthsAt(monthly);
    const reached = months === null ? null : monthLabel(monthOf(addMonths(thisMonth, months)));
    return {
      scenario: name,
      monthly: round2(monthly),
      months,
      reached,
      sooner: baseline !== null && months !== null ? baseline - months : null,
      leftOver: round2(room + funded - monthly),
      fits: monthly <= room + funded ? "yes" : "no",
      summary: months === null ? "no date without a monthly amount" : `${euros(monthly)} a month · ${months} months · ${reached}`,
    };
  };
  const rows: Row[] = [scenario(chosen ? "Your plan" : "Current pace", pace)];
  if (extra > 0) rows.push(scenario(`With ${euros(extra)} more a month`, pace + extra, fundedByCut));
  if (byMonths !== null) rows.push(scenario(`To get there in ${byMonths} months`, Math.ceil(remaining / byMonths)));

  const [first, ...others] = rows;
  const caption =
    remaining === 0
      ? "The target is already covered by what is set aside."
      : first.months === null
        ? `${euros(remaining)} to go. There is no regular saving yet, so there is no date: choose a monthly amount.`
        : `${euros(remaining)} to go: about ${first.months} months at ${euros(pace)} a month, reached around ${first.reached}.`;
  const more = others.map((row) =>
    row.months === null ? "" : ` ${row.scenario}: ${euros(row.monthly as number)} a month, ${row.months} months (${row.reached}).`,
  );
  const tooMuch = rows.filter((row) => row.fits === "no");
  return {
    rows,
    value: round2(remaining),
    unit: "€",
    caption: caption + more.join(""),
    assumptions: [
      "No interest or investment returns are counted, and the target stays as it is.",
      args.saved === undefined
        ? "Nothing is counted as already saved: the account cannot tell what is set aside for this goal. Ask the user."
        : `The ${euros(saved)} already set aside is what the user said; the account cannot confirm it.`,
      chosen
        ? `The monthly amount, ${euros(pace)}, is the one the user chose.`
        : `The monthly amount, ${euros(pace)}, is the average net transfer to savings over the last 6 full months: an estimate of the current pace, not a commitment.`,
      room > 0
        ? `About ${euros(room)} a month has been left after spending, on average over the last 12 months. Saving comes out of that; "leftOver" is what remains of it in each scenario.`
        : "On average over the last 12 months, spending has been as large as income or larger, so nothing has been left to save.",
      ...(tooMuch.length
        ? [`Not realistic at today's income and spending: ${tooMuch.map((row) => row.scenario).join("; ")}. A longer timeline, a smaller target or lower spending would be needed.`]
        : []),
      ...(fundedByCut > 0 ? [`The extra ${euros(extra)} a month comes from spending less, so it does not reduce what is left over.`] : []),
      ...(str(args.since) ? [`The plan was agreed in ${monthLabel(str(args.since) as string)}. goalReview with the same target, saved, monthly and since shows how it is going.`] : []),
      "This is planning information from the user's own figures, not advice, and it says nothing about a loan decision.",
    ],
    filter: { kind: "saving" },
  };
}

/**
 * Where everyday spending could be cut: one row per category with what a cut of cutPct would
 * free each month. Only the everyday basket is considered, so essentials stay untouched, and
 * categories the user wants to keep are left out.
 */
function savingsOptions(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const protect = Array.isArray(args.protect) ? (args.protect as string[]) : [];
  const cutPct = num(args.cutPct, 20);
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const months = monthsOfHistory(ctx);
  const everyday = new Map<string, number>();
  for (const t of ctx.tx) {
    if (isSpending(t) && inRange(t, from, to) && basketOf(t) === "everyday") everyday.set(t.category, (everyday.get(t.category) ?? 0) + out(t) / months);
  }
  const rows: Row[] = [...everyday]
    .filter(([category, monthly]) => !protect.includes(category) && monthly >= MIN_OPTION_PER_MONTH)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_OPTIONS)
    .map(([category, monthly]) => {
      const saving = round2((monthly * cutPct) / 100);
      return { category, monthly: round2(monthly), saving, perYear: round2(saving * 12) };
    });
  const total = round2(sum(rows.map((row) => row.saving as number)));
  return {
    rows,
    value: total,
    unit: "€/month",
    caption: rows.length
      ? `Cutting everyday spending by ${cutPct}% in ${rows.length === 1 ? "this category" : `these ${rows.length} categories`} would free about ${euros(total)} a month`
      : "No everyday spending to cut outside what you want to keep",
    assumptions: [
      "Only everyday spending is looked at (monthly averages over the last 12 full months). Regular essentials, unexpected necessities and the cash buffer are left alone.",
      ...(protect.length ? [`Left out because the user wants to keep them: ${protect.join(", ")}.`] : []),
      "These are possibilities worked out from the spending, not recommendations: the user picks what feels realistic.",
      "The rows do not overlap, so their savings can be added together. A merchant type (taxis, fast food) is part of its category and must not be added on top.",
    ],
    filter: { from, to, kind: "spending", basket: "everyday" },
  };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const netSaving = (t: Transaction) => (isSaving(t) ? out(t) : t.category === "Invest Withdraw" ? -t.tx_amount_eur : 0);

/**
 * The calendar month up to today: money in, money out by basket, what was moved to savings and
 * what is left, next to what the customer has usually spent by the same day of the month.
 */
function monthSoFar(ctx: EngineContext): EngineResult {
  const from = startOfMonth(ctx.today);
  const day = dayOfMonth(ctx.today);
  const byNow = (monthStart: string) => {
    const lastDay = endOfMonth(monthStart);
    const upTo = addDays(monthStart, day - 1);
    return ctx.tx.filter((t) => inRange(t, monthStart, upTo < lastDay ? upTo : lastDay));
  };
  const spent = (rows: Transaction[], basket?: Basket) => sum(rows.filter((t) => isSpending(t) && (!basket || basketOf(t) === basket)).map(out));
  const earned = (rows: Transaction[]) => sum(rows.filter(isIncome).map((t) => t.tx_amount_eur));
  const moved = (rows: Transaction[]) => sum(rows.map(netSaving));

  const now = byNow(from);
  // The same days of the last three months, as far back as the history goes.
  const earlier = [1, 2, 3].map((k) => addMonths(from, -k)).filter((m) => ctx.tx.length > 0 && ctx.tx[0].tx_date <= m).map(byNow);
  // Each measure is called with the rows alone: `spent` takes a basket as its second argument.
  const usual = (measure: (rows: Transaction[]) => number) => (earlier.length ? round2(sum(earlier.map((rows) => measure(rows))) / earlier.length) : null);

  const income = earned(now);
  const spending = spent(now);
  const saving = moved(now);
  const left = income - spending - saving;
  const rows: Row[] = [
    { term: "Money in so far", amount: round2(income), usualByNow: usual(earned) },
    { term: BASKET_LABELS.regular, amount: round2(-spent(now, "regular")), usualByNow: usual((r) => -spent(r, "regular")) },
    { term: BASKET_LABELS.irregular, amount: round2(-spent(now, "irregular")), usualByNow: usual((r) => -spent(r, "irregular")) },
    { term: BASKET_LABELS.everyday, amount: round2(-spent(now, "everyday")), usualByNow: usual((r) => -spent(r, "everyday")) },
    { term: "Moved to savings", amount: round2(-saving), usualByNow: usual((r) => -moved(r)) },
    { term: "Left of this month's money so far", amount: round2(left), usualByNow: usual((r) => earned(r) - spent(r) - moved(r)) },
  ];
  const usualSpending = usual(spent);
  const month = MONTH_NAMES[Number(ctx.today.slice(5, 7)) - 1];
  const difference = usualSpending === null ? 0 : spending - usualSpending;
  const compared =
    usualSpending === null
      ? `you have spent ${euros(spending)}`
      : Math.abs(difference) < Math.max(20, usualSpending * 0.05)
        ? `you have spent ${euros(spending)}, about the same as usual by day ${day}`
        : `you have spent ${euros(spending)}, ${euros(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than usual by day ${day}`;
  return {
    rows,
    value: round2(left),
    unit: "€",
    caption:
      income === 0
        ? `${month} so far · nothing has come in yet, your salary is expected around ${displayDate(nextPayday(ctx).payday)} · ${compared}`
        : `${month} so far · ${compared}`,
    assumptions: [
      `This is the calendar month from the 1st to today, day ${day}. "Usual" is the average of the same days in the last ${earlier.length || "0"} months.`,
      "Money in is salary and other income. Transfers to savings and investments are not spending; they are shown on their own line.",
      "What is left is money in minus money out so far, not the balance: it leaves out what was on the account before this month.",
    ],
    filter: { from, to: ctx.today, kind: "all" },
  };
}

/**
 * How a savings plan is going: what was moved to savings each month since the plan started, next
 * to what the plan asked for, and when the target is reached at the agreed amount and at the pace
 * so far. The month in progress is shown but not judged.
 */
function goalReview(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const target = num(args.target, NaN);
  const monthly = num(args.monthly, NaN);
  if (!Number.isFinite(target) || !Number.isFinite(monthly)) {
    throw new EngineArgumentError("goalReview needs target and monthly: the plan's target and the amount agreed per month. Take them from the plan; do not guess.");
  }
  const saved = Math.min(num(args.saved, 0), target);
  const thisMonth = startOfMonth(ctx.today);
  // A plan cannot have started after today, and the review covers at most the last 24 months.
  const asked = str(args.since) ? `${str(args.since)}-01` : thisMonth;
  const earliest = addMonths(thisMonth, -24);
  const since = asked > thisMonth ? thisMonth : asked < earliest ? earliest : asked;

  let plannedTotal = 0;
  let movedTotal = 0;
  let movedComplete = 0;
  let leftComplete = 0;
  let completeMonths = 0;
  const rows: Row[] = [];
  for (let start = since; start <= thisMonth; start = addMonths(start, 1)) {
    const inProgress = start === thisMonth;
    const inMonth = ctx.tx.filter((t) => inRange(t, start, inProgress ? ctx.today : endOfMonth(start)));
    const moved = sum(inMonth.map(netSaving));
    const left = sum(inMonth.filter(isIncome).map((t) => t.tx_amount_eur)) - sum(inMonth.filter(isSpending).map(out)) - moved;
    plannedTotal += monthly;
    movedTotal += moved;
    if (!inProgress) {
      completeMonths++;
      movedComplete += moved;
      leftComplete += left;
    }
    rows.push({
      month: monthOf(start),
      planned: round2(plannedTotal),
      moved: round2(movedTotal),
      movedThisMonth: round2(moved),
      leftOnAccount: round2(left),
      status: inProgress ? "in progress" : "complete",
    });
  }

  const plannedComplete = monthly * completeMonths;
  const gap = movedComplete - plannedComplete;
  const setAside = saved + Math.max(0, movedTotal);
  const remaining = Math.max(0, target - setAside);
  const reachedAt = (perMonth: number) => (remaining === 0 ? 0 : perMonth > 0 ? Math.ceil(remaining / perMonth) : null);
  const dateAfter = (months: number | null) => (months === null ? null : monthLabel(monthOf(addMonths(thisMonth, months))));
  const atPlan = reachedAt(monthly);
  const pace = completeMonths > 0 ? movedComplete / completeMonths : null;
  const atPace = pace === null ? null : reachedAt(pace);

  const verdict =
    completeMonths === 0
      ? `The plan starts this month: ${euros(movedTotal)} moved to savings so far, ${euros(monthly)} planned for the month.`
      : gap >= -1
        ? `On plan: ${euros(movedComplete)} moved to savings in ${completeMonths} ${completeMonths === 1 ? "month" : "months"}, ${euros(plannedComplete)} planned.`
        : `Behind plan by ${euros(-gap)}: ${euros(movedComplete)} moved to savings in ${completeMonths} ${completeMonths === 1 ? "month" : "months"}, ${euros(plannedComplete)} planned.`;
  const notMoved =
    completeMonths > 0 && gap < -1 && leftComplete > 1
      ? ` Another ${euros(leftComplete)} was left on the account in those months without being moved.`
      : "";
  return {
    rows,
    value: round2(setAside),
    unit: "€",
    caption: `${verdict}${notMoved} ${euros(setAside)} of ${euros(target)} set aside.`,
    assumptions: [
      remaining === 0
        ? "The target is reached."
        : `${euros(remaining)} to go. At the agreed ${euros(monthly)} a month that is ${atPlan} months, around ${dateAfter(atPlan)}.` +
          (pace !== null && completeMonths > 0
            ? atPace === null
              ? " At the pace so far, with nothing moved to savings, there is no date."
              : ` At the pace so far, ${euros(pace)} a month, it is ${atPace} months, around ${dateAfter(atPace)}.`
            : ""),
      "Every transfer from this account to savings or investments counts towards the goal, minus withdrawals: the account cannot tell what a transfer is for.",
      args.saved === undefined
        ? "Nothing is counted as set aside before the plan started. Ask the user."
        : `The ${euros(saved)} set aside before the plan started is what the user said.`,
      "The month in progress is shown but not judged. No interest is counted.",
      "Money left on the account is not counted as saved until it is moved; it is shown per month as leftOnAccount.",
    ],
    filter: { from: since, to: ctx.today, kind: "saving" },
  };
}

// ---------- can I afford this? ----------

/** Below this share of the usual everyday spending a day, what is left after a purchase counts as tight. */
const TIGHT_SHARE_OF_USUAL = 0.5;

/**
 * Whether a one-off price fits this pay period's money: safe to spend until payday, minus the
 * price. A necessity (a repair, a dentist's bill) may also use the buffer for unexpected
 * necessities, which is what the buffer is for. What does not fit is set against the reserve,
 * and beyond that against what is usually left over a month, as the start of a savings goal.
 */
function afford(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const amount = num(args.amount, NaN);
  if (!Number.isFinite(amount)) throw new EngineArgumentError("afford needs amount: the price in euros.");
  const label = str(args.label) ?? "This purchase";
  const necessity = args.kind === "necessity";
  const estimated = args.price === "estimate";
  const stated = typeof args.reserve === "number";
  const p = plan(ctx, stated ? (args.reserve as number) : undefined);
  const safe = Math.max(0, p.spendable);
  const buffer = necessity ? p.buffer : 0;
  const left = safe + buffer - amount;
  const perDay = left / p.daysLeft;
  // The reserve stands in for the buffer and a late salary first; the rest of it is free to use.
  const freeReserve = Math.max(0, p.reserve - p.buffer - p.lateMargin);
  const room = leftAfterSpending(ctx);
  const payday = displayDate(p.payday);
  const everydayDays = p.everydayPerDay > 0 ? Math.round(amount / p.everydayPerDay) : 0;
  const equals = !necessity && everydayDays >= 2 ? ` It equals about ${everydayDays} days of your usual everyday spending.` : "";

  let caption: string;
  if (left >= 0 && (necessity || perDay >= TIGHT_SHARE_OF_USUAL * p.everydayPerDay)) {
    caption = necessity
      ? `Covered: this is what the buffer for unexpected necessities is for. ${euros(left)} is still left until payday ${payday}.`
      : `Fits: ${euros(left)} would be left until payday ${payday}, about ${euros(perDay)} a day.${equals}`;
  } else if (left >= 0) {
    caption = `Fits, but tightly: ${euros(left)} would be left until payday ${payday}, about ${euros(perDay)} a day, and you usually spend about ${euros(p.everydayPerDay)} a day.${equals}`;
  } else if (-left <= freeReserve) {
    caption = `More than this pay period has left: ${euros(-left)} would come out of the ${euros(p.reserve)} reserve on your account.`;
  } else if (room > 0) {
    caption = `Not from this pay period's money. About ${euros(room)} a month is usually left over after your spending, so this takes about ${Math.ceil(amount / room)} months of saving: a savings goal, not a purchase.`;
  } else {
    caption = "Not from this pay period's money, and nothing is usually left over after your spending: this needs a savings plan first.";
  }

  return {
    rows: [
      { term: `Safe to spend until payday (${payday})`, amount: round2(safe) },
      ...(necessity ? [{ term: "Money kept available for unexpected costs", amount: round2(buffer) }] : []),
      { term: estimated ? `${label} (estimated price)` : label, amount: round2(-amount) },
      { term: left >= 0 ? "Left until payday after this" : "Missing from this pay period's money", amount: round2(left) },
    ],
    value: round2(left),
    unit: "€",
    caption: estimated ? `Based on an estimated price of about ${euros(amount)}, not an exact one. ${caption}` : caption,
    assumptions: [
      ...(estimated ? ["The price is an estimate of what this typically costs. Give the real price for an exact answer."] : []),
      necessity
        ? "A necessity you could not plan for may use the buffer for unexpected necessities as well as what is safe to spend."
        : "A purchase you choose comes out of everyday spending: what is safe to spend until payday. Bills, essentials and the buffer stay untouched.",
      ...planAssumptions(ctx, p),
    ],
    filter: { from: addDays(ctx.today, -29), to: ctx.today, kind: "all" },
  };
}

/** A category that averages less than this a month is not worth suggesting. */
const MIN_OPTION_PER_MONTH = 10;
const MAX_OPTIONS = 5;

// ---------- dispatch and drill-down ----------

const FNS: Record<EngineFn, (ctx: EngineContext, args: Record<string, unknown>) => EngineResult> = {
  spendBy,
  monthlyTrend,
  baskets,
  safeToSpend,
  safeToSave,
  balanceForecast,
  whatIf,
  peerCompare,
  nationalCompare,
  dailySpend,
  recurring,
  goalProgress,
  goalPlan,
  savingsOptions,
  monthSoFar,
  goalReview,
  afford,
  itemSpend,
};

export function runEngine(ctx: EngineContext, fn: EngineFn, args: Record<string, unknown> = {}): EngineResult {
  const f = FNS[fn];
  if (!f) throw new Error(`Unknown engine function: ${fn}`);
  return f(ctx, validateEngineArgs(fn, args));
}

export function filterTransactions(ctx: EngineContext, f: TxFilter): Transaction[] {
  const byTx = f.withReceipt || f.subcategory ? receiptsByTx(ctx) : null;
  return ctx.tx.filter((t) => {
    if (byTx && !hasReceipt(t, byTx, f.subcategory)) return false;
    if (f.from && t.tx_date < f.from) return false;
    if (f.to && t.tx_date > f.to) return false;
    if (f.date && t.tx_date !== f.date) return false;
    if (f.month && monthOf(t.tx_date) !== f.month) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.mcc && (f.mcc.startsWith("none:") ? t.mcc_code !== null || t.category !== f.mcc.slice(5) : t.mcc_code !== f.mcc))
      return false;
    if (f.kind === "spending" && !isSpending(t)) return false;
    if (f.kind === "income" && !isIncome(t)) return false;
    if (f.kind === "saving" && !isSaving(t)) return false;
    if (f.kind === "net" && !(isIncome(t) || isSpending(t))) return false;
    if (f.basket && basketOf(t) !== f.basket) return false;
    return true;
  });
}
