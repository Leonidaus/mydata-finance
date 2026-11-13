import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "./app";
import { resolvePeriod } from "./finance/period";
import type { SpendingResult } from "./finance/spending";
import { createFixtureDb } from "./testing/fixture";

const app = createApp(createFixtureDb());

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as T };
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
      "/api/customers/CUST00001/spending?period=last_month&basket=essential&groupBy=category",
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
