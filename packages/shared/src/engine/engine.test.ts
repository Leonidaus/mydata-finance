import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyOps, type Block } from "../blocks";
import { contextFromFixture, type FixtureBundle, type FixtureIndex } from "./fixture";
import { EngineArgumentError } from "./args";
import { basketOf, classifyBasket } from "./baskets";
import { filterTransactions, runEngine } from "./functions";
import type { Cohorts } from "./types";
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
    const margin = r.rows.find((x) => x.term === "Margin in case your salary arrives late")!;
    expect(margin.amount as number).toBeLessThanOrEqual(0);
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
