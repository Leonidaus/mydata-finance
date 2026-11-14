/**
 * Backtest of the payday forecast and the safe-to-spend allowance.
 *
 * For each customer and each cutoff date the engine sees only the transactions up to that
 * date, exactly as it would have on the day. Its forecast is then compared with what
 * actually happened up to the next salary payment.
 *
 *   npm run backtest -w @mydata/backend              all customers
 *   npm run backtest -w @mydata/backend -- --sample 500
 *
 * Writes a JSON summary next to the database (data/out/backtest.json).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  basketOf,
  type Customer,
  type EngineContext,
  planUntilPayday,
  runEngine,
  type Transaction,
} from "@mydata/shared";
import { DEFAULT_DB_PATH, openDatabase, resolveFromInvocationDir } from "./db";

/** The engine's monthly averages look back 12 full months, so a cutoff needs that much history. */
const MIN_HISTORY_MONTHS = 12;
const BILL_CATEGORIES = new Set(["Housing", "Utilities"]);

export interface BacktestCase {
  customerId: string;
  cutoff: string;
  predictedPayday: string;
  actualPayday: string;
  /** Forecast and actual balance just before the next salary arrives. */
  forecastBalance: number;
  actualBalance: number;
  billsPredicted: number;
  billsActual: number;
  /** The safe-to-spend amount until payday shown on the cutoff date (0 when nothing was safe). */
  allowance: number;
  /** What the customer actually spent on everyday spending from the cutoff to the salary. */
  everydayActual: number;
  /** Lowest balance between the cutoff and the salary. */
  minBalanceActual: number;
  /** Balance before salary had everyday spending been exactly the allowance. */
  balanceIfAllowanceSpent: number;
  typicalSalary: number;
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * One backtest case, or null when it cannot be evaluated: too little history before the
 * cutoff, or no salary after it within the data.
 * `tx` is the customer's full history in chronological order.
 */
export function backtestCase(customer: Customer, tx: Transaction[], cutoff: string): BacktestCase | null {
  let known = 0;
  while (known < tx.length && tx[known].tx_date <= cutoff) known++;
  if (known === 0 || tx[0].tx_date > monthsBefore(cutoff, MIN_HISTORY_MONTHS)) return null;

  let salaryIndex = known;
  while (salaryIndex < tx.length && tx[salaryIndex].category !== "Salary") salaryIndex++;
  if (salaryIndex >= tx.length) return null;

  // Only what was known on the cutoff date: no later transactions, no cohort data.
  const ctx: EngineContext = { customer, mortgage: null, tx: tx.slice(0, known), today: cutoff, cohorts: null };
  const plan = planUntilPayday(ctx);
  const forecastBalance = runEngine(ctx, "balanceForecast").value ?? 0;

  const salary = tx[salaryIndex];
  const actualBalance = salary.balance_after_eur - salary.tx_amount_eur;
  let billsActual = 0;
  let everydayActual = 0;
  let minBalanceActual = plan.balance;
  for (let i = known; i < salaryIndex; i++) {
    const t = tx[i];
    if (BILL_CATEGORIES.has(t.category)) billsActual -= t.tx_amount_eur;
    if (basketOf(t) === "everyday") everydayActual -= t.tx_amount_eur;
    if (t.balance_after_eur < minBalanceActual) minBalanceActual = t.balance_after_eur;
  }
  const allowance = Math.max(0, plan.available);
  const salaries = tx.slice(0, known).filter((t) => t.category === "Salary").slice(-3).map((t) => t.tx_amount_eur);
  salaries.sort((a, b) => a - b);

  return {
    customerId: customer.customer_id,
    cutoff,
    predictedPayday: plan.payday,
    actualPayday: salary.tx_date,
    forecastBalance,
    actualBalance,
    billsPredicted: plan.billsDue,
    billsActual,
    allowance,
    everydayActual,
    minBalanceActual,
    balanceIfAllowanceSpent: actualBalance + everydayActual - allowance,
    typicalSalary: salaries[Math.floor(salaries.length / 2)] ?? 0,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const share = (count: number, total: number) => (total === 0 ? 0 : round((100 * count) / total, 1));

export interface BacktestSummary {
  cases: number;
  customers: number;
  cutoffs: string[];
  /** Forecast balance before salary minus the actual one, in euros. */
  forecastError: { medianAbs: number; p90Abs: number; meanSigned: number; medianAbsPctOfSalary: number };
  billsError: { medianAbs: number; p90Abs: number; meanSigned: number };
  payday: { exactPct: number; within2DaysPct: number };
  allowance: {
    /** Cases where some amount was shown as safe to spend. */
    withAllowancePct: number;
    /** Of those: the customer's actual everyday spending stayed within the allowance. */
    stayedWithinPct: number;
    /** Of the customers who stayed within it: the balance still went below zero before the salary. */
    stayedWithinButBelowZeroPct: number;
    /** Of the cases with an allowance: spending all of it would have taken the balance below zero. */
    fullAllowanceOverdrawsPct: number;
    medianAllowance: number;
  };
}

export function summarize(cases: BacktestCase[], cutoffs: string[]): BacktestSummary {
  const errors = cases.map((c) => c.forecastBalance - c.actualBalance);
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const relative = cases
    .filter((c) => c.typicalSalary > 0)
    .map((c) => (100 * Math.abs(c.forecastBalance - c.actualBalance)) / c.typicalSalary)
    .sort((a, b) => a - b);
  const billErrors = cases.map((c) => c.billsPredicted - c.billsActual);
  const billAbs = billErrors.map(Math.abs).sort((a, b) => a - b);
  const dayDiff = cases.map((c) => Math.abs((Date.parse(c.predictedPayday) - Date.parse(c.actualPayday)) / 86_400_000));
  const withAllowance = cases.filter((c) => c.allowance > 0);
  const stayedWithin = withAllowance.filter((c) => c.everydayActual <= c.allowance);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    cases: cases.length,
    customers: new Set(cases.map((c) => c.customerId)).size,
    cutoffs,
    forecastError: {
      medianAbs: round(quantile(abs, 0.5)),
      p90Abs: round(quantile(abs, 0.9)),
      meanSigned: round(mean(errors)),
      medianAbsPctOfSalary: round(quantile(relative, 0.5), 1),
    },
    billsError: {
      medianAbs: round(quantile(billAbs, 0.5)),
      p90Abs: round(quantile(billAbs, 0.9)),
      meanSigned: round(mean(billErrors)),
    },
    payday: {
      exactPct: share(dayDiff.filter((d) => d === 0).length, cases.length),
      within2DaysPct: share(dayDiff.filter((d) => d <= 2).length, cases.length),
    },
    allowance: {
      withAllowancePct: share(withAllowance.length, cases.length),
      stayedWithinPct: share(stayedWithin.length, withAllowance.length),
      stayedWithinButBelowZeroPct: share(stayedWithin.filter((c) => c.minBalanceActual < 0).length, stayedWithin.length),
      fullAllowanceOverdrawsPct: share(withAllowance.filter((c) => c.balanceIfAllowanceSpent < 0).length, withAllowance.length),
      medianAllowance: round(quantile(withAllowance.map((c) => c.allowance).sort((a, b) => a - b), 0.5)),
    },
  };
}

/** The 5th, 15th and 25th of every month from `firstMonth` to `lastMonth` (YYYY-MM). */
export function monthlyCutoffs(firstMonth: string, lastMonth: string, days = [5, 15, 25]): string[] {
  const cutoffs: string[] = [];
  const cursor = new Date(`${firstMonth}-01T00:00:00Z`);
  const end = new Date(`${lastMonth}-01T00:00:00Z`);
  while (cursor <= end) {
    const month = cursor.toISOString().slice(0, 7);
    for (const day of days) cutoffs.push(`${month}-${String(day).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return cutoffs;
}

function main(): void {
  const args = process.argv.slice(2);
  const sampleIndex = args.indexOf("--sample");
  const sample = sampleIndex === -1 ? null : Number(args[sampleIndex + 1]);
  if (sample !== null && !(Number.isInteger(sample) && sample > 0)) {
    throw new Error("--sample needs a positive whole number");
  }

  const dbPath = process.env.FINANCE_DB ? resolveFromInvocationDir(process.env.FINANCE_DB) : DEFAULT_DB_PATH;
  const db = openDatabase(dbPath);
  // Cutoffs need 12 full months of history before them and a salary after them, inside the data.
  const first = new Date(`${db.meta.first_tx_date}T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + MIN_HISTORY_MONTHS);
  const last = new Date(`${db.meta.last_tx_date}T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() - 1);
  const cutoffs = monthlyCutoffs(first.toISOString().slice(0, 7), last.toISOString().slice(0, 7));

  let customers = db.all<Customer>(
    `SELECT customer_id, postal_code AS customer_postal_code, age AS customer_age
     FROM customer_profile ORDER BY customer_id`,
  );
  if (sample !== null && sample < customers.length) {
    const step = customers.length / sample;
    customers = Array.from({ length: sample }, (_, i) => customers[Math.floor(i * step)]);
  }

  const started = Date.now();
  const cases: BacktestCase[] = [];
  const byDay = new Map<string, BacktestCase[]>();
  customers.forEach((customer, index) => {
    const tx = db
      .all<Transaction>(
        `SELECT customer_id, bank_account_id, tx_date, tx_timestamp, category, tx_amount_eur,
                balance_after_eur, transaction_type, merchant_id, mcc_code, basket, basket_rule
         FROM transactions WHERE customer_id = :id ORDER BY tx_id`,
        { id: customer.customer_id },
      )
      .map((row) => ({ ...row }));
    for (const cutoff of cutoffs) {
      const result = backtestCase({ ...customer }, tx, cutoff);
      if (!result) continue;
      cases.push(result);
      const day = cutoff.slice(8);
      const list = byDay.get(day);
      if (list) list.push(result);
      else byDay.set(day, [result]);
    }
    if ((index + 1) % 1000 === 0) console.error(`  ${index + 1} / ${customers.length} customers`);
  });

  const summary = {
    builtFrom: dbPath,
    seconds: round((Date.now() - started) / 1000, 1),
    overall: summarize(cases, cutoffs),
    byCutoffDay: Object.fromEntries(
      [...byDay.entries()].sort().map(([day, list]) => [day, summarize(list, cutoffs.filter((c) => c.endsWith(day)))]),
    ),
  };
  const outPath = resolve(dirname(dbPath), "backtest.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  const o = summary.overall;
  console.log(`Backtest: ${o.cases.toLocaleString("en-US")} cases, ${o.customers.toLocaleString("en-US")} customers, cutoffs ${cutoffs[0]} to ${cutoffs.at(-1)} (${summary.seconds}s)`);
  console.log(`Balance before salary: median error €${o.forecastError.medianAbs} (${o.forecastError.medianAbsPctOfSalary}% of salary), 90% within €${o.forecastError.p90Abs}, bias €${o.forecastError.meanSigned}`);
  console.log(`Bills due: median error €${o.billsError.medianAbs}, 90% within €${o.billsError.p90Abs}, bias €${o.billsError.meanSigned}`);
  console.log(`Payday: exact in ${o.payday.exactPct}%, within 2 days in ${o.payday.within2DaysPct}%`);
  console.log(`Allowance shown in ${o.allowance.withAllowancePct}% of cases (median €${o.allowance.medianAllowance}); customers stayed within it in ${o.allowance.stayedWithinPct}%`);
  console.log(`  of those who stayed within it, ${o.allowance.stayedWithinButBelowZeroPct}% still went below zero before salary`);
  console.log(`  spending the full allowance would have overdrawn in ${o.allowance.fullAllowanceOverdrawsPct}% of cases`);
  for (const [day, s] of Object.entries(summary.byCutoffDay)) {
    console.log(`  cutoff day ${day}: median error €${s.forecastError.medianAbs}, bias €${s.forecastError.meanSigned}, full-allowance overdraw ${s.allowance.fullAllowanceOverdrawsPct}%`);
  }
  console.log(`Summary written to ${outPath}`);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
