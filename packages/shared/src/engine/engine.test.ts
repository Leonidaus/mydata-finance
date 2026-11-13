import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyOps, type Block } from "../blocks";
import { contextFromFixture, type FixtureBundle, type FixtureIndex } from "./fixture";
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
