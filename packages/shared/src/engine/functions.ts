/**
 * Finance engine: deterministic functions over one customer's transactions.
 * The AI chooses which function to call with which arguments; it never does the arithmetic.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import { type TREND_METRICS, validateEngineArgs } from "./args";
import { BASKET_LABELS, basketOf } from "./baskets";
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
  const groups = new Map<string, { label: string; amount: number; count: number }>();
  for (const t of ctx.tx) {
    if (!isSpending(t) || !inRange(t, from, to) || (category && t.category !== category)) continue;
    if (merchantType && t.mcc_code !== merchantType) continue;
    const mcc = lookupMcc(t.mcc_code);
    const key = by === "category" ? t.category : (t.mcc_code ?? `none:${t.category}`);
    const label = by === "category" ? t.category : (mcc?.label ?? `${t.category} (no merchant type)`);
    const g = groups.get(key) ?? { label, amount: 0, count: 0 };
    g.amount += out(t);
    g.count += 1;
    groups.set(key, g);
  }
  const rows: Row[] = [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, amount: round2(g.amount), count: g.count }))
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
  /** What is left for everyday spending until payday. */
  available: number;
}

function plan(ctx: EngineContext): Plan {
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
    available: balance - billsDue - essentialsDue - savingDue - buffer - lateMargin,
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

function safeToSpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = plan(ctx);
  const horizon = args.horizon === "until_payday" ? "until_payday" : "week";
  const perDay = p.available / p.daysLeft;
  const value = horizon === "week" ? Math.min(p.available, perDay * Math.min(7, p.daysLeft)) : p.available;
  const rows: Row[] = [
    { term: "Balance today", amount: round2(p.balance) },
    { term: "Bills due before payday", amount: round2(-p.billsDue) },
    { term: "Groceries and other essentials until payday", amount: round2(-p.essentialsDue) },
    { term: "Planned saving before payday", amount: round2(-p.savingDue) },
    { term: "Buffer for unexpected necessities", amount: round2(-p.buffer) },
    { term: "Margin in case your salary arrives late", amount: round2(-p.lateMargin) },
    { term: `Safe to spend until payday (${displayDate(p.payday)})`, amount: round2(p.available) },
  ];
  return {
    rows,
    value: round2(Math.max(0, value)),
    unit: "€",
    caption:
      p.available <= 0
        ? `Nothing is safe to spend before payday on ${displayDate(p.payday)}: commitments exceed your balance.`
        : `${horizon === "week" ? "This week" : `Until payday ${displayDate(p.payday)}`} · about ${euros(perDay)} a day for everyday spending`,
    assumptions: planAssumptions(ctx, p),
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
    { term: `Safe to spend until payday (${displayDate(p.payday)})`, amount: round2(p.available) },
    { term: "Everyday spending at your usual pace", amount: round2(-everydayUntilPayday) },
    { term: "Cushion kept: one month of regular essentials", amount: round2(-cushion) },
    { term: left > 0 ? "Safe to move to savings now" : "Short of the cushion", amount: round2(left) },
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

function whatIf(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const merchantType = str(args.mcc);
  // One merchant type (e.g. fast food) when given, otherwise a whole category.
  const category = merchantType ? undefined : (str(args.category) ?? "Restaurants");
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
  dailySpend,
  recurring,
  goalProgress,
};

export function runEngine(ctx: EngineContext, fn: EngineFn, args: Record<string, unknown> = {}): EngineResult {
  const f = FNS[fn];
  if (!f) throw new Error(`Unknown engine function: ${fn}`);
  return f(ctx, validateEngineArgs(fn, args));
}

export function filterTransactions(ctx: EngineContext, f: TxFilter): Transaction[] {
  return ctx.tx.filter((t) => {
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
