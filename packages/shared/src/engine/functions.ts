/**
 * Finance engine: deterministic functions over one customer's transactions.
 * The AI chooses which function to call with which arguments; it never does the arithmetic.
 */
import { lookupMcc } from "../mcc";
import type { Transaction } from "../schema";
import { BASKET_LABELS, basketOf, detectStreams, type Stream } from "./streams";
import type { Basket, EngineContext, EngineFn, EngineResult, Row, TxFilter } from "./types";
import {
  addDays,
  addMonths,
  dayOfMonth,
  daysBetween,
  endOfMonth,
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
const period = (args: Record<string, unknown>, fallback: Period): Period =>
  typeof args.period === "string" && args.period in PERIODS ? (args.period as Period) : fallback;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function ageBand(age: number): string {
  const bands: [number, number][] = [[18, 24], [25, 34], [35, 44], [45, 54], [55, 64]];
  for (const [lo, hi] of bands) if (age >= lo && age <= hi) return `${lo}-${hi}`;
  return "65+";
}

// ---------- spending breakdowns ----------

function spendBy(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = period(args, "last_month");
  const [from, to] = resolvePeriod(p, ctx.today);
  const by = args.by === "merchant_type" ? "merchant_type" : "category";
  const category = str(args.category);
  const groups = new Map<string, { label: string; amount: number; count: number }>();
  for (const t of ctx.tx) {
    if (!isSpending(t) || !inRange(t, from, to) || (category && t.category !== category)) continue;
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
    caption: `${PERIODS[p]}${category ? `, ${category}` : ""}`,
    filter: { from, to, kind: "spending", category },
  };
}

function monthlyTrend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const months = Math.max(2, Math.min(24, num(args.months, 12)));
  const metric = (["spending", "income", "net", "saving"] as const).find((m) => m === args.metric) ?? "spending";
  const category = str(args.category);
  const thisMonth = startOfMonth(ctx.today);
  const from = addMonths(thisMonth, -months);
  const to = addDays(thisMonth, -1);
  const totals = new Map<string, number>();
  for (let i = 0; i < months; i++) totals.set(monthOf(addMonths(from, i)), 0);
  for (const t of ctx.tx) {
    if (!inRange(t, from, to) || (category && t.category !== category)) continue;
    const m = monthOf(t.tx_date);
    let v = 0;
    if (metric === "spending" && isSpending(t)) v = out(t);
    else if (metric === "income" && isIncome(t)) v = t.tx_amount_eur;
    else if (metric === "saving" && isSaving(t)) v = out(t);
    else if (metric === "net" && !isSaving(t)) v = t.tx_amount_eur;
    totals.set(m, (totals.get(m) ?? 0) + v);
  }
  const rows = [...totals.entries()].map(([month, amount]) => ({ month, amount: round2(amount) }));
  return {
    rows,
    value: round2(sum(rows.map((r) => r.amount)) / rows.length),
    unit: "€/month",
    caption: `Average ${metric}${category ? ` on ${category}` : ""} per month, last ${months} full months`,
    filter: { from, to, kind: metric === "net" ? "all" : metric, category },
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
    const b = basketOf(ctx, t);
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

function nextPayday(ctx: EngineContext): string {
  const salaryDays = ctx.tx.filter((t) => t.category === "Salary").map((t) => dayOfMonth(t.tx_date));
  const day = Math.round(median(salaryDays)) || 1;
  const candidate = (monthStart: string) => {
    const last = dayOfMonth(endOfMonth(monthStart));
    return `${monthStart.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const thisMonth = candidate(startOfMonth(ctx.today));
  return thisMonth > ctx.today ? thisMonth : candidate(addMonths(startOfMonth(ctx.today), 1));
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

function monthlyIrregular(ctx: EngineContext): number {
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  return sum(ctx.tx.filter((t) => inRange(t, from, to) && basketOf(ctx, t) === "irregular").map(out)) / 12;
}

interface Plan {
  balance: number;
  payday: string;
  daysLeft: number;
  due: { stream: Stream; date: string }[];
  regularDue: number;
  savingDue: number;
  buffer: number;
  available: number;
}

function plan(ctx: EngineContext): Plan {
  const balance = currentBalance(ctx);
  const payday = nextPayday(ctx);
  const daysLeft = Math.max(1, daysBetween(ctx.today, payday));
  const due = detectStreams(ctx)
    .map((stream) => ({ stream, date: dueDate(ctx, stream, payday) }))
    .filter((d): d is { stream: Stream; date: string } => d.date !== null);
  const regularDue = sum(due.filter((d) => !d.stream.saving).map((d) => d.stream.amount));
  const savingDue = sum(due.filter((d) => d.stream.saving).map((d) => d.stream.amount));
  const buffer = (monthlyIrregular(ctx) * daysLeft) / 30;
  return { balance, payday, daysLeft, due, regularDue, savingDue, buffer, available: balance - regularDue - savingDue - buffer };
}

function safeToSpend(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const p = plan(ctx);
  const horizon = args.horizon === "until_payday" ? "until_payday" : "week";
  const perDay = p.available / p.daysLeft;
  const value = horizon === "week" ? Math.min(p.available, perDay * Math.min(7, p.daysLeft)) : p.available;
  const rows: Row[] = [
    { term: "Balance today", amount: round2(p.balance) },
    { term: "Regular essentials due before payday", amount: round2(-p.regularDue) },
    { term: "Planned saving before payday", amount: round2(-p.savingDue) },
    { term: "Buffer for unexpected necessities", amount: round2(-p.buffer) },
    { term: `Safe to spend until payday (${p.payday})`, amount: round2(p.available) },
  ];
  return {
    rows,
    value: round2(Math.max(0, value)),
    unit: "€",
    caption:
      p.available <= 0
        ? `Nothing is safe to spend before payday on ${p.payday}: commitments exceed your balance.`
        : `${horizon === "week" ? "This week" : `Until payday ${p.payday}`} · about €${Math.round(perDay)} a day`,
    filter: { from: addDays(ctx.today, -29), to: ctx.today, kind: "all" },
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
  // Forecast: everyday spending at the recent daily rate, streams on their due dates, buffer spread evenly.
  const [from3, to3] = resolvePeriod("last_3_months", ctx.today);
  const everydayPerDay =
    sum(ctx.tx.filter((t) => inRange(t, from3, to3) && basketOf(ctx, t) === "everyday").map(out)) /
    Math.max(1, daysBetween(from3, to3) + 1);
  const bufferPerDay = p.buffer / p.daysLeft;
  let projected = p.balance;
  for (let d = addDays(ctx.today, 1); d <= p.payday; d = addDays(d, 1)) {
    projected -= everydayPerDay + bufferPerDay + sum(p.due.filter((x) => x.date === d).map((x) => x.stream.amount));
    rows.push({ date: d, balance: round2(projected), kind: "Forecast" });
  }
  return {
    rows,
    value: round2(projected),
    unit: "€",
    caption: `Projected balance on payday ${p.payday}`,
    filter: { from: start, to: ctx.today, kind: "all" },
  };
}

// ---------- what-if, peers, recurring, goals ----------

function whatIf(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const category = str(args.category) ?? "Restaurants";
  const cutPct = Math.max(0, Math.min(100, num(args.cutPct, 20)));
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const monthly = sum(ctx.tx.filter((t) => isSpending(t) && t.category === category && inRange(t, from, to)).map(out)) / 12;
  const perMonth = (monthly * cutPct) / 100;
  const rows: Row[] = Array.from({ length: 12 }, (_, k) => ({ month: k + 1, saved: round2(perMonth * (k + 1)) }));
  return {
    rows,
    value: round2(perMonth * 12),
    unit: "€ / year",
    caption: `Cutting ${category} by ${cutPct}% (now about €${Math.round(monthly)}/month) saves about €${Math.round(perMonth)} a month`,
    filter: { from, to, kind: "spending", category },
  };
}

function peerCompare(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const band = ageBand(ctx.customer.customer_age);
  const peers = ctx.cohorts?.bands[band] ?? {};
  const [from, to] = resolvePeriod("last_12_months", ctx.today);
  const own = new Map<string, number>();
  for (const t of ctx.tx) if (isSpending(t) && inRange(t, from, to)) own.set(t.category, (own.get(t.category) ?? 0) + out(t) / 12);
  const only = str(args.category);
  const categories = [...new Set([...own.keys(), ...Object.keys(peers)])].filter((c) => !only || c === only).sort();
  const rows: Row[] = categories.flatMap((category) => [
    { category, who: "You", amount: round2(own.get(category) ?? 0) },
    { category, who: `Peers ${band}`, amount: round2(peers[category] ?? 0) },
  ]);
  return {
    rows,
    unit: "€/month",
    caption: `Your monthly average (last 12 months) vs customers aged ${band}`,
    filter: { from, to, kind: "spending" },
  };
}

function recurring(ctx: EngineContext): EngineResult {
  const streams = detectStreams(ctx);
  const rows: Row[] = streams.map((s) => ({
    label: s.label,
    category: s.category,
    amount: s.amount,
    day: s.day,
    months: s.months,
    lastDate: s.lastDate,
    type: s.saving ? "Saving" : "Bill",
  }));
  return {
    rows,
    value: round2(sum(streams.filter((s) => !s.saving).map((s) => s.amount))),
    unit: "€/month",
    caption: "Payments that repeat roughly monthly at a similar amount (last 12 months)",
    filter: { from: addMonths(startOfMonth(ctx.today), -12), to: ctx.today, kind: "all" },
  };
}

function goalProgress(ctx: EngineContext, args: Record<string, unknown>): EngineResult {
  const [from12, to12] = resolvePeriod("last_12_months", ctx.today);
  const monthlySpend = sum(ctx.tx.filter((t) => isSpending(t) && inRange(t, from12, to12)).map(out)) / 12;
  let target = num(args.target, NaN);
  let label = str(args.label);
  if (!Number.isFinite(target)) {
    if (ctx.mortgage?.final_equity_amount_eur) {
      target = ctx.mortgage.final_equity_amount_eur;
      label ??= "Mortgage down payment";
    } else {
      target = Math.round(monthlySpend * 3);
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
          : `About ${monthsLeft} months to go at €${Math.round(rate)}/month`,
    filter: { kind: "saving" },
  };
}

// ---------- dispatch and drill-down ----------

const FNS: Record<EngineFn, (ctx: EngineContext, args: Record<string, unknown>) => EngineResult> = {
  spendBy,
  monthlyTrend,
  baskets,
  safeToSpend,
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
  return f(ctx, args);
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
    if (f.basket && basketOf(ctx, t) !== f.basket) return false;
    return true;
  });
}
