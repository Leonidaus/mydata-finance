import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createApp } from "./app";
import { resolvePeriod } from "./finance/period";
import type { SpendingResult } from "./finance/spending";
import { createFixtureDb } from "./testing/fixture";

const app = createApp(createFixtureDb());

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as T };
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

interface EngineBody {
  rows: Record<string, string | number | null>[];
  value?: number;
  filter?: Record<string, string>;
}

describe("resolvePeriod", () => {
  const today = "2026-09-15";

  it("resolves calendar periods relative to today", () => {
    assert.deepEqual(resolvePeriod("this_month", today), { from: "2026-09-01", to: "2026-09-15" });
    assert.deepEqual(resolvePeriod("last_month", today), { from: "2026-08-01", to: "2026-08-31" });
    assert.deepEqual(resolvePeriod("last_30_days", today), { from: "2026-08-17", to: "2026-09-15" });
    assert.deepEqual(resolvePeriod("last_3_months", today), { from: "2026-06-01", to: "2026-08-31" });
    assert.deepEqual(resolvePeriod("last_12_months", today), { from: "2025-09-01", to: "2026-08-31" });
    assert.deepEqual(resolvePeriod("this_year", today), { from: "2026-01-01", to: "2026-09-15" });
  });

  it("handles January and month ends", () => {
    assert.deepEqual(resolvePeriod("last_month", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(resolvePeriod("last_month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("GET /api/customers/:id/spending", () => {
  it("answers the taxi question for last month with the transactions behind it", async () => {
    const { status, body } = await get<SpendingResult>(
      "/api/customers/CUST00001/spending?mcc=4121&period=last_month",
    );
    assert.equal(status, 200);
    assert.equal(body.total, 42.5);
    assert.equal(body.count, 2);
    assert.deepEqual(body.period, { from: "2026-08-01", to: "2026-08-31" });
    assert.equal(body.filters.mccLabel, "Taxis and limousines");
    assert.deepEqual(body.transactions.map((t) => t.txId), [7, 2]);
    assert.equal(body.transactions[0].amount, 12.5);
    assert.equal(body.truncated, false);
  });

  it("counts spending only, not income or saving", async () => {
    const { body } = await get<SpendingResult>("/api/customers/CUST00001/spending?period=last_month");
    assert.equal(body.total, 1072.5); // 700 + 30 + 80 + 250 + 12.50
    assert.equal(body.count, 5);
  });

  it("never shows transactions after today", async () => {
    const { body } = await get<SpendingResult>(
      "/api/customers/CUST00001/spending?mcc=4121&from=2026-09-01&to=2026-09-30",
    );
    assert.equal(body.total, 20);
    assert.equal(body.period.to, "2026-09-15");
    assert.deepEqual(body.transactions.map((t) => t.txId), [8]);
  });

  it("does not leak another customer's transactions", async () => {
    const { body } = await get<SpendingResult>("/api/customers/CUST00002/spending?period=last_month");
    assert.equal(body.total, 55);
    assert.deepEqual(body.transactions.map((t) => t.txId), [10]);
  });

  it("filters by basket and groups by category", async () => {
    const { body } = await get<SpendingResult>(
      "/api/customers/CUST00001/spending?period=last_month&basket=regular&groupBy=category",
    );
    assert.equal(body.total, 780);
    assert.deepEqual(body.groups, [
      { key: "Housing", label: "Housing", total: 700, count: 1 },
      { key: "Groceries", label: "Groceries", total: 80, count: 1 },
    ]);
  });

  it("limits the evidence and says so", async () => {
    const { body } = await get<SpendingResult>("/api/customers/CUST00001/spending?period=last_month&limit=2");
    assert.equal(body.transactions.length, 2);
    assert.equal(body.count, 5);
    assert.equal(body.truncated, true);
  });

  it("rejects bad input", async () => {
    assert.equal((await get("/api/customers/CUST00001/spending?mcc=taxi")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/spending?period=someday")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/spending?from=2026-08-01")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/spending?from=2026-02-30&to=2026-03-01")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/spending?category=Nonsense")).status, 400);
    assert.equal((await get("/api/customers/1%20OR%201=1/spending")).status, 400);
    assert.equal((await get("/api/customers/CUST99999/spending")).status, 404);
  });
});

describe("customer routes", () => {
  it("returns a profile with the balance as of today", async () => {
    const { status, body } = await get<{ balance: number; ageBand: string; hasMortgageApplication: boolean }>(
      "/api/customers/CUST00001",
    );
    assert.equal(status, 200);
    assert.equal(body.balance, 3207.5); // after tx 8, not the later tx 9
    assert.equal(body.ageBand, "25-34");
    assert.equal(body.hasMortgageApplication, false);
  });

  it("lists customers and filters on mortgage applications", async () => {
    const all = await get<{ customers: { customerId: string }[] }>("/api/customers");
    assert.deepEqual(all.body.customers.map((c) => c.customerId), ["CUST00001", "CUST00002"]);
    const mortgage = await get<{ customers: { customerId: string }[] }>("/api/customers?mortgage=true");
    assert.deepEqual(mortgage.body.customers.map((c) => c.customerId), ["CUST00002"]);
  });

  it("returns the monthly summary oldest first and marks the partial month", async () => {
    const { body } = await get<{ today: string; months: { month: string; isPartial: boolean }[] }>(
      "/api/customers/CUST00001/summary",
    );
    assert.equal(body.today, "2026-09-15");
    assert.deepEqual(body.months.map((m) => [m.month, m.isPartial]), [
      ["2026-08", false],
      ["2026-09", true],
    ]);
  });

  it("reports health and unknown routes", async () => {
    assert.equal((await get<{ ok: boolean }>("/api/health")).body.ok, true);
    assert.equal((await get("/api/nope")).status, 404);
  });
});

describe("finance engine routes", () => {
  it("runs safe to spend on the balance as of today", async () => {
    const { status, body } = await get<EngineBody>("/api/customers/CUST00001/engine/safeToSpend");
    assert.equal(status, 200);
    // Balance after the last transaction on or before today (tx 8), not the later tx 9.
    assert.deepEqual(body.rows[0], { term: "Balance today", amount: 3207.5 });
    assert.equal(typeof body.value, "number");
  });

  it("runs a what-if with arguments from the query string", async () => {
    // The fixture customer has one month of history (August): 42.50 on Transportation,
    // so a 20% cut saves 8.50 a month, or 102 a year. The average is not diluted over 12 months.
    const { body } = await get<EngineBody>(
      "/api/customers/CUST00001/engine/whatIf?category=Transportation&cutPct=20",
    );
    assert.equal(body.value, 102);
    assert.equal(body.rows.length, 12);
  });

  it("runs a block's data request and gives the same answer", async () => {
    const { status, body } = await post<EngineBody>("/api/data", {
      customerId: "CUST00001",
      data: { kind: "engine", fn: "whatIf", args: { category: "Transportation", cutPct: 20 } },
    });
    assert.equal(status, 200);
    assert.equal(body.value, 102);
  });

  it("compares with the age band's averages across all areas", async () => {
    const { body } = await post<EngineBody>("/api/data", {
      customerId: "CUST00001",
      data: { kind: "engine", fn: "peerCompare", args: { category: "Groceries" } },
    });
    assert.deepEqual(body.rows, [
      { category: "Groceries", who: "You", amount: 80 },
      { category: "Groceries", who: "Peers 25-34", amount: 400 },
    ]);
  });

  it("returns the transactions behind a result, newest first and never after today", async () => {
    const { status, body } = await post<{ count: number; transactions: { tx_date: string }[] }>(
      "/api/transactions",
      { customerId: "CUST00001", filter: { kind: "spending", mcc: "4121" }, limit: 2 },
    );
    assert.equal(status, 200);
    assert.equal(body.count, 3);
    assert.deepEqual(body.transactions.map((t) => t.tx_date), ["2026-09-10", "2026-08-20"]);
  });

  it("rejects bad requests", async () => {
    assert.equal((await get("/api/customers/CUST00001/engine/dropTables")).status, 400);
    assert.equal((await get("/api/customers/CUST99999/engine/whatIf")).status, 404);
    assert.equal((await post("/api/data", "not json")).status, 400);
    assert.equal((await post("/api/data", { customerId: "CUST00001" })).status, 400);
    assert.equal((await post("/api/data", { customerId: "CUST00001", data: { kind: "engine", fn: "nope" } })).status, 400);
    assert.equal((await post("/api/data", { customerId: "CUST00001", data: { kind: "sql", sql: "select 1" } })).status, 501);
    assert.equal((await post("/api/transactions", { customerId: "CUST00001", filter: { month: 8 } })).status, 400);
    assert.equal((await post("/api/transactions", { customerId: "CUST99999" })).status, 404);
  });

  it("answers 400 with a reason for wrong engine arguments instead of guessing", async () => {
    const wrongPeriod = await get<{ error: string }>("/api/customers/CUST00001/engine/baskets?period=last_year");
    assert.equal(wrongPeriod.status, 400);
    assert.match(wrongPeriod.body.error, /period must be one of/);
    assert.equal((await get("/api/customers/CUST00001/engine/whatIf?cut_pct=20")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/engine/whatIf?cutPct=150")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/engine/whatIf?category=Salary")).status, 400);
    assert.equal((await get("/api/customers/CUST00001/engine/goalProgress?target=0")).status, 400);
    const data = { kind: "engine", fn: "monthlyTrend", args: { months: "twelve" } };
    assert.equal((await post("/api/data", { customerId: "CUST00001", data })).status, 400);
  });

  it("offers safe to save, with rows that add up", async () => {
    const { status, body } = await get<EngineBody & { assumptions: string[] }>(
      "/api/customers/CUST00001/engine/safeToSave",
    );
    assert.equal(status, 200);
    const amounts = body.rows.map((row) => row.amount as number);
    const last = amounts.pop() as number;
    assert.ok(Math.abs(amounts.reduce((a, b) => a + b, 0) - last) < 0.05);
    assert.equal(body.value, Math.max(0, last));
    assert.ok(body.assumptions.length > 0);
  });
});

describe("summary definitions", () => {
  it("reports net as income minus spending and the balance change separately", async () => {
    const { body } = await get<{ months: { month: string; net: number; balanceChange: number; regular: number }[] }>(
      "/api/customers/CUST00001/summary",
    );
    const august = body.months.find((m) => m.month === "2026-08")!;
    assert.equal(august.net, 1427.5); // 2500 income - 1072.50 spending
    assert.equal(august.balanceChange, 1227.5); // net minus the 200 moved to savings
    assert.equal(august.regular, 780);
  });
});
