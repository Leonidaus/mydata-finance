import { describe, expect, it } from "vitest";
import { respond } from "../agent/mockAgent";
import { fixtureFetch } from "../testing/fixtureFetch";
import { createFixtureSource } from "./fixtures";

const BASE = "/fixtures/";
const CUSTOMER = "CUST01700";

describe("fixture data source", () => {
  it("serves the picker index and a customer", async () => {
    const source = createFixtureSource(BASE, fixtureFetch(BASE).fetchFn);
    const index = await source.loadIndex();
    expect(index.presets[0].customer_id).toBe(CUSTOMER);
    await expect(source.customer(CUSTOMER)).resolves.toEqual({ customerId: CUSTOMER, age: 21, today: index.today });
  });

  it("runs data requests and returns the transactions behind them, newest first", async () => {
    const source = createFixtureSource(BASE, fixtureFetch(BASE).fetchFn);
    const baskets = await source.runData(CUSTOMER, { kind: "engine", fn: "baskets", args: { period: "last_3_months" } });
    expect(baskets.rows.map((r) => r.basket)).toEqual(["regular", "irregular", "everyday"]);

    const all = await source.transactions(CUSTOMER, baskets.filter ?? {}, 1000);
    expect(all.count).toBe(all.transactions.length);
    expect(all.count).toBe(baskets.rows.reduce((n, r) => n + (r.count as number), 0));
    const stamps = all.transactions.map((t) => t.tx_timestamp);
    expect(stamps).toEqual([...stamps].sort().reverse());

    const few = await source.transactions(CUSTOMER, baskets.filter ?? {}, 5);
    expect(few.count).toBe(all.count);
    expect(few.transactions).toEqual(all.transactions.slice(0, 5));
    expect((await source.transactions(CUSTOMER, baskets.filter ?? {}, 0)).transactions).toEqual([]);
  });

  it("loads each file once, however many requests need it", async () => {
    const { fetchFn, calls } = fixtureFetch(BASE);
    const source = createFixtureSource(BASE, fetchFn);
    await Promise.all([
      source.customer(CUSTOMER),
      source.runData(CUSTOMER, { kind: "engine", fn: "recurring", args: {} }),
      source.transactions(CUSTOMER, {}),
    ]);
    expect(calls.sort()).toEqual([`${BASE}${CUSTOMER}.json`, `${BASE}cohorts.json`, `${BASE}index.json`]);
  });

  it("rejects what it cannot answer", async () => {
    const source = createFixtureSource(BASE, fixtureFetch(BASE).fetchFn);
    await expect(source.customer("CUST00001")).rejects.toThrow("Could not load CUST00001.json (404)");
    await expect(source.runData(CUSTOMER, { kind: "sql", sql: "select 1" })).rejects.toThrow("SQL blocks need the backend");
  });

  it("forgets a failed load, so that a retry fetches again", async () => {
    const { fetchFn } = fixtureFetch(BASE);
    let online = false;
    const source = createFixtureSource(BASE, async (...args) => {
      if (!online) throw new TypeError("fetch failed");
      return fetchFn(...args);
    });
    await expect(source.customer(CUSTOMER)).rejects.toThrow("fetch failed");
    online = true;
    await expect(source.customer(CUSTOMER)).resolves.toMatchObject({ customerId: CUSTOMER });
  });
});

describe("demo coach on a data source", () => {
  const source = createFixtureSource(BASE, fixtureFetch(BASE).fetchFn);
  const ask = (question: string) => respond(question, [], (fn, args = {}) => source.runData(CUSTOMER, { kind: "engine", fn, args }));

  it("answers the taxi question with a transport block whose taxi bar opens the taxi rides", async () => {
    const reply = await ask("How much did I spend on taxis last month?");
    expect(reply.ops).toHaveLength(1);
    const op = reply.ops[0];
    if (op.op !== "add_block") throw new Error("expected an added block");
    expect(op.block.data).toEqual({ kind: "engine", fn: "spendBy", args: { period: "last_month", by: "merchant_type", category: "Transportation" } });

    const result = await source.runData(CUSTOMER, op.block.data);
    const taxi = result.rows.find((r) => r.key === "4121");
    const rides = await source.transactions(CUSTOMER, { ...result.filter, mcc: "4121" });
    expect(rides.count).toBe(taxi?.count ?? 0);
    expect(reply.text).toContain(taxi ? `in ${taxi.count} ride` : "no taxi rides");
  });

  it("fails as a whole when the data cannot be loaded", async () => {
    await expect(respond("What is safe for me to spend this week?", [], () => Promise.reject(new Error("Customer not found")))).rejects.toThrow(
      "Customer not found",
    );
  });
});
