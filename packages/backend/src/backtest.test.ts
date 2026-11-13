import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { type Customer, planUntilPayday, type Transaction } from "@mydata/shared";
import { backtestCase, monthlyCutoffs, summarize } from "./backtest";

const customer: Customer = { customer_id: "CUST00001", customer_postal_code: "00100", customer_age: 30 };

/**
 * A regular customer: salary 2,000 on the 15th, rent 700 on the 1st, groceries 20 a day.
 * With `lateEvery`, every n-th salary arrives on the 28th instead.
 */
function regularHistory(firstMonth: string, months: number, lateEvery = 0): Transaction[] {
  const tx: Transaction[] = [];
  let balance = 3000;
  const add = (date: string, category: Transaction["category"], type: Transaction["transaction_type"], amount: number) => {
    balance += amount;
    tx.push({
      customer_id: customer.customer_id, bank_account_id: "ACC1", tx_date: date, tx_timestamp: `${date}T12:00:00`,
      category, tx_amount_eur: amount, balance_after_eur: Math.round(balance * 100) / 100,
      transaction_type: type, merchant_id: null, mcc_code: null,
    });
  };
  const start = new Date(`${firstMonth}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  for (const day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (day.getUTCDate() === 1) add(date, "Housing", "housing_payment", -700);
    const monthNumber = day.getUTCFullYear() * 12 + day.getUTCMonth();
    const late = lateEvery > 0 && monthNumber % lateEvery === 0;
    if (day.getUTCDate() === (late ? 28 : 15)) add(date, "Salary", "salary", 2000);
    add(date, "Groceries", "purchase", -20);
  }
  return tx;
}

describe("backtest", () => {
  const tx = regularHistory("2024-10", 24);

  it("forecasts a perfectly regular customer almost exactly", () => {
    const result = backtestCase(customer, tx, "2026-03-20")!;
    assert.equal(result.predictedPayday, "2026-04-15");
    assert.equal(result.actualPayday, "2026-04-15");
    assert.equal(result.billsPredicted, 700);
    assert.equal(result.billsActual, 700);
    // The forecast includes payday's own groceries (20) and averages groceries over three
    // calendar months of unequal length, so allow a little more than one day's spending.
    assert.ok(Math.abs(result.forecastBalance - result.actualBalance) < 30, `${result.forecastBalance} vs ${result.actualBalance}`);
    // The whole allowance could have been spent without going below zero.
    assert.ok(result.balanceIfAllowanceSpent > -30);
  });

  it("holds back essentials for the extra days when the salary sometimes comes late", () => {
    const sometimesLate = regularHistory("2024-10", 24, 4);
    const known = (history: Transaction[], cutoff: string) => ({
      customer, mortgage: null, tx: history.filter((t) => t.tx_date <= cutoff), today: cutoff, cohorts: null,
    });
    // 5 March 2026: the salary is expected on the 15th but has come as late as the 28th.
    const late = planUntilPayday(known(sometimesLate, "2026-03-05"));
    assert.equal(late.payday, "2026-03-15");
    assert.equal(late.latePayday, "2026-03-28");
    assert.ok(Math.abs(late.lateMargin - 13 * 20) < 5, String(late.lateMargin)); // 13 days of groceries
    assert.equal(planUntilPayday(known(tx, "2026-03-05")).lateMargin, 0);
    // 20 March with no salary yet this month: it is now expected on the 28th, not next month.
    const overdue = sometimesLate.filter((t) => !(t.category === "Salary" && t.tx_date.startsWith("2026-03")));
    assert.equal(planUntilPayday(known(overdue, "2026-03-20")).payday, "2026-03-28");
  });

  it("uses only what was known on the cutoff date", () => {
    const later = tx.map((t) => (t.tx_date > "2026-03-20" && t.category === "Groceries" ? { ...t, tx_amount_eur: -500 } : t));
    const a = backtestCase(customer, tx, "2026-03-20")!;
    const b = backtestCase(customer, later, "2026-03-20")!;
    assert.equal(a.forecastBalance, b.forecastBalance);
    assert.equal(a.allowance, b.allowance);
  });

  it("skips cutoffs without 12 months of history or without a later salary", () => {
    assert.equal(backtestCase(customer, tx, "2025-06-20"), null);
    assert.equal(backtestCase(customer, tx, "2026-09-20"), null);
  });

  it("lists three cutoffs a month and summarises cases", () => {
    assert.deepEqual(monthlyCutoffs("2026-01", "2026-02"), [
      "2026-01-05", "2026-01-15", "2026-01-25", "2026-02-05", "2026-02-15", "2026-02-25",
    ]);
    const cases = ["2026-02-20", "2026-03-20", "2026-04-20"].map((c) => backtestCase(customer, tx, c)!);
    const summary = summarize(cases, ["2026-02-20", "2026-03-20", "2026-04-20"]);
    assert.equal(summary.cases, 3);
    assert.equal(summary.payday.exactPct, 100);
    assert.equal(summary.allowance.fullAllowanceOverdrawsPct <= 100, true);
  });
});
