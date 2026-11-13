import type { DataRequest } from "@mydata/shared";
import { describe, expect, it } from "vitest";
import { createApiSource, failureMessage } from "./api";

type Answer = { status?: number; json?: unknown; text?: string } | Error;

/** A stand-in for `fetch` that answers by "METHOD path" and records what was asked. */
function fakeFetch(routes: Record<string, Answer | (() => Answer)>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown; signal?: AbortSignal | null }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`Unexpected request: ${method} ${url}`);
    const answer = typeof route === "function" ? route() : route;
    if (answer instanceof Error) throw answer;
    return new Response(answer.text ?? JSON.stringify(answer.json), { status: answer.status ?? 200 });
  };
  return { fetchFn, calls };
}

const baskets: DataRequest = { kind: "engine", fn: "baskets", args: { period: "last_3_months" } };
const result = { rows: [{ basket: "regular", amount: 10 }], value: 10, filter: { kind: "spending" } };

describe("API data source", () => {
  it("runs a data request with POST /api/data", async () => {
    const { fetchFn, calls } = fakeFetch({ "POST /api/data": { json: result } });
    const signal = new AbortController().signal;
    await expect(createApiSource("", fetchFn).runData("CUST01700", baskets, signal)).resolves.toEqual(result);
    expect(calls).toEqual([
      {
        url: "/api/data",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { customerId: "CUST01700", data: baskets },
        signal,
      },
    ]);
  });

  it("fetches evidence with POST /api/transactions, on the configured API origin", async () => {
    const page = { count: 2, transactions: [{ tx_date: "2026-08-20" }, { tx_date: "2026-08-03" }] };
    const { fetchFn, calls } = fakeFetch({ "POST http://localhost:8791/api/transactions": { json: page } });
    const source = createApiSource("http://localhost:8791", fetchFn);
    await expect(source.transactions("CUST01700", { mcc: "4121", from: "2026-08-01", to: "2026-08-31" }, 300)).resolves.toEqual(page);
    expect(calls[0].body).toEqual({ customerId: "CUST01700", filter: { mcc: "4121", from: "2026-08-01", to: "2026-08-31" }, limit: 300 });
  });

  it("loads a customer with the backend's today, asking for today only once", async () => {
    const { fetchFn, calls } = fakeFetch({
      "GET /api/health": { json: { ok: true, today: "2026-09-15" } },
      "GET /api/customers/CUST01700": { json: { customerId: "CUST01700", age: 21, ageBand: "18-24" } },
      "GET /api/customers/CUST02305": { json: { customerId: "CUST02305", age: 51, ageBand: "45-54" } },
    });
    const source = createApiSource("", fetchFn);
    await expect(source.customer("CUST01700")).resolves.toEqual({ customerId: "CUST01700", age: 21, today: "2026-09-15" });
    await expect(source.customer("CUST02305")).resolves.toEqual({ customerId: "CUST02305", age: 51, today: "2026-09-15" });
    expect(calls.filter((c) => c.url === "/api/health")).toHaveLength(1);
  });

  it("does not remember a failed today, so that a retry can succeed", async () => {
    let healthy = false;
    const { fetchFn } = fakeFetch({
      "GET /api/health": () => (healthy ? { json: { ok: true, today: "2026-09-15" } } : new TypeError("fetch failed")),
      "GET /api/customers/CUST01700": { json: { customerId: "CUST01700", age: 21 } },
    });
    const source = createApiSource("", fetchFn);
    await expect(source.customer("CUST01700")).rejects.toThrow("Could not reach the finance API");
    healthy = true;
    await expect(source.customer("CUST01700")).resolves.toMatchObject({ today: "2026-09-15" });
  });
});

describe("API data source failures", () => {
  const failing = (answer: Answer) => createApiSource("", fakeFetch({ "POST /api/data": answer, "POST /api/transactions": answer }).fetchFn);

  it("shows the backend's own error message", async () => {
    await expect(failing({ status: 404, json: { error: "Customer not found" } }).runData("CUST99999", baskets)).rejects.toThrow(/^Customer not found$/);
    await expect(
      failing({ status: 501, json: { error: "SQL data requests are not supported yet" } }).runData("CUST01700", { kind: "sql", sql: "select 1" }),
    ).rejects.toThrow(/^SQL data requests are not supported yet$/);
    await expect(failing({ status: 400, json: { error: "limit must be a whole number" } }).transactions("CUST01700", {}, 1.5)).rejects.toThrow(
      "limit must be a whole number",
    );
  });

  it("explains an unreachable backend", async () => {
    await expect(failing(new TypeError("fetch failed")).runData("CUST01700", baskets)).rejects.toThrow(
      "Could not reach the finance API. Is the backend running?",
    );
    // What the Vite proxy answers when nothing listens on the backend port.
    await expect(failing({ status: 502, text: "" }).runData("CUST01700", baskets)).rejects.toThrow(
      "The finance API is not available (status 502). Is the backend running?",
    );
  });

  it("rejects answers that are not what the API promises", async () => {
    await expect(failing({ text: "<!doctype html><title>app</title>" }).runData("CUST01700", baskets)).rejects.toThrow("could not read");
    await expect(failing({ json: { value: 1 } }).runData("CUST01700", baskets)).rejects.toThrow("unexpected answer for this block");
    await expect(failing({ json: { transactions: [] } }).transactions("CUST01700", {})).rejects.toThrow("unexpected answer for these transactions");
  });

  it("passes an aborted request on as an abort, not as a failure to show", async () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    await expect(failing(aborted).runData("CUST01700", baskets)).rejects.toBe(aborted);
  });

  it("maps statuses without a JSON error", () => {
    expect(failureMessage(404, { error: "Customer not found" })).toBe("Customer not found");
    expect(failureMessage(404, undefined)).toBe("The finance API answered with status 404.");
    expect(failureMessage(502, "Bad gateway")).toBe("The finance API is not available (status 502). Is the backend running?");
  });
});
