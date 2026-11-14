import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BENCHMARK_CATEGORY_NAMES } from "../benchmark/statfin";
import { applyOps, type Block } from "../blocks";
import { contextFromFixture, type FixtureBundle, type FixtureIndex } from "./fixture";
import { EngineArgumentError } from "./args";
import { basketOf, classifyBasket } from "./baskets";
import { filterTransactions, planUntilPayday, runEngine } from "./functions";
import { ENGINE_COLUMNS } from "../agent/catalog";
import { type Cohorts, ENGINE_FNS, type EngineContext } from "./types";
import { resolvePeriod, sum } from "./util";

const dir = fileURLToPath(new URL("../../../app/public/fixtures/", import.meta.url));
const load = <T>(name: string): T => JSON.parse(readFileSync(dir + name, "utf8")) as T;
const index = load<FixtureIndex>("index.json");
const cohorts = load<Cohorts>("cohorts.json");
const contexts = index.presets.map((p) => ({
  label: p.label,
  ctx: contextFromFixture(load<FixtureBundle>(`${p.customer_id}.json`), cohorts, index.today),
}));
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.05);

describe.each(contexts)("engine on $label", ({ ctx }) => {
  it("resolves last month to a full calendar month", () => {
    expect(resolvePeriod("last_month", "2026-09-15")).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("baskets add up to total spending by category", () => {
    const b = runEngine(ctx, "baskets", { period: "last_3_months" });
    const c = runEngine(ctx, "spendBy", { period: "last_3_months" });
    close(b.value!, c.value!);
  });

  it("each spendBy row matches the transactions behind it", () => {
    const r = runEngine(ctx, "spendBy", { period: "last_12_months" });
    for (const row of r.rows) {
      const txs = filterTransactions(ctx, { ...r.filter, category: row.key as string });
      close(-sum(txs.map((t) => t.tx_amount_eur)), row.amount as number);
    }
  });

  it("merchant-type drill-down covers the whole category", () => {
    const r = runEngine(ctx, "spendBy", { period: "last_12_months", by: "merchant_type", category: "Transportation" });
    const all = filterTransactions(ctx, { ...r.filter });
    const viaRows = r.rows.flatMap((row) => filterTransactions(ctx, { ...r.filter, mcc: row.key as string }));
    expect(viaRows.length).toBe(all.length);
  });

  it("safe-to-spend components add up", () => {
    const r = runEngine(ctx, "safeToSpend", { horizon: "until_payday" });
    const parts = r.rows.slice(0, -1).map((x) => x.amount as number);
    close(sum(parts), r.rows.at(-1)!.amount as number);
    expect(r.value).toBeGreaterThanOrEqual(0);
  });

  it("what-if scales with the cut", () => {
    const a = runEngine(ctx, "whatIf", { category: "Groceries", cutPct: 10 }).value!;
    const b = runEngine(ctx, "whatIf", { category: "Groceries", cutPct: 20 }).value!;
    close(b, a * 2);
  });

  it("forecast starts from today's balance and ends on payday", () => {
    const r = runEngine(ctx, "balanceForecast");
    const actual = r.rows.filter((x) => x.kind === "Actual");
    expect(actual.at(-1)!.date).toBe(ctx.today);
    expect(r.rows.at(-1)!.kind).toBe("Forecast");
  });

  it("peer comparison has a 'You' and a peer row per category", () => {
    const r = runEngine(ctx, "peerCompare");
    expect(r.rows.length % 2).toBe(0);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

describe.each(contexts)("financial definitions on $label", ({ ctx }) => {
  it("stored basket labels agree with the engine's own rules on every transaction", () => {
    // The labels in the fixtures come from data prep (Python); classifyBasket is the
    // TypeScript copy of the same rules. They must never drift apart.
    let labelled = 0;
    for (const t of ctx.tx) {
      const own = classifyBasket(t);
      expect(t.basket ?? null, `${t.tx_date} ${t.category} ${t.tx_amount_eur}`).toBe(own?.basket ?? null);
      if (own) expect(t.basket_rule).toBe(own.rule);
      if (t.basket) labelled++;
    }
    expect(labelled).toBeGreaterThan(100);
  });

  it("each basket total matches the transactions behind it", () => {
    const r = runEngine(ctx, "baskets", { period: "last_3_months" });
    for (const row of r.rows) {
      const txs = filterTransactions(ctx, { ...r.filter, basket: row.basket as "regular" | "irregular" | "everyday" });
      close(-sum(txs.map((t) => t.tx_amount_eur)), row.amount as number);
      expect(txs.every((t) => basketOf(t) === row.basket)).toBe(true);
    }
  });

  it("groceries are a regular essential and restaurants are everyday spending", () => {
    const groceries = ctx.tx.find((t) => t.category === "Groceries")!;
    const restaurant = ctx.tx.find((t) => t.category === "Restaurants")!;
    expect(basketOf(groceries)).toBe("regular");
    expect(basketOf(restaurant)).toBe("everyday");
  });

  it("net trend is income minus spending and its evidence reconciles", () => {
    const r = runEngine(ctx, "monthlyTrend", { metric: "net", months: 6 });
    expect(r.filter?.kind).toBe("net");
    const txs = filterTransactions(ctx, r.filter!);
    close(sum(txs.map((t) => t.tx_amount_eur)), sum(r.rows.map((row) => row.amount as number)));
    expect(txs.some((t) => t.category === "Invest Deposit" || t.category === "Salary Sweep")).toBe(false);
  });

  it("safe to save adds up and explains its assumptions", () => {
    const r = runEngine(ctx, "safeToSave");
    const parts = r.rows.slice(0, -1).map((x) => x.amount as number);
    close(sum(parts), r.rows.at(-1)!.amount as number);
    expect(r.value).toBe(Math.max(0, r.rows.at(-1)!.amount as number));
    expect(r.assumptions!.length).toBeGreaterThan(3);
  });

  it("safe to spend sets aside groceries and other essentials, and utilities still due", () => {
    const r = runEngine(ctx, "safeToSpend", { horizon: "until_payday" });
    const essentials = r.rows.find((x) => x.term === "Groceries and other essentials until payday")!;
    expect(essentials.amount as number).toBeLessThan(0);
    expect(r.assumptions!.some((a) => a.includes("Payday is taken to be"))).toBe(true);
  });

  it("never adds to the allowance through the late-salary margin", () => {
    const r = runEngine(ctx, "safeToSpend", { horizon: "until_payday" });
    const margin = r.rows.find((x) => String(x.term).startsWith("Margin in case your salary arrives late"))!;
    expect(margin.amount as number).toBeLessThanOrEqual(0);
  });

  it("counts this pay period's money only: what was on the account before the last salary is a reserve", () => {
    const p = planUntilPayday(ctx);
    const salary = ctx.tx.filter((t) => t.category === "Salary").at(-1)!;
    const before = salary.balance_after_eur - salary.tx_amount_eur;
    close(p.reserve, Math.max(0, before));
    // The reserve pays for the precautions first; nothing else of it is counted.
    const precautionsCovered = Math.min(p.reserve, p.buffer + p.lateMargin);
    close(p.spendable, p.available - p.reserve + precautionsCovered);
    expect(p.spendable).toBeLessThanOrEqual(p.available + 0.01);
    close(p.bufferCharged + p.lateMarginCharged, p.buffer + p.lateMargin - precautionsCovered);

    const r = runEngine(ctx, "safeToSpend", { horizon: "until_payday" });
    close(r.rows.at(-1)!.amount as number, p.spendable);
    const reserveRow = r.rows.find((x) => String(x.term).startsWith("Reserve"));
    if (p.reserve > 0) {
      close(reserveRow!.amount as number, -p.reserve);
      expect(r.assumptions![0]).toMatch(/Only this pay period's money counts/);
    } else {
      expect(reserveRow).toBeUndefined();
    }
    // Safe to save still looks at the whole account: money not needed before payday is what could be saved.
    close(runEngine(ctx, "safeToSave").rows[0].amount as number, p.available);
  });

  it("gives the same safe to spend whether the savings on the account are large or very large", () => {
    // The same customer with 50 000 € and with 80 000 € more on the account all along.
    const richer = (extra: number): EngineContext => ({ ...ctx, tx: ctx.tx.map((t) => ({ ...t, balance_after_eur: t.balance_after_eur + extra })) });
    const [a, b] = [50_000, 80_000].map((extra) => runEngine(richer(extra), "safeToSpend", { horizon: "until_payday" }));
    close(a.rows.at(-1)!.amount as number, b.rows.at(-1)!.amount as number);
    expect(a.value).toBe(b.value);
    // And it is this period's money: the last salary and what else came in, less what went out and what is still due.
    const p = planUntilPayday(richer(50_000));
    close(p.spendable, p.balance - p.reserve - p.billsDue - p.essentialsDue - p.savingDue);
    expect(p.bufferCharged + p.lateMarginCharged).toBe(0);
    // With nothing left over before the salary, the whole balance is this period's money and the precautions come out of it.
    const lowest = Math.min(...ctx.tx.map((t) => t.balance_after_eur));
    const broke = planUntilPayday(richer(-(lowest + 100_000)));
    expect(broke.reserve).toBe(0);
    close(broke.spendable, broke.available);
  });

  it("utilities count with their monthly total, not a single payment", () => {
    const utilities = runEngine(ctx, "recurring").rows.find((x) => x.category === "Utilities");
    if (!utilities) return; // this customer pays no utilities
    const [from, to] = resolvePeriod("last_3_months", ctx.today);
    const paid = -sum(filterTransactions(ctx, { from, to, category: "Utilities" }).map((t) => t.tx_amount_eur));
    // Within 40% of the recent monthly average; a single payment would be about a third of it.
    expect(Math.abs((utilities.amount as number) - paid / 3)).toBeLessThan(0.4 * (paid / 3));
  });

  it("rejects invalid arguments instead of falling back to defaults", () => {
    expect(() => runEngine(ctx, "baskets", { period: "last_year" })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "whatIf", { cutPct: 120 })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "whatIf", { cut_pct: 20 })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "goalProgress", { target: 0 })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "goalProgress", { target: -5 })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "spendBy", { category: "Salary" })).toThrow(EngineArgumentError);
    // Empty values mean "not given", as the app's controls send them.
    expect(runEngine(ctx, "spendBy", { category: "", period: "last_month" }).rows.length).toBeGreaterThan(0);
    expect(Number.isFinite(runEngine(ctx, "goalProgress", { target: 5000 }).value)).toBe(true);
  });

  it("narrows to one merchant type, so a question about taxis is not answered with all transport", () => {
    const taxis = runEngine(ctx, "spendBy", { period: "last_12_months", mcc: "4121" });
    const transport = runEngine(ctx, "spendBy", { period: "last_12_months", category: "Transportation" });
    const behind = filterTransactions(ctx, taxis.filter!);
    expect(behind.every((t) => t.mcc_code === "4121")).toBe(true);
    close(-sum(behind.map((t) => t.tx_amount_eur)), taxis.value!);
    expect(taxis.value!).toBeLessThanOrEqual(transport.value!);
    expect(taxis.rows.every((row) => row.key === "4121")).toBe(true);
    expect(taxis.caption).toContain("Taxis");

    const trend = runEngine(ctx, "monthlyTrend", { mcc: "4121", months: 12 });
    close(sum(trend.rows.map((row) => row.amount as number)), taxis.value!);
    const fastFood = runEngine(ctx, "whatIf", { mcc: "5814", cutPct: 50 });
    const restaurants = runEngine(ctx, "whatIf", { category: "Restaurants", cutPct: 50 });
    expect(fastFood.value!).toBeLessThanOrEqual(restaurants.value!);
    expect(fastFood.caption).toContain("Fast food");

    expect(() => runEngine(ctx, "spendBy", { mcc: "9999" })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "spendBy", { mcc: "4121", category: "Groceries" })).toThrow(/belongs to Transportation/);
  });

  it("compares with Statistics Finland per category, and says where the figures come from", () => {
    const r = runEngine(ctx, "nationalCompare");
    expect(r.rows.map((row) => row.category)).toEqual(BENCHMARK_CATEGORY_NAMES.flatMap((c) => [c, c]));
    for (let i = 0; i < r.rows.length; i += 2) {
      const [you, finland] = [r.rows[i], r.rows[i + 1]];
      expect(you.who).toBe("You");
      expect(String(finland.who)).toMatch(/^Finland \d/);
      close(you.difference as number, (you.amount as number) - (finland.amount as number));
      // The "You" figure is the same monthly average the peer comparison shows.
      const peer = runEngine(ctx, "peerCompare", { category: you.category }).rows.find((row) => row.who === "You");
      expect(you.amount).toBe(peer?.amount ?? 0);
    }
    expect(r.assumptions!.join(" ")).toMatch(/Statistics Finland.*2022.*consumer price index/);
    expect(r.assumptions!.join(" ")).toMatch(/synthetic/);
  });

  it("compares with one adult by default and with a whole household on request", () => {
    const one = runEngine(ctx, "nationalCompare", { category: "Groceries" });
    const all = runEngine(ctx, "nationalCompare", { category: "Groceries", basis: "household" });
    expect(one.rows).toHaveLength(2);
    expect(all.rows[1].amount as number).toBeGreaterThan(one.rows[1].amount as number);
    expect(one.caption).toMatch(/one adult/);
    expect(all.caption).toMatch(/household/);
    // A category without a national counterpart is an error, not an empty chart.
    expect(() => runEngine(ctx, "nationalCompare", { category: "Travel" })).toThrow(EngineArgumentError);
    expect(() => runEngine(ctx, "nationalCompare", { basis: "family" })).toThrow(/one_adult, household/);
  });

  it("returns the columns the coach is told each function has", () => {
    // Custom views may only read ENGINE_COLUMNS, so a column listed there must really be in the rows.
    for (const fn of ENGINE_FNS) {
      const { rows } = runEngine(ctx, fn, fn === "goalPlan" ? { target: 20000 } : fn === "afford" ? { amount: 100 } : fn === "goalReview" ? { target: 20000, monthly: 300, since: "2026-05" } : {});
      if (rows.length === 0) continue;
      const present = new Set(rows.flatMap((row) => Object.keys(row)));
      for (const column of ENGINE_COLUMNS[fn]) expect(present.has(column), `${fn}.${column}`).toBe(true);
    }
    expect(Object.keys(ENGINE_COLUMNS).sort()).toEqual([...ENGINE_FNS].sort());
  });

  it("plans towards a goal from the user's own figures, without counting anything as saved by itself", () => {
    expect(() => runEngine(ctx, "goalPlan")).toThrow(/needs target/);
    const plan = runEngine(ctx, "goalPlan", { target: 25000, saved: 10000, monthly: 400, extra: 100, byMonths: 24 });
    expect(plan.value).toBe(15000);
    expect(plan.rows.map((row) => [row.scenario, row.monthly, row.months, row.sooner])).toEqual([
      ["Your plan", 400, 38, 0],
      ["With 100 € more a month", 500, 30, 8],
      ["To get there in 24 months", 625, 24, 14],
    ]);
    // 38 months after September 2026.
    expect(plan.rows[0].reached).toBe("11/2029");
    expect(plan.caption).toMatch(/^15\s000 € to go: about 38 months at 400 € a month, reached around 11\/2029\./);
    // What is left over is the same pot in every scenario, less the scenario's own saving.
    close((plan.rows[0].leftOver as number) - (plan.rows[1].leftOver as number), 100);
    for (const row of plan.rows) expect(row.fits).toBe((row.leftOver as number) >= 0 ? "yes" : "no");
    expect(plan.assumptions!.join(" ")).toMatch(/No interest[\s\S]*10\s000 € already set aside is what the user said[\s\S]*the one the user chose/);

    // Extra saving paid for by spending less leaves as much over as the plan without it.
    const funded = runEngine(ctx, "goalPlan", { target: 25000, saved: 10000, monthly: 400, extra: 100, extraFrom: "spending_cut" });
    expect(funded.rows[1].leftOver).toBe(funded.rows[0].leftOver);
    expect(funded.rows[1].fits).toBe(funded.rows[0].fits);
    expect(funded.rows[1].months).toBe(30);

    // Without figures from the user: nothing saved, and the pace is the account's own saving.
    const bare = runEngine(ctx, "goalPlan", { target: 25000 });
    expect(bare.value).toBe(25000);
    expect(bare.rows).toHaveLength(1);
    expect(bare.rows[0].scenario).toBe("Current pace");
    expect(bare.assumptions!.join(" ")).toMatch(/Nothing is counted as already saved/);
    if (bare.rows[0].monthly === 0) expect(bare.rows[0].months).toBeNull();
    else expect(bare.rows[0].months).toBe(Math.ceil(25000 / (bare.rows[0].monthly as number)));

    // An amount no account could carry is called unrealistic, not just given a date.
    const steep = runEngine(ctx, "goalPlan", { target: 500000, byMonths: 6 });
    expect(steep.rows.at(-1)!.fits).toBe("no");
    expect(steep.assumptions!.join(" ")).toMatch(/Not realistic at today's income and spending: .*To get there in 6 months/);
    // Already covered.
    expect(runEngine(ctx, "goalPlan", { target: 5000, saved: 9000 })).toMatchObject({ value: 0, rows: [{ months: 0 }] });
  });

  it("offers savings only from everyday spending, leaving out what the user wants to keep", () => {
    const all = runEngine(ctx, "savingsOptions");
    const categories = all.rows.map((row) => row.category as string);
    expect(categories).not.toContain("Housing");
    expect(categories).not.toContain("Utilities");
    expect(categories).not.toContain("Groceries");
    for (const row of all.rows) {
      close(row.saving as number, (row.monthly as number) * 0.2);
      close(row.perYear as number, (row.saving as number) * 12);
      // The monthly figure is the everyday-basket spending in that category, as the drill-down shows it.
      const behind = filterTransactions(ctx, { ...all.filter!, category: row.category as string });
      expect(Math.abs(sum(behind.map((t) => -t.tx_amount_eur)) / 12 - (row.monthly as number))).toBeLessThan(0.02);
    }
    close(all.value!, sum(all.rows.map((row) => row.saving as number)));
    expect([...all.rows].sort((a, b) => (b.monthly as number) - (a.monthly as number))).toEqual(all.rows);

    if (categories.length) {
      const kept = runEngine(ctx, "savingsOptions", { protect: [categories[0]], cutPct: 10 });
      expect(kept.rows.map((row) => row.category)).not.toContain(categories[0]);
      expect(kept.assumptions!.join(" ")).toContain(`Left out because the user wants to keep them: ${categories[0]}`);
      // A query string gives the list as one text.
      expect(runEngine(ctx, "savingsOptions", { protect: `${categories[0]}, Groceries`, cutPct: 10 }).rows).toEqual(kept.rows);
    }
    expect(() => runEngine(ctx, "savingsOptions", { protect: ["Holidays"] })).toThrow(/list of categories/);
  });

  it("shows the month so far as money in, money out and what is left, next to the usual", () => {
    const r = runEngine(ctx, "monthSoFar");
    const [from, to] = ["2026-09-01", ctx.today];
    const inMonth = filterTransactions(ctx, { from, to });
    const amount = (term: string) => r.rows.find((row) => row.term === term)!.amount as number;
    close(amount("Money in so far"), sum(inMonth.filter((t) => t.category === "Salary" || t.category === "Other Income").map((t) => t.tx_amount_eur)));
    // The three basket lines are exactly this month's spending.
    const spending = -sum(filterTransactions(ctx, { from, to, kind: "spending" }).map((t) => t.tx_amount_eur));
    close(-(amount("Regular essentials") + amount("Unexpected necessities") + amount("Everyday spending")), spending);
    // The lines add up to what is left, which is also the headline.
    close(sum(r.rows.slice(0, -1).map((row) => row.amount as number)), r.rows.at(-1)!.amount as number);
    close(r.value!, r.rows.at(-1)!.amount as number);
    // "Usual" is the same days of the three months before.
    const usual = [1, 2, 3].map((k) => {
      const month = `2026-0${9 - k}`;
      return -sum(filterTransactions(ctx, { from: `${month}-01`, to: `${month}-15`, kind: "spending" }).map((t) => t.tx_amount_eur));
    });
    const usualSpending = -sum(r.rows.slice(1, 4).map((row) => row.usualByNow as number));
    close(usualSpending, sum(usual) / 3);
    expect(r.caption).toMatch(/^September so far · /);
    // The sentence compares the same two figures the rows show.
    const said = /you have spent ([\d\s]+) €(?:, ([\d\s]+) € (more|less) than usual| , about the same)?/.exec(r.caption!.replace(/\u00a0/g, " "));
    expect(Number(said![1].replace(/\s/g, ""))).toBe(Math.round(spending));
    if (said![2]) {
      expect(Number(said![2].replace(/\s/g, ""))).toBe(Math.round(Math.abs(spending - sum(usual) / 3)));
      expect(said![3]).toBe(spending > sum(usual) / 3 ? "more" : "less");
    } else {
      expect(Math.abs(spending - sum(usual) / 3)).toBeLessThan(Math.max(20, (sum(usual) / 3) * 0.05) + 1);
    }
  });

  it("lets the customer say how much of the account is savings", () => {
    const inferred = planUntilPayday(ctx);
    const none = runEngine(ctx, "safeToSpend", { horizon: "until_payday", reserve: 0 });
    // With nothing kept as savings, the whole balance is for spending, as before the reserve existed.
    close(none.rows.at(-1)!.amount as number, inferred.available);
    expect(none.rows.some((row) => /Reserve|Savings you keep/.test(String(row.term)))).toBe(false);
    if (inferred.balance > 200) {
      const some = runEngine(ctx, "safeToSpend", { horizon: "until_payday", reserve: 150 });
      expect(some.rows[1]).toEqual({ term: "Savings you keep on this account", amount: -150 });
      expect(some.assumptions![0]).toMatch(/you said you keep on this account as savings/);
      // More than is on the account counts as all of it.
      const all = runEngine(ctx, "safeToSpend", { horizon: "until_payday", reserve: 10_000_000 });
      close(all.rows[1].amount as number, -inferred.balance);
    }
  });

  it("says whether a price fits what is safe to spend, and lets a necessity use the buffer", () => {
    expect(() => runEngine(ctx, "afford")).toThrow(/needs amount/);
    const p = planUntilPayday(ctx);
    const safe = Math.max(0, p.spendable);
    const small = runEngine(ctx, "afford", { amount: 10, label: "Coffee beans" });
    expect(small.rows.map((row) => row.term)).toEqual([expect.stringMatching(/^Safe to spend until payday/), "Coffee beans", expect.stringMatching(/^(Left until payday|Missing from)/)]);
    close(small.value!, safe - 10);
    close(small.rows.at(-1)!.amount as number, safe - 10);
    expect(small.caption).toMatch(safe >= 10 ? /^Fits/ : /^(More than|Not from)/);
    // A necessity may use the buffer on top of what is safe to spend.
    const bill = runEngine(ctx, "afford", { amount: 10, kind: "necessity" });
    close(bill.value!, safe + p.buffer - 10);
    expect(bill.rows[1].term).toBe("Buffer for unexpected necessities");
    // Far more than the account holds is a savings goal, never a purchase.
    const flat = runEngine(ctx, "afford", { amount: 250_000 });
    expect(flat.value!).toBeLessThan(0);
    expect(flat.caption).toMatch(/^Not from this pay period's money/);
    expect(flat.rows.at(-1)!.term).toBe("Missing from this pay period's money");
  });

  it("reviews a savings plan month by month against what was moved to savings", () => {
    expect(() => runEngine(ctx, "goalReview", { target: 20000 })).toThrow(/needs target and monthly/);
    const r = runEngine(ctx, "goalReview", { target: 20000, saved: 5000, monthly: 300, since: "2026-05" });
    expect(r.rows.map((row) => [row.month, row.planned, row.status])).toEqual([
      ["2026-05", 300, "complete"],
      ["2026-06", 600, "complete"],
      ["2026-07", 900, "complete"],
      ["2026-08", 1200, "complete"],
      ["2026-09", 1500, "in progress"],
    ]);
    // "Moved" is the transfers to savings behind the drill-down, added up month by month.
    const net = (from: string, to: string) =>
      sum(filterTransactions(ctx, { from, to }).map((t) => (t.category === "Invest Deposit" || t.category === "Salary Sweep" ? -t.tx_amount_eur : t.category === "Invest Withdraw" ? -t.tx_amount_eur : 0)));
    close(r.rows[3].moved as number, net("2026-05-01", "2026-08-31"));
    close(r.rows[4].moved as number, net("2026-05-01", ctx.today));
    close(r.rows[4].movedThisMonth as number, net("2026-09-01", ctx.today));
    // The verdict is on the four complete months only.
    const movedComplete = r.rows[3].moved as number;
    expect(r.caption).toMatch(movedComplete >= 1199 ? /^On plan: / : /^Behind plan by /);
    close(r.value!, 5000 + Math.max(0, r.rows[4].moved as number));
    expect(r.assumptions!.join(" ")).toMatch(/At the agreed 300 € a month/);

    // A plan that starts this month has nothing to judge yet, and one "starting" in the future starts now.
    for (const since of [undefined, "2026-09", "2031-01"]) {
      const fresh = runEngine(ctx, "goalReview", { target: 20000, monthly: 300, ...(since && { since }) });
      expect(fresh.rows).toHaveLength(1);
      expect(fresh.caption).toMatch(/^The plan starts this month/);
    }
    expect(() => runEngine(ctx, "goalReview", { target: 20000, monthly: 300, since: "June" })).toThrow(/YYYY-MM/);
  });

  it("peer comparison covers the same 12 months on both sides", () => {
    const r = runEngine(ctx, "peerCompare");
    expect(ctx.cohorts!.window).toEqual([r.filter!.from, r.filter!.to]);
  });
});

describe("applyOps", () => {
  const block = (id: string): Block => ({
    id,
    title: id,
    explanation: "",
    source: "own",
    data: { kind: "engine", fn: "baskets", args: {} },
    view: { kind: "template", template: "baskets" },
  });
  const d = { customerId: "C", blocks: [block("a"), block("b")] };

  it("adds, moves, updates and removes", () => {
    let x = applyOps(d, [{ op: "add_block", block: block("c"), index: 1 }]);
    expect(x.blocks.map((b) => b.id)).toEqual(["a", "c", "b"]);
    x = applyOps(x, [{ op: "move_block", id: "a", index: 2 }]);
    expect(x.blocks.map((b) => b.id)).toEqual(["c", "b", "a"]);
    x = applyOps(x, [{ op: "update_block", id: "b", patch: { title: "B" } }, { op: "remove_block", id: "c" }]);
    expect(x.blocks.map((b) => b.title)).toEqual(["B", "a"]);
  });
});
